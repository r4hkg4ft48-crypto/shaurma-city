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
DEPTH_MODEL=os.getenv("REALCITY_DEPTH_MODEL","depth-anything/Depth-Anything-V2-Metric-Outdoor-Small-hf")
HF_TOKEN=os.getenv("HF_TOKEN","")
MAX_DOWNLOAD=20*1024*1024
WORKERS=max(1,int(os.getenv("REALCITY_GPU_CONCURRENCY","1")))
USE_BA=os.getenv("REALCITY_USE_BA","true").lower() not in ("0","false","off","no")
USE_GSPLAT=os.getenv("REALCITY_USE_GSPLAT","true").lower() not in ("0","false","off","no")
GSPLAT_STEPS=max(120,min(1800,int(os.getenv("REALCITY_GSPLAT_STEPS","720"))))
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

def vggt_reconstruct(image_paths:list[str],sources:list[dict],job:Job):
    import torch
    from vggt.models.vggt import VGGT
    from vggt.utils.load_fn import load_and_preprocess_images
    from vggt.utils.pose_enc import pose_encoding_to_extri_intri
    from vggt.utils.geometry import unproject_depth_map_to_point_map
    if not torch.cuda.is_available() and os.getenv("REALCITY_ALLOW_CPU_VGGT","false").lower()!="true":
        raise RuntimeError("cuda_required_for_photoreal_vggt")
    device="cuda" if torch.cuda.is_available() else "cpu"
    # Hugging Face reads HF_TOKEN from the environment for gated checkpoints.
    # Do not pass provider-specific kwargs through the model constructor.
    model=VGGT.from_pretrained(VGGT_MODEL).to(device).eval()
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
        for b in job.map_anchor.get("buildings",[]):
            if str(b.get("building_id"))!=bid:continue
            ring=b.get("ring") or []
            if 0<=edge<len(ring)-1:
                a,z=ring[edge],ring[edge+1]
                return [(float(a[0])+float(z[0]))/2,(float(a[1])+float(z[1]))/2]
    return job.target.get("coordinates") or job.map_anchor.get("origin",[])[:2]

def metric_depth_reconstruct(image_paths:list[str],sources:list[dict],job:Job,reason:str=""):
    import torch
    from transformers import AutoImageProcessor,AutoModelForDepthEstimation
    device="cuda" if torch.cuda.is_available() else "cpu"
    processor=AutoImageProcessor.from_pretrained(DEPTH_MODEL)
    model=AutoModelForDepthEstimation.from_pretrained(DEPTH_MODEL).to(device).eval()
    origin=job.map_anchor["origin"][:2]
    radius=float(job.map_anchor.get("radius_m",190))
    target_points=int(job.policy.get("max_points",150000))
    pts_all=[];cols_all=[];conf_all=[];used=[]
    for path,source in zip(image_paths,sources):
        coords=source.get("coordinates")
        if not isinstance(coords,list) or len(coords)<2 or not all(isinstance(v,(int,float)) for v in coords[:2]):
            continue
        im=Image.open(path).convert("RGB")
        arr=np.asarray(im,dtype=np.uint8);h,w=arr.shape[:2]
        inputs=processor(images=im,return_tensors="pt")
        inputs={k:v.to(device) for k,v in inputs.items()}
        with torch.inference_mode():
            ctx=torch.autocast("cuda",dtype=torch.float16) if device=="cuda" else torch.no_grad()
            with ctx:pred=model(**inputs).predicted_depth
        depth=torch.nn.functional.interpolate(pred.unsqueeze(1),size=(h,w),mode="bicubic",align_corners=False).squeeze().float().cpu().numpy()
        depth=np.clip(np.nan_to_num(depth,nan=0.0,posinf=80.0,neginf=0.0),.55,80.0)
        match=source.get("match") if isinstance(source.get("match"),dict) else {}
        anchor=match.get("distance_m") if isinstance(match.get("distance_m"),(int,float)) else source.get("distance_m")
        if isinstance(anchor,(int,float)) and math.isfinite(float(anchor)) and float(anchor)>3:
            roi=depth[int(h*.32):int(h*.72),int(w*.34):int(w*.66)]
            valid=roi[(roi>.6)&(roi<80)]
            if valid.size>100:
                ratio=float(anchor)/max(float(np.median(valid)),.5)
                if .5<=ratio<=2.0:depth=np.clip(depth*ratio,.55,100)
        target=source_target(source,job)
        heading=source.get("heading")
        if not isinstance(heading,(int,float)) or not math.isfinite(float(heading)):
            heading=bearing_deg(coords,target)
        fov=float(source.get("fov") or (90 if source.get("panoramic") else 78))
        fov=max(38,min(110,fov))
        fx=w/(2*math.tan(math.radians(fov)/2));fy=fx
        yaw=math.radians(float(heading))
        forward=np.array([math.sin(yaw),math.cos(yaw),0],np.float32)
        right=np.array([math.cos(yaw),-math.sin(yaw),0],np.float32)
        up=np.array([0,0,1],np.float32)
        desired=max(18000,min(70000,int(target_points*2/max(1,len(image_paths)))))
        stride=max(1,int(math.sqrt((w*h)/desired)))
        ys=np.arange(stride//2,h,stride,dtype=np.int32);xs=np.arange(stride//2,w,stride,dtype=np.int32)
        xx,yy=np.meshgrid(xs,ys);z=depth[yy,xx]
        xn=(xx.astype(np.float32)-(w-1)/2)/fx;yn=(yy.astype(np.float32)-(h-1)/2)/fy
        rays=forward[None,None,:]+xn[...,None]*right[None,None,:]-yn[...,None]*up[None,None,:]
        rays/=np.maximum(np.linalg.norm(rays,axis=2,keepdims=True),1e-6)
        cx,cy=local_xy(float(coords[0]),float(coords[1]),origin)
        pts=np.array([cx,cy,1.65],np.float32)[None,None,:]+rays*z[...,None]
        col=arr[yy,xx].astype(np.float32)/255.0
        rr=np.linalg.norm(pts[...,:2],axis=2)
        upper=yy<h*.48;blue=(col[...,2]>col[...,0]*1.08)&(col[...,2]>col[...,1]*1.03)&(col[...,2]>.42)
        valid=np.isfinite(pts).all(axis=2)&(rr<radius*1.18)&(pts[...,2]>-3)&(pts[...,2]<70)&~(upper&blue&(z>25))
        if valid.any():
            p=pts[valid];co=col[valid];cf=np.clip(1.0-z[valid]/150.0,.35,.98).astype(np.float32)
            pts_all.append(p);cols_all.append(co);conf_all.append(cf);used.append(source)
    if not pts_all:raise RuntimeError("metric_fallback_no_geotagged_views")
    points=np.concatenate(pts_all);colors=np.concatenate(cols_all);conf=np.concatenate(conf_all)
    points,colors,conf=voxel_reduce(points,colors,conf,min(target_points,180000))
    if len(points)<4000:raise RuntimeError("metric_fallback_too_sparse")
    dist=np.linalg.norm(points[:,:2],axis=1)
    s=np.clip(.045+dist*.0018,.045,.24).astype(np.float32)
    scales=np.column_stack([s,s,np.clip(s*.42,.018,.11)]).astype(np.float32)
    quats=np.zeros((len(points),4),np.float32);quats[:,0]=1
    alignment={"method":"gps-metric-depth+osm-facade-heading","rms_m":None,"scale":1.0,"yaw_deg":0.0,"geo_cameras":len(used)}
    gpu=torch.cuda.get_device_name(0) if device=="cuda" else "CPU"
    stats={"backend":"depth-anything-v2-metric-outdoor-fallback","gpu":gpu,"frames":len(used),"dynamic_removed":0,
           "gaussian_optimized":False,"fallback_reason":str(reason)[:180]}
    return points,colors,conf,scales,quats,alignment,stats

def reconstruct_best(image_paths:list[str],sources:list[dict],job:Job):
    try:
        return vggt_reconstruct(image_paths,sources,job)
    except Exception as exc:
        print("VGGT commercial path unavailable; using metric fallback:",repr(exc),flush=True)
        return metric_depth_reconstruct(image_paths,sources,job,reason=str(exc))

def artifact_for(job:Job,points,colors,conf,scales_xyz,quats,alignment,stats):
    data,mn,mx,count=encode_rcsp2(points,colors,conf,scales_xyz,quats)
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
            points,colors,conf,scales_xyz,quats,alignment,stats=await loop.run_in_executor(None,reconstruct_best,paths,kept,job)
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
    try:
        import torch
        cuda=torch.cuda.is_available()
        gpu=torch.cuda.get_device_name(0) if cuda else ""
    except Exception:
        cuda=False;gpu=""
    return {"ok":True,"version":APP_VERSION,"cuda":cuda,"gpu":gpu,"model":VGGT_MODEL,"fallback_model":DEPTH_MODEL,"commercial_checkpoint_required_for_max_quality":True}

@app.post("/v1/jobs")
async def create_job(job:Job,request:Request,tasks:BackgroundTasks):
    if TOKEN and request.headers.get("authorization")!="Bearer "+TOKEN:
        raise HTTPException(401,"unauthorized")
    if job.schema!=1 or not job.job_id.startswith("rc_") or len(job.sources)<3:
        raise HTTPException(422,"invalid_job")
    tasks.add_task(run_job,job)
    return {"accepted":True,"job_id":job.job_id,"worker":APP_VERSION}
