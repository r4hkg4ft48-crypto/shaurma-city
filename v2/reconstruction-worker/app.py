from __future__ import annotations
import os, io, json, math, base64, hmac, hashlib, asyncio, tempfile, shutil, traceback
from pathlib import Path
from typing import Any
import numpy as np
import httpx
from PIL import Image
from fastapi import FastAPI, HTTPException, BackgroundTasks, Request
from pydantic import BaseModel, Field

APP_VERSION="realcity-photoreal-worker-v1"
ENGINE="realcity-photoreal-v1"
TOKEN=os.getenv("REALCITY_WORKER_TOKEN","")
CALLBACK_SECRET=os.getenv("REALCITY_CALLBACK_SECRET","")
VGGT_MODEL=os.getenv("REALCITY_VGGT_MODEL","facebook/VGGT-1B-Commercial")
HF_TOKEN=os.getenv("HF_TOKEN","")
MAX_DOWNLOAD=20*1024*1024
WORKERS=max(1,int(os.getenv("REALCITY_GPU_CONCURRENCY","1")))
SEM=asyncio.Semaphore(WORKERS)
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

def sign_callback(body:dict)->str:
    raw="callback:"+json.dumps(body,separators=(",",":"),ensure_ascii=False)
    return hmac.new(CALLBACK_SECRET.encode(),raw.encode(),hashlib.sha256).hexdigest()

def local_xy(lon:float,lat:float,origin:list[float])->tuple[float,float]:
    lat0=math.radians(origin[1])
    x=(lon-origin[0])*111320.0*max(.15,math.cos(lat0))
    y=(lat-origin[1])*110540.0
    return x,y

async def download(url:str)->bytes:
    async with httpx.AsyncClient(timeout=25,follow_redirects=True,headers={"User-Agent":"Shaurmeg-RealCity-Photoreal/1.0"}) as c:
        r=await c.get(url)
        r.raise_for_status()
        ct=r.headers.get("content-type","").lower()
        if not ct.startswith("image/"):
            raise RuntimeError("source_not_image")
        data=r.content
        if not data or len(data)>MAX_DOWNLOAD:
            raise RuntimeError("source_too_large")
        return data

def prepare_image(data:bytes,path:Path,max_side:int=1600)->dict:
    im=Image.open(io.BytesIO(data)).convert("RGB")
    w,h=im.size
    scale=min(1.0,max_side/max(w,h))
    if scale<1:
        im=im.resize((max(32,round(w*scale)),max(32,round(h*scale))),Image.Resampling.LANCZOS)
    im.save(path,quality=94,subsampling=0)
    return {"width":im.width,"height":im.height,"original_width":w,"original_height":h}

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
            return points,centers,{"method":method,"rms_m":rms,"scale":scale,"geo_cameras":len(geo_src)}
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
    return points,centers,{"method":method,"rms_m":None,"scale":float(scale),"geo_cameras":len(geo_src)}

def choose_samples(point_maps:np.ndarray,conf:np.ndarray,images:np.ndarray,target:int):
    # point_maps: N,H,W,3; conf N,H,W. Sample high-confidence static-looking
    # pixels. Upper sky band and invalid/extreme depths are rejected.
    N,H,W,_=point_maps.shape
    colors=np.clip(images.transpose(0,2,3,1),0,1)
    pts=[];cols=[];scores=[]
    per=max(2500,target//max(1,N))
    for i in range(N):
        p=point_maps[i].reshape(-1,3)
        c=colors[i].reshape(-1,3)
        cf=conf[i].reshape(-1)
        yy=np.repeat(np.arange(H),W)
        finite=np.isfinite(p).all(1)&np.isfinite(cf)&(cf>0)&(yy>H*.08)
        # Reject gross depth outliers before confidence ranking.
        d=np.linalg.norm(p,axis=1)
        goodd=d[finite]
        if goodd.size:
            lo,hi=np.percentile(goodd,[1,98.5]);finite&=(d>=lo)&(d<=hi)
        ids=np.flatnonzero(finite)
        if not len(ids): continue
        k=min(per,len(ids))
        best=ids[np.argpartition(cf[ids],-k)[-k:]]
        pts.append(p[best]);cols.append(c[best]);scores.append(cf[best])
    if not pts: raise RuntimeError("no_confident_points")
    return np.concatenate(pts),np.concatenate(cols),np.concatenate(scores)

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

def encode_rcsp(points:np.ndarray,colors:np.ndarray,conf:np.ndarray):
    mn=np.percentile(points,.2,axis=0).astype(np.float32)
    mx=np.percentile(points,99.8,axis=0).astype(np.float32)
    pad=np.maximum((mx-mn)*.015,.05);mn-=pad;mx+=pad
    keep=np.all((points>=mn)&(points<=mx),axis=1)
    points,colors,conf=points[keep],colors[keep],conf[keep]
    mid=(mn+mx)/2;half=np.maximum((mx-mn)/2,1e-4)
    q=np.clip(np.round((points-mid)/half*32767),-32767,32767).astype("<i2")
    rgb=np.clip(np.round(colors*255),0,255).astype(np.uint8)
    cf=np.clip((conf-np.percentile(conf,5))/max(np.percentile(conf,95)-np.percentile(conf,5),1e-6),0,1)
    cu=np.round(cf*255).astype(np.uint8)
    # radius encodes 2cm..34cm, larger for lower confidence to close tiny holes.
    radius=np.clip(np.round((.035+(1-cf)*.09)/.0015),1,255).astype(np.uint8)
    semantic=np.zeros(len(points),dtype=np.uint8)
    semantic[points[:,2]<.35]=2
    rec=np.empty((len(points),12),dtype=np.uint8)
    rec[:,:6]=q.view(np.uint8).reshape(-1,6)
    rec[:,6:9]=rgb;rec[:,9]=radius;rec[:,10]=cu;rec[:,11]=semantic
    return base64.b64encode(rec.tobytes()).decode(),mn.tolist(),mx.tolist(),len(points)

def vggt_reconstruct(image_paths:list[str],sources:list[dict],job:Job):
    import torch
    from vggt.models.vggt import VGGT
    from vggt.utils.load_fn import load_and_preprocess_images
    from vggt.utils.pose_enc import pose_encoding_to_extri_intri
    from vggt.utils.geometry import unproject_depth_map_to_point_map
    if not torch.cuda.is_available() and os.getenv("REALCITY_ALLOW_CPU_VGGT","false").lower()!="true":
        raise RuntimeError("cuda_required_for_photoreal_vggt")
    device="cuda" if torch.cuda.is_available() else "cpu"
    model=VGGT.from_pretrained(VGGT_MODEL,token=HF_TOKEN or None).to(device).eval()
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
    centers=camera_centers(ex)
    target=int(job.policy.get("max_points",150000))
    pts,cols,scores=choose_samples(p,cf,ims,target*2)
    pts,centers,alignment=anchor_points(pts,centers,sources,job.map_anchor["origin"],job.map_anchor)
    radius=float(job.map_anchor.get("radius_m",190))*1.15
    m=(np.linalg.norm(pts[:,:2],axis=1)<=radius)&(pts[:,2]>-8)&(pts[:,2]<160)
    pts,cols,scores=pts[m],cols[m],scores[m]
    pts,cols,scores=voxel_reduce(pts,cols,scores,target)
    gpu=torch.cuda.get_device_name(0) if device=="cuda" else "CPU"
    return pts,cols,scores,alignment,{"backend":"vggt-1b-commercial","gpu":gpu,"frames":len(image_paths)}

def artifact_for(job:Job,points,colors,conf,alignment,stats):
    data,mn,mx,count=encode_rcsp(points,colors,conf)
    anchor=job.map_anchor.get("hero") or {}
    source_meta=[{k:s.get(k) for k in ("id","kind","provider","license","license_url","attribution","page_url")} for s in job.sources]
    quality={
      "geometry":"dense_multi_view_depth","appearance":"source_pixels","alignment":alignment.get("method"),
      "confidence_mean":float(np.mean(conf)) if len(conf) else 0,
      "coverage_radius_m":float(job.map_anchor.get("radius_m",190)),
      "generated_pixels_only":False
    }
    return {
      "schema":1,"engine":ENGINE,"input_signature":job.input_signature,
      "target":job.target,"origin":job.map_anchor["origin"],"anchor":{"building_id":anchor.get("building_id"),"geometry_key":anchor.get("geometry_key")},
      "representation":"photometric-splats-v1",
      "chunks":[{"id":"near","lod":0,"codec":"rcsp1-base64","point_count":count,"data":data,"bounds_min":mn,"bounds_max":mx,"min_zoom":16.7,"max_zoom":24}],
      "alignment":alignment,"quality":quality,"sources":source_meta,
      "stats":{**stats,"points":count,"confidence_mean":quality["confidence_mean"],"dynamic_removed":0}
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
            selected=job.sources[:max(3,min(int(job.policy.get("max_frames",24)),len(job.sources)))]
            paths=[];kept=[]
            for i,s in enumerate(selected):
                try:
                    data=await download(str(s["url"]))
                    p=root/f"{i:03d}.jpg";prepare_image(data,p);paths.append(str(p));kept.append(s)
                except Exception:
                    continue
            if len(paths)<3: raise RuntimeError("not_enough_decodable_views")
            loop=asyncio.get_running_loop()
            points,colors,conf,alignment,stats=await loop.run_in_executor(None,vggt_reconstruct,paths,kept,job)
            if len(points)<5000: raise RuntimeError("reconstruction_too_sparse")
            artifact=artifact_for(job,points,colors,conf,alignment,stats)
            await callback(job,"ready",artifact=artifact)
        except Exception as e:
            traceback.print_exc()
            try: await callback(job,"failed",error=e)
            except Exception: traceback.print_exc()
        finally:
            shutil.rmtree(root,ignore_errors=True)

@app.get("/health")
async def health():
    try:
        import torch
        cuda=torch.cuda.is_available()
        gpu=torch.cuda.get_device_name(0) if cuda else ""
    except Exception:
        cuda=False;gpu=""
    return {"ok":True,"version":APP_VERSION,"cuda":cuda,"gpu":gpu,"model":VGGT_MODEL,"commercial_checkpoint_required":True}

@app.post("/v1/jobs")
async def create_job(job:Job,request:Request,tasks:BackgroundTasks):
    if TOKEN and request.headers.get("authorization")!="Bearer "+TOKEN:
        raise HTTPException(401,"unauthorized")
    if job.schema!=1 or not job.job_id.startswith("rc_") or len(job.sources)<3:
        raise HTTPException(422,"invalid_job")
    tasks.add_task(run_job,job)
    return {"accepted":True,"job_id":job.job_id,"worker":APP_VERSION}
