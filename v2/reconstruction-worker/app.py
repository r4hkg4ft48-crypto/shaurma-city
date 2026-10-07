from __future__ import annotations
import os, io, json, math, base64, hmac, hashlib, asyncio, tempfile, shutil, traceback
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
import numpy as np
import httpx
from PIL import Image
from fastapi import FastAPI, HTTPException, BackgroundTasks, Request
from pydantic import BaseModel, Field

APP_VERSION="realcity-photoreal-worker-v4"
ENGINE="realcity-photoreal-v1"
TOKEN=os.getenv("REALCITY_WORKER_TOKEN","")
CALLBACK_SECRET=os.getenv("REALCITY_CALLBACK_SECRET","")
VGGT_MODEL=os.getenv("REALCITY_VGGT_MODEL","facebook/VGGT-1B-Commercial")
MAPANYTHING_MODEL=os.getenv("REALCITY_MAPANYTHING_MODEL","facebook/map-anything-apache")
MAX_BACKEND=os.getenv("REALCITY_MAX_BACKEND","mapanything").strip().lower()
HF_TOKEN=os.getenv("HF_TOKEN","")
MAX_DOWNLOAD=20*1024*1024
WORKERS=max(1,int(os.getenv("REALCITY_GPU_CONCURRENCY","1")))
USE_BA=os.getenv("REALCITY_USE_BA","true").lower() not in ("0","false","off","no")
USE_GSPLAT=os.getenv("REALCITY_USE_GSPLAT","true").lower() not in ("0","false","off","no")
GSPLAT_STEPS=max(120,min(1800,int(os.getenv("REALCITY_GSPLAT_STEPS","720"))))
ALLOW_DEPTH_FALLBACK=os.getenv("REALCITY_ALLOW_DEPTH_FALLBACK","true").lower() not in ("0","false","off","no")
LIGHTWEIGHT_CPU=os.getenv("REALCITY_LIGHTWEIGHT_CPU","false").lower() in ("1","true","on","yes")
HIGH_MEMORY_CPU=os.getenv("REALCITY_HIGH_MEMORY_CPU","false").lower() in ("1","true","on","yes")
DEPTH_MODEL=os.getenv("REALCITY_DEPTH_MODEL","depth-anything/Depth-Anything-V2-Metric-Outdoor-Small-hf")
SEM=asyncio.Semaphore(WORKERS)
_VGGT_CACHE=None
_MAPANYTHING_CACHE=None
_DEPTH_CACHE=None
app=FastAPI(title="RealCity Photoreal Worker",version=APP_VERSION)

class Job(BaseModel):
    schema:int
    job_id:str
    input_signature:str
    target:dict
    map_anchor:dict
    sources:list[dict]=Field(default_factory=list)
    policy:dict=Field(default_factory=dict)
    callback:dict

def artifact_digest(artifact:dict)->str:
    parts=[]
    for chunk in artifact.get("chunks",[]):
        raw=base64.b64decode(chunk.get("data",""),validate=True)
        parts.append(f"{chunk.get('id','')}:{int(chunk.get('point_count',0))}:{hashlib.sha256(raw).hexdigest()}")
    value="|".join([
        str(artifact.get("engine","")),
        str(artifact.get("input_signature","")),
        str(artifact.get("target",{}).get("marker_id","")),
        ",".join(str(v) for v in artifact.get("origin",[])),
        ";".join(parts)
    ])
    return hashlib.sha256(value.encode()).hexdigest()

def callback_digest(body:dict)->str:
    if body.get("status")=="ready":
        return artifact_digest(body.get("artifact") or {})
    return hashlib.sha256(str(body.get("error",""))[:500].strip().encode()).hexdigest()

def sign_callback(body:dict)->str:
    raw=":".join(["callback",str(body.get("job_id","")),str(body.get("input_signature","")),str(body.get("status","")),callback_digest(body)])
    return hmac.new(CALLBACK_SECRET.encode(),raw.encode(),hashlib.sha256).hexdigest()

def local_xy(lon:float,lat:float,origin:list[float])->tuple[float,float]:
    lat0=math.radians(origin[1])
    x=(lon-origin[0])*111320.0*max(.15,math.cos(lat0))
    y=(lat-origin[1])*110540.0
    return x,y

def bearing_deg(a:list[float],b:list[float])->float:
    lon1,lat1=map(math.radians,a[:2]);lon2,lat2=map(math.radians,b[:2]);dl=lon2-lon1
    y=math.sin(dl)*math.cos(lat2)
    x=math.cos(lat1)*math.sin(lat2)-math.sin(lat1)*math.cos(lat2)*math.cos(dl)
    return (math.degrees(math.atan2(y,x))+360)%360

def source_target(source:dict,job:Job):
    match=source.get("match") if isinstance(source.get("match"),dict) else None
    if match:
        bid=str(match.get("building_id") or "")
        try:edge=int(match.get("edge_index"))
        except Exception:edge=-1
        for building in job.map_anchor.get("buildings",[]):
            if str(building.get("building_id"))!=bid:continue
            ring=building.get("ring") or []
            if 0<=edge<len(ring)-1:
                a,b=ring[edge],ring[edge+1]
                return [(float(a[0])+float(b[0]))/2,(float(a[1])+float(b[1]))/2]
    return job.target.get("coordinates") or job.map_anchor.get("origin",[])[:2]

def source_host(url:str)->str:
    try:return (urlparse(str(url)).hostname or "unknown").lower()
    except Exception:return "invalid"

async def download(url:str,provider:str="")->bytes:
    headers={
      "User-Agent":"ShaurmegRealCity/1.0 (+https://github.com/r4hkg4ft48-crypto/shaurma-city)",
      "Accept":"image/avif,image/webp,image/jpeg,image/png,image/*;q=.9,*/*;q=.2",
      "Accept-Language":"en-US,en;q=.8",
      "Cache-Control":"no-cache",
    }
    if provider=="wikimedia":headers["Referer"]="https://commons.wikimedia.org/"
    timeout=httpx.Timeout(32.0,connect=12.0)
    async with httpx.AsyncClient(timeout=timeout,follow_redirects=True,headers=headers) as client:
        last=None
        for attempt in range(2):
            try:
                r=await client.get(url)
                if r.status_code in (429,500,502,503,504) and attempt==0:
                    await asyncio.sleep(.55)
                    continue
                r.raise_for_status()
                ct=r.headers.get("content-type","").split(";")[0].strip().lower()
                data=r.content
                if not data:raise RuntimeError("source_empty")
                if len(data)>MAX_DOWNLOAD:raise RuntimeError("source_too_large")
                if ct.startswith("text/") or ct in ("application/json","application/xml","text/html"):
                    raise RuntimeError("source_not_image:"+ct)
                return data
            except Exception as exc:
                last=exc
                if attempt==0:await asyncio.sleep(.35)
        raise RuntimeError(str(last)[:180] if last else "source_fetch_failed")

def prepare_image(data:bytes,path:Path,max_side:int=1600)->dict:
    im=Image.open(io.BytesIO(data)).convert("RGB")
    w,h=im.size
    scale=min(1.0,max_side/max(w,h))
    if scale<1:
        im=im.resize((max(32,round(w*scale)),max(32,round(h*scale))),Image.Resampling.LANCZOS)
    im.save(path,quality=94,subsampling=0)
    return {"width":im.width,"height":im.height,"original_width":w,"original_height":h}

async def load_source_image(source:dict,path:Path)->dict:
    provider=str(source.get("provider") or source.get("kind") or "unknown")
    sid=str(source.get("id") or "unknown")
    urls=[]
    for raw in (source.get("url"),source.get("fallback_url")):
        u=str(raw or "").strip()
        if u and u not in urls:urls.append(u)
    errors=[]
    for idx,url in enumerate(urls):
        host=source_host(url)
        try:
            data=await download(url,provider)
            meta=prepare_image(data,path)
            return {"meta":meta,"host":host,"fallback_used":idx>0}
        except Exception as exc:
            errors.append(f"{host}:{type(exc).__name__}:{str(exc)[:110]}")
    detail="|".join(errors[:3]) or "no_source_url"
    raise RuntimeError(f"source_fetch_failed[{provider}:{sid}] {detail}")

def camera_centers(extrinsic:np.ndarray)->np.ndarray:
    # OpenCV world->camera [R|t]
    R=extrinsic[...,:3]
    t=extrinsic[...,3]
    return -np.einsum("...ji,...j->...i",R,t)

def similarity_xy(src:np.ndarray,dst:np.ndarray):
    if len(src)<2:
        return None
    s=src[:,:2].astype(np.float64); d=dst[:,:2].astype(np.float64)
    sm=s.mean(0); dm=d.mean(0)
    X=s-sm; Y=d-dm
    H=X.T@Y
    U,S,Vt=np.linalg.svd(H)
    R=Vt.T@U.T
    if np.linalg.det(R)<0:
        Vt[-1,:]*=-1; R=Vt.T@U.T
    var=(X*X).sum()
    scale=float(S.sum()/max(var,1e-9))
    t=dm-scale*(R@sm)
    pred=(scale*(R@s.T)).T+t
    rms=float(np.sqrt(np.mean(np.sum((pred-d)**2,axis=1))))
    return scale,R,t,rms

def anchor_points(points:np.ndarray,centers:np.ndarray,sources:list[dict],origin:list[float],map_anchor:dict):
    geo_src=[];geo_dst=[]
    for i,s in enumerate(sources[:len(centers)]):
        c=s.get("coordinates")
        if isinstance(c,list) and len(c)>=2 and all(isinstance(v,(int,float)) for v in c[:2]):
            x,y=local_xy(float(c[0]),float(c[1]),origin)
            geo_src.append(centers[i]);geo_dst.append([x,y,0.0])
    method="map-scale"; rms=None
    if len(geo_src)>=2:
        fit=similarity_xy(np.asarray(geo_src),np.asarray(geo_dst))
        if fit:
            scale,R2,t2,rms=fit
            xy=points[:,:2]
            points[:,:2]=(scale*(R2@xy.T)).T+t2
            points[:,2]*=scale
            cxy=centers[:,:2]
            centers[:,:2]=(scale*(R2@cxy.T)).T+t2
            centers[:,2]*=scale
            z0=float(np.median(centers[:,2]))
            points[:,2]-=z0; centers[:,2]-=z0
            method="gps-similarity"
            yaw=float(math.degrees(math.atan2(R2[1,0],R2[0,0])))
            return points,centers,{"method":method,"rms_m":rms,"scale":scale,"yaw_deg":yaw,"geo_cameras":len(geo_src)}
    # Scale the relative reconstruction to the mapped quarter. The geometry is
    # still anchored to the exact marker; confidence reports this weaker mode.
    radial=np.linalg.norm(points[:,:2]-np.median(points[:,:2],axis=0),axis=1)
    q=float(np.percentile(radial[np.isfinite(radial)],92)) if np.any(np.isfinite(radial)) else 1.
    target=min(float(map_anchor.get("radius_m",190))*.78,120.0)
    scale=np.clip(target/max(q,1e-3),.02,100.0)
    center=np.median(points,axis=0)
    points=(points-center)*scale
    centers=(centers-center)*scale
    # Heading metadata can fix yaw when GPS is unavailable.
    heading=None; idx=None
    for i,s in enumerate(sources[:len(centers)]):
        if isinstance(s.get("heading"),(int,float)):
            heading=float(s["heading"]);idx=i;break
    if heading is not None and idx is not None:
        v=centers[idx,:2]
        if np.linalg.norm(v)>.2:
            current=(math.degrees(math.atan2(v[0],v[1]))+360)%360
            a=math.radians(heading-current)
            R=np.array([[math.cos(a),-math.sin(a)],[math.sin(a),math.cos(a)]])
            points[:,:2]=(R@points[:,:2].T).T; centers[:,:2]=(R@centers[:,:2].T).T
            method="map-scale-heading"
            yaw_deg=float(math.degrees(a))
        else:
            yaw_deg=0.0
    else:
        yaw_deg=0.0
    return points,centers,{"method":method,"rms_m":None,"scale":float(scale),"yaw_deg":yaw_deg,"geo_cameras":len(geo_src)}

def source_target_from_anchor(source:dict,map_anchor:dict,origin:list[float]):
    match=source.get("match") if isinstance(source.get("match"),dict) else None
    if match:
        bid=str(match.get("building_id") or "")
        try:edge=int(match.get("edge_index"))
        except Exception:edge=-1
        for building in map_anchor.get("buildings",[]):
            if str(building.get("building_id"))!=bid:continue
            ring=building.get("ring") or []
            if 0<=edge<len(ring)-1:
                a,b=ring[edge],ring[edge+1]
                return [(float(a[0])+float(b[0]))/2,(float(a[1])+float(b[1]))/2]
    return list(origin[:2])

def desired_camera_basis(source:dict,map_anchor:dict,origin:list[float]):
    coords=source.get("coordinates")
    heading=source.get("heading")
    if not isinstance(heading,(int,float)) or not math.isfinite(float(heading)):
        if isinstance(coords,list) and len(coords)>=2:
            heading=bearing_deg(coords,source_target_from_anchor(source,map_anchor,origin))
        else:
            heading=0.0
    pitch=source.get("pitch")
    pitch=float(pitch) if isinstance(pitch,(int,float)) and math.isfinite(float(pitch)) else 0.0
    pitch=max(-30.0,min(30.0,pitch))
    yaw=math.radians(float(heading));pit=math.radians(pitch)
    # OpenCV camera axes are +X right, +Y down, +Z forward. Build the
    # corresponding East/North/Up basis for this observed camera heading.
    forward=np.array([math.sin(yaw)*math.cos(pit),math.cos(yaw)*math.cos(pit),math.sin(pit)],dtype=np.float64)
    right=np.array([math.cos(yaw),-math.sin(yaw),0.0],dtype=np.float64)
    right/=max(float(np.linalg.norm(right)),1e-9)
    forward/=max(float(np.linalg.norm(forward)),1e-9)
    down=np.cross(forward,right)
    down/=max(float(np.linalg.norm(down)),1e-9)
    return np.column_stack([right,down,forward])

def anchor_metric_points(points:np.ndarray,centers:np.ndarray,c2w:np.ndarray,sources:list[dict],origin:list[float],map_anchor:dict):
    geo=[]
    for i,s in enumerate(sources[:len(centers)]):
        coords=s.get("coordinates")
        if isinstance(coords,list) and len(coords)>=2 and all(isinstance(v,(int,float)) for v in coords[:2]):
            x,y=local_xy(float(coords[0]),float(coords[1]),origin)
            geo.append((i,np.array([x,y],dtype=np.float64)))

    if not geo:
        return anchor_points(points,centers,sources,origin,map_anchor)

    # Align the complete MapAnything world basis, not only XY. MapAnything
    # camera_poses use OpenCV cam2world: columns are camera right/down/forward.
    # Without this basis transform genuine depth can appear rotated onto the
    # ground plane when rendered in the ENU map frame.
    ref_i=next((i for i,_ in geo if isinstance(sources[i].get("heading"),(int,float))),geo[0][0])
    model_basis=np.asarray(c2w[ref_i][:3,:3],dtype=np.float64)
    desired_basis=desired_camera_basis(sources[ref_i],map_anchor,origin)
    Rbase=desired_basis@model_basis.T
    if np.linalg.det(Rbase)<0:
        desired_basis[:,1]*=-1.0
        Rbase=desired_basis@model_basis.T
    points=(Rbase@points.astype(np.float64).T).T
    centers=(Rbase@centers.astype(np.float64).T).T

    Rtotal=Rbase.copy()
    if len(geo)>=2:
        src=np.stack([centers[i,:2] for i,_ in geo]).astype(np.float64)
        dst=np.stack([xy for _,xy in geo]).astype(np.float64)
        sm,dm=src.mean(0),dst.mean(0);X=src-sm;Y=dst-dm
        U,_,Vt=np.linalg.svd(X.T@Y);R2=Vt.T@U.T
        if np.linalg.det(R2)<0:
            Vt[-1,:]*=-1;R2=Vt.T@U.T
        t=dm-R2@sm
        points[:,:2]=(R2@points[:,:2].T).T+t
        centers[:,:2]=(R2@centers[:,:2].T).T+t
        Rz3=np.eye(3,dtype=np.float64);Rz3[:2,:2]=R2
        Rtotal=Rz3@Rbase
        zref=float(np.median([centers[i,2] for i,_ in geo]))
        zshift=1.65-zref;points[:,2]+=zshift;centers[:,2]+=zshift
        pred=(R2@src.T).T+t;rms=float(np.sqrt(np.mean(np.sum((pred-dst)**2,axis=1))))
        yaw=float(math.degrees(math.atan2(R2[1,0],R2[0,0])))
        return points.astype(np.float32),centers.astype(np.float32),{
            "method":"gps-rigid-metric-3d","rms_m":rms,"scale":1.0,"yaw_deg":yaw,
            "geo_cameras":len(geo),"rotation_matrix":Rtotal.tolist()
        }

    i,target_xy=geo[0]
    delta_xy=target_xy-centers[i,:2]
    points[:,:2]+=delta_xy;centers[:,:2]+=delta_xy
    zshift=1.65-float(centers[i,2]);points[:,2]+=zshift;centers[:,2]+=zshift
    return points.astype(np.float32),centers.astype(np.float32),{
        "method":"gps-heading-metric-3d","rms_m":0.0,"scale":1.0,"yaw_deg":0.0,
        "geo_cameras":1,"rotation_matrix":Rtotal.tolist()
    }

def choose_samples(point_maps:np.ndarray,conf:np.ndarray,images:np.ndarray,target:int):
    # point_maps: N,H,W,3; conf N,H,W. Sample high-confidence pixels while
    # retaining frame IDs so unstable single-view geometry can be rejected.
    N,H,W,_=point_maps.shape
    colors=np.clip(images.transpose(0,2,3,1),0,1)
    pts=[];cols=[];scores=[];frames=[]
    per=max(3500,target//max(1,N))
    for i in range(N):
        p=point_maps[i].reshape(-1,3)
        c=colors[i].reshape(-1,3)
        cf=conf[i].reshape(-1)
        yy=np.repeat(np.arange(H),W)
        valid=np.isfinite(p).all(1)&np.isfinite(cf)&(cf>0)&(yy>H*.08)
        d=np.linalg.norm(p,axis=1)
        goodd=d[valid]
        if goodd.size:
            lo,hi=np.percentile(goodd,[1,98.5]);valid&=(d>=lo)&(d<=hi)
        ids=np.flatnonzero(valid)
        if not len(ids): continue
        k=min(per,len(ids))
        best=ids[np.argpartition(cf[ids],-k)[-k:]]
        pts.append(p[best]);cols.append(c[best]);scores.append(cf[best]);frames.append(np.full(k,i,dtype=np.int16))
    if not pts: raise RuntimeError("no_confident_points")
    return np.concatenate(pts),np.concatenate(cols),np.concatenate(scores),np.concatenate(frames)

def multiview_filter(points:np.ndarray,colors:np.ndarray,conf:np.ndarray,frames:np.ndarray):
    frame_count=len(np.unique(frames))
    if frame_count<5 or len(points)<8000:
        return points,colors,conf,frames,0
    mn=points.min(0)
    voxel=.24
    key=np.floor((points-mn)/voxel).astype(np.int32)
    support={}
    for k,f in zip(map(tuple,key),frames):
        s=support.get(k)
        if s is None:support[k]={int(f)}
        elif len(s)<3:s.add(int(f))
    views=np.fromiter((len(support[tuple(k)]) for k in key),dtype=np.int16,count=len(key))
    high=conf>=np.percentile(conf,92)
    keep=(views>=2)|high
    # Never let a registration mismatch erase the reconstruction. If support is
    # unexpectedly low, retain the best half and surface that lower confidence.
    if keep.mean()<.28:
        keep=conf>=np.percentile(conf,45)
    removed=int((~keep).sum())
    return points[keep],colors[keep],conf[keep],frames[keep],removed

def voxel_reduce(points,colors,conf,max_points:int):
    good=np.isfinite(points).all(1)&np.isfinite(colors).all(1)&np.isfinite(conf)
    points,colors,conf=points[good],colors[good],conf[good]
    if len(points)<=max_points:return points,colors,conf
    # Deterministic confidence-weighted spatial reduction.
    span=np.maximum(points.max(0)-points.min(0),1e-3)
    volume=float(np.prod(span))
    voxel=max(.035,(volume/max_points)**(1/3))
    key=np.floor((points-points.min(0))/voxel).astype(np.int32)
    order=np.argsort(conf)[::-1]
    packed={}
    for idx in order:
        k=tuple(key[idx])
        if k not in packed: packed[k]=idx
        if len(packed)>=max_points: break
    ids=np.fromiter(packed.values(),dtype=np.int64)
    return points[ids],colors[ids],conf[ids]

def rotate_quats_matrix(quats:np.ndarray,R:np.ndarray)->np.ndarray:
    if not len(quats):return quats
    M=np.asarray(R,dtype=np.float64).reshape(3,3)
    tr=float(np.trace(M))
    if tr>0:
        s=math.sqrt(tr+1.0)*2.0;qw=.25*s;qx=(M[2,1]-M[1,2])/s;qy=(M[0,2]-M[2,0])/s;qz=(M[1,0]-M[0,1])/s
    elif M[0,0]>M[1,1] and M[0,0]>M[2,2]:
        s=math.sqrt(max(1e-12,1.0+M[0,0]-M[1,1]-M[2,2]))*2.0;qw=(M[2,1]-M[1,2])/s;qx=.25*s;qy=(M[0,1]+M[1,0])/s;qz=(M[0,2]+M[2,0])/s
    elif M[1,1]>M[2,2]:
        s=math.sqrt(max(1e-12,1.0+M[1,1]-M[0,0]-M[2,2]))*2.0;qw=(M[0,2]-M[2,0])/s;qx=(M[0,1]+M[1,0])/s;qy=.25*s;qz=(M[1,2]+M[2,1])/s
    else:
        s=math.sqrt(max(1e-12,1.0+M[2,2]-M[0,0]-M[1,1]))*2.0;qw=(M[1,0]-M[0,1])/s;qx=(M[0,2]+M[2,0])/s;qy=(M[1,2]+M[2,1])/s;qz=.25*s
    q=np.array([qw,qx,qy,qz],dtype=np.float64);q/=max(float(np.linalg.norm(q)),1e-9)
    w,x,y,z=quats[:,0],quats[:,1],quats[:,2],quats[:,3]
    out=np.empty_like(quats,dtype=np.float64)
    out[:,0]=q[0]*w-q[1]*x-q[2]*y-q[3]*z
    out[:,1]=q[0]*x+q[1]*w+q[2]*z-q[3]*y
    out[:,2]=q[0]*y-q[1]*z+q[2]*w+q[3]*x
    out[:,3]=q[0]*z+q[1]*y-q[2]*x+q[3]*w
    out/=np.maximum(np.linalg.norm(out,axis=1,keepdims=True),1e-9)
    return out.astype(np.float32)

def rotate_quats_z(quats:np.ndarray,yaw_deg:float)->np.ndarray:
    if not len(quats) or abs(yaw_deg)<1e-7:return quats
    a=math.radians(yaw_deg)*.5
    w0,x0,y0,z0=math.cos(a),0.0,0.0,math.sin(a)
    w,x,y,z=quats[:,0],quats[:,1],quats[:,2],quats[:,3]
    out=np.empty_like(quats)
    out[:,0]=w0*w-x0*x-y0*y-z0*z
    out[:,1]=w0*x+x0*w+y0*z-z0*y
    out[:,2]=w0*y-x0*z+y0*w+z0*x
    out[:,3]=w0*z+x0*y-y0*x+z0*w
    n=np.linalg.norm(out,axis=1,keepdims=True)
    return out/np.maximum(n,1e-8)

def encode_rcsp2(points:np.ndarray,colors:np.ndarray,conf:np.ndarray,scales:np.ndarray,quats:np.ndarray):
    mn=np.percentile(points,.2,axis=0).astype(np.float32)
    mx=np.percentile(points,99.8,axis=0).astype(np.float32)
    pad=np.maximum((mx-mn)*.015,.05);mn-=pad;mx+=pad
    keep=np.all((points>=mn)&(points<=mx),axis=1)
    points,colors,conf,scales,quats=points[keep],colors[keep],conf[keep],scales[keep],quats[keep]
    mid=(mn+mx)/2;half=np.maximum((mx-mn)/2,1e-4)
    qpos=np.clip(np.round((points-mid)/half*32767),-32767,32767).astype("<i2")
    rgb=np.clip(np.round(colors*255),0,255).astype(np.uint8)
    qscale=np.clip(np.round(np.clip(scales,.001,65.535)*1000),1,65535).astype("<u2")
    qn=quats/np.maximum(np.linalg.norm(quats,axis=1,keepdims=True),1e-8)
    qquat=np.clip(np.round(qn*127),-127,127).astype(np.int8)
    c0=np.asarray(conf,dtype=np.float32)
    lo,hi=np.percentile(c0,[3,97]) if len(c0)>8 else (float(c0.min()),float(c0.max()))
    norm=np.clip((c0-lo)/max(float(hi-lo),1e-6),0,1)
    opacity=np.round(np.clip(.18+.82*c0,0,1)*255).astype(np.uint8)
    confidence=np.round(norm*255).astype(np.uint8)
    semantic=np.zeros(len(points),dtype=np.uint8);semantic[points[:,2]<.35]=2
    rec=np.empty((len(points),22),dtype=np.uint8)
    rec[:,:6]=qpos.view(np.uint8).reshape(-1,6)
    rec[:,6:9]=rgb
    rec[:,9:15]=qscale.view(np.uint8).reshape(-1,6)
    rec[:,15:19]=qquat.view(np.uint8).reshape(-1,4)
    rec[:,19]=opacity;rec[:,20]=confidence;rec[:,21]=semantic
    return base64.b64encode(rec.tobytes()).decode(),mn.tolist(),mx.tolist(),len(points)

def refine_cameras_with_ba(images,depth_conf,points_3d,extrinsic,intrinsic,dtype):
    if not USE_BA or len(extrinsic)<4:
        return extrinsic,intrinsic,{"bundle_adjustment":False}
    try:
        import torch
        import pycolmap
        from vggt.dependency.track_predict import predict_tracks
        from vggt.dependency.np_to_pycolmap import batch_np_matrix_to_pycolmap
        amp=torch.autocast(device_type="cuda",dtype=dtype) if images.is_cuda else torch.no_grad()
        with amp:
            tracks,vis,track_conf,tracked_points,points_rgb=predict_tracks(
                images,conf=depth_conf,points_3d=points_3d,masks=None,
                max_query_pts=min(4096,max(1536,len(extrinsic)*192)),
                query_frame_num=min(len(extrinsic),10),
                keypoint_extractor="aliked+sp",fine_tracking=True)
        mask=vis>.2
        reconstruction,valid=batch_np_matrix_to_pycolmap(
            tracked_points,extrinsic,intrinsic,tracks,np.array(images.shape[-2:]),
            masks=mask,max_reproj_error=7.0,shared_camera=False,camera_type="PINHOLE",points_rgb=points_rgb)
        if reconstruction is None: raise RuntimeError("ba_reconstruction_empty")
        pycolmap.bundle_adjustment(reconstruction,pycolmap.BundleAdjustmentOptions())
        out_e=[];out_i=[]
        for i in range(len(extrinsic)):
            im=reconstruction.images[i+1]
            pose=np.asarray(im.cam_from_world().matrix(),dtype=np.float32)
            cam=reconstruction.cameras[im.camera_id]
            K=np.asarray(cam.calibration_matrix(),dtype=np.float32)
            if pose.shape!=(3,4) or K.shape!=(3,3): raise RuntimeError("ba_camera_shape")
            out_e.append(pose);out_i.append(K)
        return np.stack(out_e),np.stack(out_i),{"bundle_adjustment":True,"tracks":int(mask.sum())}
    except Exception as e:
        return extrinsic,intrinsic,{"bundle_adjustment":False,"ba_error":str(e)[:160]}

def gsplat_refine(points,colors,confidence,images,extrinsic,intrinsic,depth_conf):
    if not USE_GSPLAT or len(points)<3000:
        scales=np.full((len(points),3),.045,dtype=np.float32)
        quats=np.zeros((len(points),4),dtype=np.float32);quats[:,0]=1
        return points,colors,confidence,scales,quats,{"gaussian_optimized":False}
    try:
        import torch
        import torch.nn.functional as F
        from gsplat.rendering import rasterization
        device=images.device
        max_init=min(len(points),140000)
        if len(points)>max_init:
            ids=np.argpartition(confidence,-max_init)[-max_init:]
            points,colors,confidence=points[ids],colors[ids],confidence[ids]
        means=torch.nn.Parameter(torch.from_numpy(points).float().to(device))
        initial=means.detach().clone()
        color_logits=torch.nn.Parameter(torch.logit(torch.from_numpy(np.clip(colors,.002,.998)).float().to(device)))
        scene_extent=float(np.linalg.norm(np.percentile(points,97,axis=0)-np.percentile(points,3,axis=0)))
        base=max(scene_extent/max(len(points)**(1/3),1)*.32,.0025)
        scales=torch.nn.Parameter(torch.full((len(points),3),math.log(base),device=device))
        quats=torch.nn.Parameter(torch.zeros((len(points),4),device=device));quats.data[:,0]=1
        c=np.asarray(confidence,dtype=np.float32)
        c=(c-c.min())/max(float(c.max()-c.min()),1e-6)
        opacities=torch.nn.Parameter(torch.logit(torch.from_numpy(np.clip(.22+.62*c,.08,.92)).float().to(device)))
        opts=[
            torch.optim.Adam([means],lr=1.2e-4),
            torch.optim.Adam([scales],lr=3.5e-3),
            torch.optim.Adam([quats],lr=8e-4),
            torch.optim.Adam([opacities],lr=2.5e-2),
            torch.optim.Adam([color_logits],lr=2e-3),
        ]
        view=torch.eye(4,device=device).repeat(len(extrinsic),1,1)
        view[:,:3,:4]=torch.from_numpy(extrinsic).float().to(device)
        Ks=torch.from_numpy(intrinsic).float().to(device)
        targets=images.permute(0,2,3,1).contiguous().float().clamp(0,1)
        conf_t=torch.from_numpy(depth_conf).float().to(device)
        if conf_t.ndim==4:conf_t=conf_t[...,0]
        H,W=targets.shape[1:3]
        yy=torch.arange(H,device=device)[:,None].expand(H,W)
        thresholds=torch.quantile(conf_t.reshape(len(conf_t),-1),.28,dim=1)
        valid=(conf_t>thresholds[:,None,None])&(yy[None]>H*.07)
        steps=max(120,min(GSPLAT_STEPS,len(extrinsic)*32))
        losses=[]
        for step in range(steps):
            i=(step*7+step//max(1,len(extrinsic)))%len(extrinsic)
            for opt in opts:opt.zero_grad(set_to_none=True)
            render,alpha,_=rasterization(
                means=means,quats=F.normalize(quats,dim=-1),scales=torch.exp(scales),
                opacities=torch.sigmoid(opacities),colors=torch.sigmoid(color_logits),
                viewmats=view[i:i+1],Ks=Ks[i:i+1],width=W,height=H,sh_degree=None,
                packed=True,rasterize_mode="antialiased",near_plane=.005,far_plane=1e5)
            mask=valid[i];rgb=render[0,...,:3]
            if mask.any():
                l1=torch.abs(rgb[mask]-targets[i][mask]).mean()
                coverage=(1-alpha[0,...,0][mask]).mean()
            else:
                l1=torch.abs(rgb-targets[i]).mean();coverage=(1-alpha[0,...,0]).mean()
            geom=((means-initial)**2).mean()
            scale_reg=torch.relu(torch.exp(scales).max(dim=1).values-base*8).mean()
            loss=l1+.018*coverage+2e-5*geom+5e-4*scale_reg
            loss.backward()
            for opt in opts:opt.step()
            with torch.no_grad():
                scales.clamp_(math.log(base*.18),math.log(base*10))
                opacities.clamp_(-5.0,5.0);color_logits.clamp_(-7.0,7.0)
            if step%40==0 or step==steps-1:losses.append(float(loss.detach().cpu()))
        with torch.no_grad():
            out_points=means.detach().cpu().numpy()
            out_colors=torch.sigmoid(color_logits).detach().cpu().numpy()
            out_conf=torch.sigmoid(opacities).detach().cpu().numpy()
            out_scales=torch.exp(scales).detach().cpu().numpy()
            out_quats=F.normalize(quats,dim=-1).detach().cpu().numpy()
        return out_points,out_colors,out_conf,out_scales,out_quats,{"gaussian_optimized":True,"gaussian_steps":steps,"gaussian_loss":losses[-1] if losses else None,"gaussians":len(out_points)}
    except Exception as e:
        fallback_scales=np.full((len(points),3),.045,dtype=np.float32)
        fallback_quats=np.zeros((len(points),4),dtype=np.float32);fallback_quats[:,0]=1
        return points,colors,confidence,fallback_scales,fallback_quats,{"gaussian_optimized":False,"gsplat_error":str(e)[:180]}

def frame_budget(requested:int)->int:
    if LIGHTWEIGHT_CPU:
        return min(requested,12)
    if HIGH_MEMORY_CPU:
        return min(requested,32)
    try:
        import torch
        if not torch.cuda.is_available():
            if os.getenv("REALCITY_ALLOW_CPU_MAPANYTHING","false").lower()=="true":
                return min(requested,max(2,min(32,int(os.getenv("REALCITY_CPU_MAX_FRAMES","20")))))
            return min(requested,6)
        total=torch.cuda.get_device_properties(0).total_memory/(1024**3)
        if total>=75:return min(requested,48)
        if total>=46:return min(requested,28)
        if total>=30:return min(requested,20)
        if total>=20:return min(requested,14)
        return min(requested,8)
    except Exception:
        return min(requested,8)

def get_vggt(device):
    global _VGGT_CACHE
    if _VGGT_CACHE is not None:return _VGGT_CACHE
    from vggt.models.vggt import VGGT
    # Hugging Face reads HF_TOKEN automatically. Keep the commercial model
    # resident so a successful gated download is paid only once per worker.
    model=VGGT.from_pretrained(VGGT_MODEL).to(device).eval()
    _VGGT_CACHE=model
    return model

def get_depth_engine(device):
    global _DEPTH_CACHE
    if _DEPTH_CACHE is not None:return _DEPTH_CACHE
    from transformers import AutoImageProcessor,AutoModelForDepthEstimation
    processor=AutoImageProcessor.from_pretrained(DEPTH_MODEL)
    model=AutoModelForDepthEstimation.from_pretrained(DEPTH_MODEL).to(device).eval()
    _DEPTH_CACHE=(processor,model)
    return _DEPTH_CACHE

def gps_depth_reconstruct(image_paths:list[str],sources:list[dict],job:Job):
    import torch
    from transformers import AutoImageProcessor,AutoModelForDepthEstimation
    device="cuda" if torch.cuda.is_available() else "cpu"
    processor,model=get_depth_engine(device)
    origin=job.map_anchor["origin"]
    radius=float(job.map_anchor.get("radius_m",190))
    target=int(job.policy.get("max_points",150000))
    all_points=[];all_colors=[];all_conf=[];all_frames=[]
    used=0
    for i,(path,source) in enumerate(zip(image_paths,sources)):
        coords=source.get("coordinates")
        if not (isinstance(coords,list) and len(coords)>=2 and all(isinstance(v,(int,float)) for v in coords[:2])):
            continue
        im=Image.open(path).convert("RGB")
        # One common raster size keeps inference bounded and preserves enough
        # detail for windows, curbs and vegetation on the fallback path.
        im.thumbnail((768,576) if device=="cuda" else (518,392),Image.Resampling.LANCZOS)
        rgb=np.asarray(im)
        h,w=rgb.shape[:2]
        inputs=processor(images=im,return_tensors="pt")
        inputs={k:v.to(device) for k,v in inputs.items()}
        with torch.inference_mode():
            if device=="cuda":
                with torch.autocast("cuda",dtype=torch.float16):
                    pred=model(**inputs).predicted_depth
            else:
                pred=model(**inputs).predicted_depth
        d=torch.nn.functional.interpolate(pred.unsqueeze(1),size=(h,w),mode="bicubic",align_corners=False).squeeze().float().cpu().numpy()
        finite=np.isfinite(d)&(d>.05)
        if not finite.any():continue
        # Metric Outdoor predicts absolute outdoor depth. Keep it metric; only
        # permit a bounded scale correction when this exact image was matched
        # to a known OSM facade edge.
        depth=np.clip(np.nan_to_num(d,nan=0.0,posinf=80.0,neginf=0.0),.55,min(radius*1.25,80.0))
        match=source.get("match") if isinstance(source.get("match"),dict) else {}
        anchor=match.get("distance_m") if isinstance(match.get("distance_m"),(int,float)) else source.get("distance_m")
        if isinstance(anchor,(int,float)) and math.isfinite(float(anchor)) and float(anchor)>3:
            roi=depth[int(h*.32):int(h*.72),int(w*.34):int(w*.66)]
            valid_depth=roi[np.isfinite(roi)&(roi>.6)&(roi<80)]
            if valid_depth.size>100:
                ratio=float(anchor)/max(float(np.median(valid_depth)),.5)
                if .5<=ratio<=2.0:depth=np.clip(depth*ratio,.55,min(radius*1.25,100.0))
        cx,cy=local_xy(float(coords[0]),float(coords[1]),origin)
        camera_distance=max(5.0,min(100.0,float(anchor) if isinstance(anchor,(int,float)) else math.hypot(cx,cy)))
        heading=source.get("heading")
        if not isinstance(heading,(int,float)):
            heading=bearing_deg(coords,source_target(source,job))
        yaw=math.radians(float(heading))
        forward=np.array([math.sin(yaw),math.cos(yaw),0.0],np.float32)
        right=np.array([math.cos(yaw),-math.sin(yaw),0.0],np.float32)
        up=np.array([0.0,0.0,1.0],np.float32)
        fov=float(source.get("fov") or 78)
        fov=max(35,min(110,90 if source.get("panoramic") else fov))
        focal=w/(2*math.tan(math.radians(fov)/2))
        desired=max(12000,min(45000,int(target*1.8/max(1,len(image_paths)))))
        step=max(1,int(math.sqrt((w*h)/desired)))
        ys=np.arange(step//2,h,step,dtype=np.int32);xs=np.arange(step//2,w,step,dtype=np.int32)
        xx,yy=np.meshgrid(xs,ys)
        z=depth[yy,xx]
        xn=(xx.astype(np.float32)-(w-1)/2)/focal
        yn=(yy.astype(np.float32)-(h-1)/2)/focal
        rays=forward[None,None,:]+xn[...,None]*right[None,None,:]-yn[...,None]*up[None,None,:]
        rays/=np.maximum(np.linalg.norm(rays,axis=2,keepdims=True),1e-6)
        pts=np.array([cx,cy,1.65],np.float32)[None,None,:]+rays*z[...,None]
        cols=rgb[yy,xx].astype(np.float32)/255
        rr=np.linalg.norm(pts[...,:2],axis=2)
        sky=(yy<h*.48)&(cols[...,2]>cols[...,0]*1.08)&(cols[...,2]>cols[...,1]*1.03)&(cols[...,2]>.42)&(z>camera_distance*.8)
        valid=np.isfinite(pts).all(axis=2)&(rr<radius*1.18)&(pts[...,2]>-4)&(pts[...,2]<75)&(~sky)
        if not valid.any():continue
        p=pts[valid];col=cols[valid]
        # Confidence favours central pixels and stable mid-range disparity.
        center=1-np.minimum(1,np.sqrt(((xx[valid]-(w-1)/2)/(w*.55))**2+((yy[valid]-(h-1)/2)/(h*.7))**2))
        cf=np.clip(.45+.42*center,.2,.9).astype(np.float32)
        all_points.append(p);all_colors.append(col);all_conf.append(cf);all_frames.append(np.full(len(p),used,dtype=np.int16));used+=1
    if not all_points:raise RuntimeError("depth_fallback_no_geotagged_views")
    pts=np.concatenate(all_points);cols=np.concatenate(all_colors);conf=np.concatenate(all_conf);frames=np.concatenate(all_frames)
    pts,cols,conf,frames,removed=multiview_filter(pts,cols,conf,frames)
    pts,cols,conf=voxel_reduce(pts,cols,conf,min(target,140000))
    radial=np.linalg.norm(pts[:,:2],axis=1)
    base=np.clip(.045+radial*.0016,.045,.22).astype(np.float32)
    scales=np.column_stack([base,base,np.clip(base*.42,.018,.11)]).astype(np.float32)
    quats=np.zeros((len(pts),4),dtype=np.float32);quats[:,0]=1
    alignment={"method":"gps-metric-depth+osm-facade-heading","rms_m":None,"scale":1.0,"yaw_deg":0.0,"geo_cameras":used}
    gpu=torch.cuda.get_device_name(0) if device=="cuda" else "CPU"
    return pts,cols,conf,scales,quats,alignment,{"backend":"depth-anything-v2-metric-outdoor-gps-osm","gpu":gpu,"frames":used,"dynamic_removed":removed,"bundle_adjustment":False,"gaussian_optimized":False,"fallback":True}


def wrap_angle_deg(value:float)->float:
    return (float(value)+180.0)%360.0-180.0

def facade_candidate(source:dict,job:Job):
    buildings=job.map_anchor.get("buildings") or []
    match=source.get("match") if isinstance(source.get("match"),dict) else {}
    wanted=str(match.get("building_id") or "")
    try:wanted_edge=int(match.get("edge_index"))
    except Exception:wanted_edge=-1
    for b in buildings:
        ring=b.get("ring") or []
        if wanted and str(b.get("building_id"))==wanted and 0<=wanted_edge<len(ring)-1:
            return b,wanted_edge,False

    coords=source.get("coordinates")
    if not (isinstance(coords,list) and len(coords)>=2 and all(isinstance(v,(int,float)) for v in coords[:2])):
        return None
    origin=job.map_anchor.get("origin") or job.target.get("coordinates") or coords
    cx,cy=local_xy(float(coords[0]),float(coords[1]),origin)
    heading=source.get("heading")
    if not isinstance(heading,(int,float)):
        heading=bearing_deg(coords,source_target(source,job))
    panoramic=bool(source.get("panoramic"))
    fov=360.0 if panoramic else max(35.0,min(120.0,float(source.get("fov") or 78.0)))
    best=None
    for b in buildings:
        ring=b.get("ring") or []
        role=str(b.get("role") or "")
        for edge in range(max(0,len(ring)-1)):
            a,bp=ring[edge],ring[edge+1]
            ax,ay=local_xy(float(a[0]),float(a[1]),origin); bx,by=local_xy(float(bp[0]),float(bp[1]),origin)
            mx,my=(ax+bx)*.5,(ay+by)*.5
            dist=math.hypot(mx-cx,my-cy)
            if dist<2.0 or dist>145.0:continue
            target=(math.degrees(math.atan2(mx-cx,my-cy))+360.0)%360.0
            err=abs(wrap_angle_deg(target-float(heading)))
            if not panoramic and err>fov*.62+12.0:continue
            role_bonus=-12.0 if role=="hero" else (-4.0 if role=="nearby" else 0.0)
            score=err*1.65+dist*.055+role_bonus
            if best is None or score<best[0]:best=(score,b,edge,err)
    if best is None:return None
    return best[1],best[2],True

def facade_plane_reconstruct(image_paths:list[str],sources:list[dict],job:Job):
    origin=job.map_anchor.get("origin") or job.target.get("coordinates")
    if not (isinstance(origin,list) and len(origin)>=2):raise RuntimeError("photoplane_missing_origin")
    max_points=min(int(job.policy.get("max_points",120000)),120000)
    all_points=[];all_colors=[];all_conf=[];all_scales=[];all_quats=[]
    used=0;inferred=0;masked=0;facades=set()
    per_source=max(6500,min(30000,max_points//max(1,len(image_paths))))
    for path,source in zip(image_paths,sources):
        hit=facade_candidate(source,job)
        if not hit:continue
        building,edge,is_inferred=hit
        ring=building.get("ring") or []
        if edge<0 or edge>=len(ring)-1:continue
        a,b=ring[edge],ring[edge+1]
        ax,ay=local_xy(float(a[0]),float(a[1]),origin);bx,by=local_xy(float(b[0]),float(b[1]),origin)
        ex,ey=bx-ax,by-ay
        length=math.hypot(ex,ey)
        base=max(0.0,float(building.get("base_m") or 0.0))
        height=max(base+2.6,float(building.get("height_m") or 9.0))
        if length<1.5:continue

        im=Image.open(path).convert("RGB")
        im.thumbnail((1280,960),Image.Resampling.LANCZOS)
        rgb=np.asarray(im,dtype=np.uint8);h,w=rgb.shape[:2]
        coords=source.get("coordinates")
        if not (isinstance(coords,list) and len(coords)>=2):continue
        cx,cy=local_xy(float(coords[0]),float(coords[1]),origin)
        midx,midy=(ax+bx)*.5,(ay+by)*.5
        heading=source.get("heading")
        if not isinstance(heading,(int,float)):
            heading=(math.degrees(math.atan2(midx-cx,midy-cy))+360.0)%360.0
        panoramic=bool(source.get("panoramic"))
        hfov=360.0 if panoramic else max(35.0,min(115.0,float(source.get("fov") or 78.0)))
        if panoramic:vfov=180.0
        else:
            vfov=math.degrees(2.0*math.atan(math.tan(math.radians(hfov)*.5)*h/max(w,1)))
            vfov=max(28.0,min(100.0,vfov))
        pitch=float(source.get("pitch") or 0.0) if isinstance(source.get("pitch"),(int,float)) else 0.0

        # Build a metric grid on the exact OSM wall plane, then sample the
        # corresponding pixels using the geotagged camera ray. This preserves
        # map geometry while retaining observed facade appearance.
        aspect=max(length/(height-base),.2)
        nz=max(30,int(math.sqrt(per_source/max(aspect,1e-3))))
        nx=max(34,int(nz*aspect))
        if nx*nz>per_source:
            scale=math.sqrt(per_source/(nx*nz));nx=max(28,int(nx*scale));nz=max(26,int(nz*scale))
        ts=np.linspace(.012,.988,nx,dtype=np.float32)
        zs=np.linspace(base+.05,height-.05,nz,dtype=np.float32)
        tt,zz=np.meshgrid(ts,zs)
        wx=ax+tt*ex;wy=ay+tt*ey
        dx=wx-cx;dy=wy-cy
        dist=np.maximum(np.sqrt(dx*dx+dy*dy),.5)
        bearings=(np.degrees(np.arctan2(dx,dy))+360.0)%360.0
        rel=((bearings-float(heading)+540.0)%360.0)-180.0
        if panoramic:
            xn=(.5+rel/360.0)%1.0
        else:
            xn=.5+rel/hfov
        elev=np.degrees(np.arctan2(zz-1.65,dist))
        yn=.5-(elev-pitch)/vfov
        valid=(yn>=.015)&(yn<=.985)
        if not panoramic:valid&=(xn>=.015)&(xn<=.985)
        if not valid.any():continue
        px=np.clip(np.rint(xn*(w-1)),0,w-1).astype(np.int32)
        py=np.clip(np.rint(yn*(h-1)),0,h-1).astype(np.int32)
        col=rgb[py,px].astype(np.float32)/255.0
        # Remove only high-confidence sky samples. Lower facade/storefront
        # pixels remain observed rather than being procedurally repainted.
        sky=(yn<.48)&(col[...,2]>col[...,0]*1.10)&(col[...,2]>col[...,1]*1.05)&(col[...,2]>.48)
        masked+=int(np.count_nonzero(valid&sky));valid&=~sky
        if np.count_nonzero(valid)<900:continue

        p=np.column_stack([wx[valid],wy[valid],zz[valid]]).astype(np.float32)
        cols=col[valid].astype(np.float32)
        center=np.clip(1.0-np.abs(xn[valid]-.5)*1.55,0.0,1.0)
        vertical=np.clip(1.0-np.abs(yn[valid]-.52)*.85,0.0,1.0)
        match=source.get("match") if isinstance(source.get("match"),dict) else {}
        q=float(match.get("quality") or (.36 if is_inferred else .58))
        q=max(.12,min(1.0,q))
        cf=np.clip(.44+.28*center+.12*vertical+.14*q-(.10 if is_inferred else 0),.24,.96).astype(np.float32)

        du=max(.025,length/max(nx-1,1));dz=max(.025,(height-base)/max(nz-1,1))
        depth_scale=max(.018,min(.065,du*.18))
        scales=np.column_stack([
            np.full(len(p),du*.72,np.float32),
            np.full(len(p),depth_scale,np.float32),
            np.full(len(p),dz*.72,np.float32)
        ])
        theta=math.atan2(ey,ex)
        quat=np.zeros((len(p),4),dtype=np.float32)
        quat[:,0]=math.cos(theta*.5);quat[:,3]=math.sin(theta*.5)

        all_points.append(p);all_colors.append(cols);all_conf.append(cf);all_scales.append(scales);all_quats.append(quat)
        used+=1;inferred+=1 if is_inferred else 0
        facades.add(str(building.get("building_id"))+":"+str(edge))

    if not all_points:raise RuntimeError("photoplane_no_visible_facades")
    pts=np.concatenate(all_points);cols=np.concatenate(all_colors);conf=np.concatenate(all_conf)
    scales=np.concatenate(all_scales);quats=np.concatenate(all_quats)
    if len(pts)>max_points:
        ids=np.argpartition(conf,-max_points)[-max_points:]
        pts,cols,conf,scales,quats=pts[ids],cols[ids],conf[ids],scales[ids],quats[ids]
    alignment={"method":"osm-facade-ray-projection","rms_m":0.0,"scale":1.0,"yaw_deg":0.0,"geo_cameras":used}
    stats={
      "backend":"open-pixel-osm-facade-projection","gpu":"CPU-lightweight","frames":used,
      "dynamic_removed":masked,"bundle_adjustment":False,"gaussian_optimized":False,
      "fallback":True,"projection":True,"inferred_facade_matches":inferred,
      "covered_facades":len(facades)
    }
    return pts,cols,conf,scales,quats,alignment,stats

def get_mapanything(device):
    global _MAPANYTHING_CACHE
    if _MAPANYTHING_CACHE is not None:return _MAPANYTHING_CACHE
    from mapanything.models import MapAnything
    model=MapAnything.from_pretrained(MAPANYTHING_MODEL).to(device).eval()
    _MAPANYTHING_CACHE=model
    return model

def invert_c2w(c2w:np.ndarray)->np.ndarray:
    out=[]
    for pose in c2w:
        inv=np.linalg.inv(pose.astype(np.float64)).astype(np.float32)
        out.append(inv[:3,:4])
    return np.stack(out)

def invert_w2c(extrinsic:np.ndarray)->np.ndarray:
    out=[]
    for pose in np.asarray(extrinsic):
        E=np.asarray(pose,dtype=np.float64)
        if E.shape!=(3,4):raise RuntimeError("extrinsic_shape")
        R=E[:,:3];t=E[:,3]
        H=np.eye(4,dtype=np.float64);H[:3,:3]=R.T;H[:3,3]=-R.T@t
        out.append(H.astype(np.float32))
    return np.stack(out)


def unproject_depth_np(depth:np.ndarray,extrinsic:np.ndarray,intrinsic:np.ndarray)->np.ndarray:
    maps=[]
    for d,E,K in zip(depth,extrinsic,intrinsic):
        if d.ndim==3:d=d[...,0]
        h,w=d.shape
        yy,xx=np.meshgrid(np.arange(h,dtype=np.float32),np.arange(w,dtype=np.float32),indexing="ij")
        z=d.astype(np.float32)
        fx,fy=max(float(K[0,0]),1e-6),max(float(K[1,1]),1e-6)
        x=(xx-float(K[0,2]))/fx*z
        y=(yy-float(K[1,2]))/fy*z
        cam=np.stack([x,y,z],axis=-1).reshape(-1,3)
        R=E[:,:3].astype(np.float32);t=E[:,3].astype(np.float32)
        world=(R.T@(cam-t[None,:]).T).T.reshape(h,w,3)
        maps.append(world)
    return np.stack(maps)

def mapanything_reconstruct(image_paths:list[str],sources:list[dict],job:Job):
    import torch
    from mapanything.utils.image import load_images
    if len(image_paths)<1:raise RuntimeError("mapanything_requires_one_view")
    device="cuda" if torch.cuda.is_available() else "cpu"
    if device=="cpu" and not HIGH_MEMORY_CPU and os.getenv("REALCITY_ALLOW_CPU_MAPANYTHING","false").lower()!="true":
        raise RuntimeError("high_memory_compute_required_for_mapanything")
    model=get_mapanything(device)
    views=load_images(image_paths,resolution_set=518,norm_type="dinov2",patch_size=14)
    with torch.inference_mode():
        preds=model.infer(
            views,
            memory_efficient_inference=True,
            minibatch_size=1,
            use_amp=device=="cuda",
            amp_dtype="bf16",
            apply_mask=True,
            mask_edges=True,
            apply_confidence_mask=False,
            confidence_percentile=8,
            use_multiview_confidence=len(views)>1,
        )
    if not preds:raise RuntimeError("mapanything_empty")
    points=[];confs=[];images=[];poses=[];intr=[];depths=[]
    for pred in preds:
        def arr(name):
            x=pred[name]
            if hasattr(x,"detach"):x=x.detach().float().cpu().numpy()
            return np.asarray(x)
        p=arr("pts3d");cf=arr("conf");im=arr("img_no_norm");pose=arr("camera_poses");K=arr("intrinsics");dep=arr("depth_z")
        if p.ndim==4:p=p[0]
        if cf.ndim==3:cf=cf[0]
        if im.ndim==4:im=im[0]
        if pose.ndim==3:pose=pose[0]
        if K.ndim==3:K=K[0]
        if dep.ndim==4:dep=dep[0]
        points.append(p.astype(np.float32));confs.append(cf.astype(np.float32));images.append(im.astype(np.float32))
        poses.append(pose.astype(np.float32));intr.append(K.astype(np.float32));depths.append(dep.astype(np.float32))
    p=np.stack(points);cf=np.stack(confs);ims_hwc=np.stack(images);c2w=np.stack(poses);intr_np=np.stack(intr);depth_np=np.stack(depths)
    if ims_hwc.max()>1.5:ims_hwc=ims_hwc/255.0
    ims_hwc=np.clip(ims_hwc,0,1)
    ex=invert_c2w(c2w)
    torch_images=torch.from_numpy(ims_hwc).permute(0,3,1,2).contiguous().float().to(device)
    dtype=torch.bfloat16 if device=="cuda" and torch.cuda.get_device_capability()[0]>=8 else (torch.float16 if device=="cuda" else torch.float32)
    ex2,intr2,ba=refine_cameras_with_ba(torch_images,cf,p,ex,intr_np,dtype)
    if ba.get("bundle_adjustment"):
        p=unproject_depth_np(depth_np,ex2,intr2)
        ex,intr_np=ex2,intr2
    anchor_c2w=invert_w2c(ex)
    centers=camera_centers(ex)
    target=int(job.policy.get("max_points",150000))
    ims_chw=ims_hwc.transpose(0,3,1,2)
    pts,cols,scores,frames=choose_samples(p,cf,ims_chw,target*4)
    pts,cols,scores,frames,dynamic_removed=multiview_filter(pts,cols,scores,frames)
    pts,cols,scores=voxel_reduce(pts,cols,scores,min(target,180000))
    pts,cols,scores,scales_xyz,quats,gs=gsplat_refine(pts,cols,scores,torch_images,ex,intr_np,cf)
    pts,centers,alignment=anchor_metric_points(pts,centers,anchor_c2w,sources,job.map_anchor["origin"],job.map_anchor)
    world_scale=float(alignment.get("scale",1.0));scales_xyz=scales_xyz*world_scale
    if alignment.get("rotation_matrix") is not None:
        quats=rotate_quats_matrix(quats,np.asarray(alignment["rotation_matrix"],dtype=np.float64))
    else:
        quats=rotate_quats_z(quats,float(alignment.get("yaw_deg",0.0)))
    radius=float(job.map_anchor.get("radius_m",190))*1.18
    m=(np.linalg.norm(pts[:,:2],axis=1)<=radius)&(pts[:,2]>-8)&(pts[:,2]<180)
    pts,cols,scores,scales_xyz,quats=pts[m],cols[m],scores[m],scales_xyz[m],quats[m]
    hardware=torch.cuda.get_device_name(0) if device=="cuda" else "CPU-high-memory"
    backend="mapanything-apache-1b"+("+colmap-ba" if ba.get("bundle_adjustment") else "")+("+gsplat" if gs.get("gaussian_optimized") else "")
    return pts,cols,scores,scales_xyz,quats,alignment,{
        "backend":backend,"gpu":hardware,"frames":len(image_paths),"dynamic_removed":dynamic_removed,
        "metric":True,"universal_3d":True,**ba,**gs
    }

def vggt_reconstruct(image_paths:list[str],sources:list[dict],job:Job):
    import torch
    from vggt.utils.load_fn import load_and_preprocess_images
    from vggt.utils.pose_enc import pose_encoding_to_extri_intri
    from vggt.utils.geometry import unproject_depth_map_to_point_map
    if not torch.cuda.is_available() and os.getenv("REALCITY_ALLOW_CPU_VGGT","false").lower()!="true":
        raise RuntimeError("cuda_required_for_photoreal_vggt")
    device="cuda" if torch.cuda.is_available() else "cpu"
    # Hugging Face reads HF_TOKEN from the environment for gated checkpoints.
    # Do not pass provider-specific kwargs through the model constructor.
    model=get_vggt(device)
    images=load_and_preprocess_images(image_paths).to(device)
    if images.ndim==4: images=images[None]
    major=torch.cuda.get_device_capability()[0] if device=="cuda" else 0
    dtype=torch.bfloat16 if major>=8 else torch.float16
    with torch.inference_mode():
        ctx=torch.autocast(device_type="cuda",dtype=dtype) if device=="cuda" else torch.no_grad()
        with ctx:
            tokens,ps_idx=model.aggregator(images)
            pose=model.camera_head(tokens)[-1]
            extr,intr=pose_encoding_to_extri_intri(pose,images.shape[-2:])
            depth,depth_conf=model.depth_head(tokens,images,ps_idx)
            points=unproject_depth_map_to_point_map(depth.squeeze(0),extr.squeeze(0),intr.squeeze(0))
    p=points.detach().float().cpu().numpy()
    cf=depth_conf.squeeze(0).detach().float().cpu().numpy()
    ims=images.squeeze(0).detach().float().cpu().numpy()
    ex=extr.squeeze(0).detach().float().cpu().numpy()
    intr_np=intr.squeeze(0).detach().float().cpu().numpy()
    ex,intr_np,ba=refine_cameras_with_ba(images.squeeze(0),cf,p,ex,intr_np,dtype)
    if ba.get("bundle_adjustment"):
        depth_np=depth.squeeze(0).detach().float().cpu().numpy()
        p=unproject_depth_map_to_point_map(depth_np,ex,intr_np)
    centers=camera_centers(ex)
    target=int(job.policy.get("max_points",150000))
    pts,cols,scores,frames=choose_samples(p,cf,ims,target*3)
    pts,cols,scores,frames,dynamic_removed=multiview_filter(pts,cols,scores,frames)
    pts,cols,scores=voxel_reduce(pts,cols,scores,min(target,140000))
    pts,cols,scores,scales_xyz,quats,gs=gsplat_refine(pts,cols,scores,images.squeeze(0),ex,intr_np,cf)
    pts,centers,alignment=anchor_points(pts,centers,sources,job.map_anchor["origin"],job.map_anchor)
    world_scale=float(alignment.get("scale",1.0));scales_xyz=scales_xyz*world_scale
    quats=rotate_quats_z(quats,float(alignment.get("yaw_deg",0.0)))
    radius=float(job.map_anchor.get("radius_m",190))*1.15
    m=(np.linalg.norm(pts[:,:2],axis=1)<=radius)&(pts[:,2]>-8)&(pts[:,2]<160)
    pts,cols,scores,scales_xyz,quats=pts[m],cols[m],scores[m],scales_xyz[m],quats[m]
    gpu=torch.cuda.get_device_name(0) if device=="cuda" else "CPU"
    backend="vggt-1b-commercial"+("+colmap-ba" if ba.get("bundle_adjustment") else "")+("+gsplat" if gs.get("gaussian_optimized") else "")
    return pts,cols,scores,scales_xyz,quats,alignment,{"backend":backend,"gpu":gpu,"frames":len(image_paths),"dynamic_removed":dynamic_removed,**ba,**gs}

def artifact_for(job:Job,points,colors,conf,scales_xyz,quats,alignment,stats):
    data,mn,mx,count=encode_rcsp2(points,colors,conf,scales_xyz,quats)
    anchor=job.map_anchor.get("hero") or {}
    source_meta=[{k:s.get(k) for k in ("id","kind","provider","license","license_url","attribution","page_url")} for s in job.sources]
    radial=np.linalg.norm(np.asarray(points,dtype=np.float32)[:,:2],axis=1) if len(points) else np.array([0.0],dtype=np.float32)
    observed_radius=float(np.percentile(radial[np.isfinite(radial)],98.5)) if np.any(np.isfinite(radial)) else 0.0
    declared_radius=float(job.map_anchor.get("radius_m",190))
    coverage_radius=max(12.0,min(declared_radius,observed_radius+6.0))
    quality={
      "geometry":"metric_multiview_mapanything" if stats.get("universal_3d") else ("osm_facade_ray_projection" if stats.get("projection") else ("gps_monocular_depth_fallback" if stats.get("fallback") else "dense_multi_view_depth")),
      "appearance":"source_pixels","alignment":alignment.get("method"),
      "confidence_mean":float(np.mean(conf)) if len(conf) else 0,
      "coverage_radius_m":coverage_radius,
      "declared_radius_m":declared_radius,
      "generated_pixels_only":False,
      "photogrammetric":not bool(stats.get("fallback")) and int(stats.get("frames",0))>=2,
      "metric_reconstruction":bool(stats.get("universal_3d")) or alignment.get("method") in ("gps-rigid-metric","gps-heading-metric")
    }
    return {
      "schema":1,"engine":ENGINE,"input_signature":job.input_signature,
      "target":job.target,"origin":job.map_anchor["origin"],"anchor":{"building_id":anchor.get("building_id"),"geometry_key":anchor.get("geometry_key")},
      "representation":"gaussian-splats-v2",
      "chunks":[{"id":"near","lod":0,"codec":"rcsp2-base64","point_count":count,"data":data,"bounds_min":mn,"bounds_max":mx,"min_zoom":16.7,"max_zoom":24}],
      "alignment":alignment,"quality":quality,"sources":source_meta,
      "stats":{**stats,"points":count,"confidence_mean":quality["confidence_mean"],"dynamic_removed":int(stats.get("dynamic_removed",0))}
    }

async def callback(job:Job,status:str,artifact=None,error=None):
    body={"job_id":job.job_id,"input_signature":job.input_signature,"status":status}
    if artifact is not None: body["artifact"]=artifact
    if error: body["error"]=str(error)[:500]
    body["signature"]=sign_callback(body)
    async with httpx.AsyncClient(timeout=30) as c:
        r=await c.post(job.callback["url"],json=body,headers={"User-Agent":"Shaurmeg-RealCity-Photoreal/1.0"})
        r.raise_for_status()

async def run_job(job:Job):
    async with SEM:
        root=Path(tempfile.mkdtemp(prefix="realcity_"))
        try:
            requested=max(1,min(int(job.policy.get("max_frames",24)),len(job.sources)))
            selected=job.sources[:frame_budget(requested)]
            paths=[];kept=[];source_errors=[];fallback_sources=0
            for i,s in enumerate(selected):
                try:
                    p=root/f"{i:03d}.jpg"
                    loaded=await load_source_image(s,p)
                    paths.append(str(p));kept.append(s)
                    fallback_sources+=1 if loaded.get("fallback_used") else 0
                    print("RealCity source ready",{"provider":s.get("provider"),"id":s.get("id"),"host":loaded.get("host"),"fallback":loaded.get("fallback_used")},flush=True)
                except Exception as exc:
                    msg=str(exc)[:240];source_errors.append(msg)
                    print("RealCity source rejected",msg,flush=True)
            if len(paths)<1:
                raise RuntimeError("no_decodable_views: "+"; ".join(source_errors[:4]))

            loop=asyncio.get_running_loop()
            if LIGHTWEIGHT_CPU:
                points,colors,conf,scales_xyz,quats,alignment,stats=await loop.run_in_executor(None,facade_plane_reconstruct,paths,kept,job)
                stats["primary_error"]="cpu_memory_safe_photoplane";stats["source_fetch_errors"]=source_errors[:8];stats["fallback_sources"]=fallback_sources
            else:
                primary_errors=[];points=None
                # MapAnything is metric and explicitly supports monocular as well
                # as multi-view reconstruction, so it must be attempted before
                # the one/two-view fallback.
                if MAX_BACKEND in ("mapanything","auto"):
                    try:
                        points,colors,conf,scales_xyz,quats,alignment,stats=await loop.run_in_executor(None,mapanything_reconstruct,paths,kept,job)
                    except Exception as exc:
                        primary_errors.append("mapanything:"+str(exc)[:160]);points=None
                if points is None and len(paths)>=3 and MAX_BACKEND in ("vggt","auto","mapanything"):
                    try:
                        points,colors,conf,scales_xyz,quats,alignment,stats=await loop.run_in_executor(None,vggt_reconstruct,paths,kept,job)
                    except Exception as exc:
                        primary_errors.append("vggt:"+str(exc)[:160]);points=None
                if points is None:
                    if not ALLOW_DEPTH_FALLBACK:raise RuntimeError("; ".join(primary_errors) or "max_reconstruction_unavailable")
                    print("MAX paths unavailable; using metric depth fallback:",primary_errors,flush=True)
                    points,colors,conf,scales_xyz,quats,alignment,stats=await loop.run_in_executor(None,gps_depth_reconstruct,paths,kept,job)
                    stats["primary_error"]="; ".join(primary_errors)[:360] or ("partial_view_metric_fallback" if len(paths)<3 else "metric_depth_fallback")
                    stats["source_fetch_errors"]=source_errors[:8];stats["fallback_sources"]=fallback_sources
            if len(points)<5000: raise RuntimeError("reconstruction_too_sparse")
            artifact=artifact_for(job,points,colors,conf,scales_xyz,quats,alignment,stats)
            await callback(job,"ready",artifact=artifact)
        except Exception as e:
            traceback.print_exc()
            try: await callback(job,"failed",error=e)
            except Exception: traceback.print_exc()
        finally:
            shutil.rmtree(root,ignore_errors=True)

@app.get("/health")
async def health():
    if LIGHTWEIGHT_CPU:
        cuda=False;gpu=""
    else:
        try:
            import torch
            cuda=torch.cuda.is_available()
            gpu=torch.cuda.get_device_name(0) if cuda else ""
        except Exception:
            cuda=False;gpu=""
    return {"ok":True,"version":APP_VERSION,"cuda":cuda,"gpu":gpu,"model":"osm-photoplane" if LIGHTWEIGHT_CPU else MAPANYTHING_MODEL,"secondary_model":None if LIGHTWEIGHT_CPU else VGGT_MODEL,"max_backend":MAX_BACKEND,"commercial_checkpoint_required":False if MAX_BACKEND=="mapanything" else not LIGHTWEIGHT_CPU,"depth_fallback":ALLOW_DEPTH_FALLBACK,"depth_model":None if LIGHTWEIGHT_CPU else DEPTH_MODEL,"lightweight_cpu":LIGHTWEIGHT_CPU,"high_memory_cpu":HIGH_MEMORY_CPU,"frame_budget_max":32 if HIGH_MEMORY_CPU else (12 if LIGHTWEIGHT_CPU else None)}

@app.post("/v1/jobs")
async def create_job(job:Job,request:Request,tasks:BackgroundTasks):
    if TOKEN and request.headers.get("authorization")!="Bearer "+TOKEN:
        raise HTTPException(401,"unauthorized")
    if job.schema!=1 or not job.job_id.startswith("rc_") or len(job.sources)<1:
        raise HTTPException(422,"invalid_job")
    tasks.add_task(run_job,job)
    return {"accepted":True,"job_id":job.job_id,"worker":APP_VERSION}
