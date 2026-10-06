#!/usr/bin/env python3
"""
RealCity Reconstruction Worker v1.

Production goal: reconstruct the *appearance* of a real local quarter from
license-safe street imagery while preserving OSM/OpenFreeMap as metric truth.

The first production engine uses Depth Anything V2 Small (Apache-2.0) to
produce dense per-view geometry, GPS/heading priors to georegister views, and
multi-view voxel fusion to generate a compact colored-surface representation.

Output RCS1 is a streaming surfel format:
  header <4sHHII  -> magic, version, stride, count, flags
  point  <fffBBBBf -> local ENU x/y/z metres, RGBA, surfel radius metres
"""
from __future__ import annotations

import io
import json
import math
import os
import struct
import tempfile
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

import cv2
import numpy as np
import requests
from PIL import Image

API=os.getenv("REALCITY_API_URL","https://shaurma-city-api.onrender.com").rstrip("/")
TOKEN=os.getenv("REALCITY_RECONSTRUCTION_WORKER_TOKEN","").strip()
WORKER_ID=os.getenv("REALCITY_WORKER_ID",f"realcity-{uuid.uuid4().hex[:10]}")
POLL=max(2,float(os.getenv("REALCITY_WORKER_POLL_SECONDS","8")))
MODEL_ID=os.getenv("REALCITY_DEPTH_MODEL","depth-anything/Depth-Anything-V2-Metric-Outdoor-Small-hf")
DEVICE_PREF=os.getenv("REALCITY_DEVICE","cuda").strip().lower()
MAX_DOWNLOAD_MB=max(4,min(40,int(os.getenv("REALCITY_SOURCE_MAX_MB","18"))))
TIMEOUT=(8,35)
ALLOWED_HOST_SUFFIXES=(
    "wikimedia.org","wikimediausercontent.com","panoramax.xyz","panoramax.fr",
    "openstreetcam.org","kartaview.org","mapillary.com","fbcdn.net"
)

session=requests.Session()
session.headers.update({"User-Agent":"Shaurmeg-RealCity-Reconstruction/1.0"})

@dataclass
class Frame:
    source: dict
    image: np.ndarray
    depth: np.ndarray | None = None
    sharpness: float = 0.0
    overlap: float = 0.0

def api(path:str)->str:
    return API+path

def auth_headers(extra=None):
    h={"x-realcity-worker-token":TOKEN}
    if extra:h.update(extra)
    return h

def safe_source_url(url:str)->bool:
    try:
        p=urlparse(url)
        if p.scheme!="https" or not p.hostname:return False
        host=p.hostname.lower()
        return any(host==s or host.endswith("."+s) for s in ALLOWED_HOST_SUFFIXES)
    except Exception:
        return False

def claim():
    r=session.post(api("/api/v2/internal/realcity/reconstruction/claim"),json={"worker_id":WORKER_ID},headers=auth_headers(),timeout=TIMEOUT)
    r.raise_for_status()
    j=r.json()
    return j if j.get("job_id") else None

def heartbeat(job_id,stage,**report):
    try:
        session.post(api(f"/api/v2/internal/realcity/reconstruction/jobs/{job_id}/heartbeat"),
                     json={"worker_id":WORKER_ID,"report":{"stage":stage,**report}},
                     headers=auth_headers(),timeout=TIMEOUT).raise_for_status()
    except Exception as exc:
        print("heartbeat",stage,exc,flush=True)

def download_source(source:dict)->np.ndarray|None:
    url=str(source.get("image_url") or "")
    if not safe_source_url(url):
        return None
    try:
        with session.get(url,stream=True,timeout=TIMEOUT,allow_redirects=True) as r:
            r.raise_for_status()
            final=str(r.url)
            if not safe_source_url(final):return None
            length=int(r.headers.get("content-length") or 0)
            if length>MAX_DOWNLOAD_MB*1024*1024:return None
            buf=bytearray()
            for chunk in r.iter_content(256*1024):
                buf.extend(chunk)
                if len(buf)>MAX_DOWNLOAD_MB*1024*1024:return None
        im=Image.open(io.BytesIO(buf)).convert("RGB")
        w,h=im.size
        if max(w,h)>2048:
            scale=2048/max(w,h)
            im=im.resize((max(1,int(w*scale)),max(1,int(h*scale))),Image.Resampling.LANCZOS)
        return np.asarray(im)
    except Exception as exc:
        print("source",source.get("source"),source.get("id"),"skip",exc,flush=True)
        return None

def sharpness(rgb:np.ndarray)->float:
    g=cv2.cvtColor(rgb,cv2.COLOR_RGB2GRAY)
    if max(g.shape)>900:
        scale=900/max(g.shape)
        g=cv2.resize(g,None,fx=scale,fy=scale,interpolation=cv2.INTER_AREA)
    return float(cv2.Laplacian(g,cv2.CV_32F).var())

def sift_overlap(a:np.ndarray,b:np.ndarray)->float:
    try:
        def prep(x):
            g=cv2.cvtColor(x,cv2.COLOR_RGB2GRAY)
            scale=min(1.0,900/max(g.shape))
            return cv2.resize(g,None,fx=scale,fy=scale,interpolation=cv2.INTER_AREA) if scale<1 else g
        aa,bb=prep(a),prep(b)
        sift=cv2.SIFT_create(nfeatures=1800,contrastThreshold=.025)
        ka,da=sift.detectAndCompute(aa,None);kb,db=sift.detectAndCompute(bb,None)
        if da is None or db is None or len(ka)<12 or len(kb)<12:return 0.0
        pairs=cv2.BFMatcher(cv2.NORM_L2).knnMatch(da,db,k=2)
        good=[m for m,n in pairs if m.distance<.72*n.distance]
        if len(good)<10:return 0.0
        return min(1.0,len(good)/80.0)
    except Exception:
        return 0.0

def umeyama_similarity(source:np.ndarray,target:np.ndarray):
    source=np.asarray(source,np.float64);target=np.asarray(target,np.float64)
    if len(source)<3 or source.shape!=target.shape:return None
    mx=source.mean(axis=0);my=target.mean(axis=0)
    x=source-mx;y=target-my
    var=float(np.mean(np.sum(x*x,axis=1)))
    if var<1e-8:return None
    cov=(y.T@x)/len(source)
    u,s,vt=np.linalg.svd(cov)
    d=np.eye(3)
    if np.linalg.det(u@vt)<0:d[-1,-1]=-1
    rot=u@d@vt
    scale=float(np.sum(s*np.diag(d))/var)
    if not np.isfinite(scale) or scale<=0:return None
    trans=my-scale*(rot@mx)
    return scale,rot,trans

def try_colmap(frames:list[Frame],origin,radius,job_id):
    empty=(np.empty((0,3),np.float32),np.empty((0,3),np.uint8),{"status":"unavailable"})
    if len(frames)<3:return empty
    try:
        import pycolmap
        from plyfile import PlyData
    except Exception as exc:
        return empty[0],empty[1],{"status":"unavailable","error":str(exc)[:180]}
    try:
        with tempfile.TemporaryDirectory(prefix="realcity-colmap-") as td:
            root=Path(td);images=root/"images";sparse=root/"sparse";dense=root/"dense"
            images.mkdir();sparse.mkdir()
            frame_by_name={}
            for i,f in enumerate(frames):
                name=f"{i:03d}.jpg";frame_by_name[name]=f
                Image.fromarray(f.image).save(images/name,"JPEG",quality=94,subsampling=0)
            database=root/"database.db"
            device=pycolmap.Device.cuda if DEVICE_PREF.startswith("cuda") else pycolmap.Device.cpu
            extraction=pycolmap.FeatureExtractionOptions()
            extraction.max_image_size=1600
            extraction.use_gpu=device==pycolmap.Device.cuda
            pycolmap.extract_features(database,images,extraction_options=extraction,device=device)
            matching=pycolmap.FeatureMatchingOptions()
            matching.use_gpu=device==pycolmap.Device.cuda
            pycolmap.match_exhaustive(database,matching_options=matching,device=device)
            opts=pycolmap.IncrementalPipelineOptions()
            opts.mapper.init_min_num_inliers=35
            opts.mapper.abs_pose_min_num_inliers=20
            opts.mapper.ba_local_num_images=min(8,max(4,len(frames)))
            models=pycolmap.incremental_mapping(database,images,sparse,options=opts)
            if not models:return empty[0],empty[1],{"status":"no_sparse_model"}
            recon=max(models.values(),key=lambda r:sum(1 for im in r.images.values() if im.has_pose))
            registered=sum(1 for im in recon.images.values() if im.has_pose)
            src=[];dst=[]
            for image in recon.images.values():
                f=frame_by_name.get(str(image.name))
                coords=f.source.get("coordinates") if f else None
                if not image.has_pose or not coords or len(coords)!=2:continue
                center=np.asarray(image.projection_center(),dtype=np.float64).reshape(3)
                x,y=local_xy(origin,coords);src.append(center);dst.append([x,y,1.65])
            similarity=umeyama_similarity(np.asarray(src),np.asarray(dst)) if len(src)>=3 else None
            if similarity is None:
                return empty[0],empty[1],{"status":"gps_alignment_failed","registered":registered,"gps_cameras":len(src)}
            scale,rot,trans=similarity
            def transform(points):
                return (scale*(rot@np.asarray(points,dtype=np.float64).T)).T+trans

            dense_points=np.empty((0,3),np.float32);dense_colors=np.empty((0,3),np.uint8)
            report_error=None
            try:
                und=pycolmap.UndistortCameraOptions();und.max_image_size=1800
                pycolmap.undistort_images(dense,recon,images,output_type="COLMAP",undistort_options=und)
                pm=pycolmap.PatchMatchOptions();pm.max_image_size=1800;pm.cache_size=8.0;pm.geom_consistency=True
                pycolmap.patch_match_stereo(dense,workspace_format="COLMAP",options=pm)
                fused=dense/"fused.ply"
                fusion=pycolmap.StereoFusionOptions();fusion.max_image_size=1800;fusion.cache_size=8.0;fusion.min_num_pixels=3
                pycolmap.stereo_fusion(fused,dense,workspace_format="COLMAP",input_type="geometric",options=fusion,output_type="ply")
                ply=PlyData.read(str(fused));v=ply["vertex"].data
                dense_points=np.column_stack([v["x"],v["y"],v["z"]]).astype(np.float64)
                if {"red","green","blue"}.issubset(v.dtype.names):
                    dense_colors=np.column_stack([v["red"],v["green"],v["blue"]]).astype(np.uint8)
                else:dense_colors=np.full((len(dense_points),3),180,np.uint8)
                dense_points=transform(dense_points).astype(np.float32)
            except Exception as exc:
                report_error=str(exc)[:400]
                pts=[];cols=[]
                for p in recon.points3D.values():
                    try:
                        pts.append(np.asarray(p.xyz));cols.append(np.asarray(p.color,dtype=np.uint8))
                    except Exception:pass
                if pts:
                    dense_points=transform(np.asarray(pts)).astype(np.float32)
                    dense_colors=np.asarray(cols,dtype=np.uint8)
            if len(dense_points):
                rr=np.linalg.norm(dense_points[:,:2],axis=1)
                keep=np.isfinite(dense_points).all(axis=1)&(rr<radius*1.2)&(dense_points[:,2]>-5)&(dense_points[:,2]<80)
                dense_points=dense_points[keep];dense_colors=dense_colors[keep]
            return dense_points,dense_colors,{
                "status":"dense" if len(dense_points)>12000 else "sparse",
                "registered":registered,"gps_cameras":len(src),"points":int(len(dense_points)),
                "scale":round(float(scale),6),**({"warning":report_error} if report_error else {})
            }
    except Exception as exc:
        return empty[0],empty[1],{"status":"sfm_failed","error":str(exc)[:400]}

class DepthEngine:
    def __init__(self):
        import torch
        from transformers import AutoImageProcessor,AutoModelForDepthEstimation
        self.torch=torch
        if DEVICE_PREF.startswith("cuda") and torch.cuda.is_available():
            self.device=torch.device("cuda")
            self.dtype=torch.float16
        elif DEVICE_PREF=="mps" and getattr(torch.backends,"mps",None) and torch.backends.mps.is_available():
            self.device=torch.device("mps");self.dtype=torch.float32
        else:
            self.device=torch.device("cpu");self.dtype=torch.float32
        print("depth model",MODEL_ID,"device",self.device,flush=True)
        self.processor=AutoImageProcessor.from_pretrained(MODEL_ID)
        self.model=AutoModelForDepthEstimation.from_pretrained(MODEL_ID).to(self.device).eval()

    def infer(self,rgb:np.ndarray)->np.ndarray:
        t=self.torch
        inputs=self.processor(images=Image.fromarray(rgb),return_tensors="pt")
        inputs={k:v.to(self.device) for k,v in inputs.items()}
        with t.inference_mode():
            if self.device.type=="cuda":
                with t.autocast("cuda",dtype=self.dtype):
                    out=self.model(**inputs).predicted_depth
            else:
                out=self.model(**inputs).predicted_depth
        d=t.nn.functional.interpolate(out.unsqueeze(1),size=rgb.shape[:2],mode="bicubic",align_corners=False).squeeze().float().cpu().numpy()
        return np.maximum(d,1e-6)

def haversine_m(a,b):
    lon1,lat1=map(math.radians,a);lon2,lat2=map(math.radians,b)
    dlat=lat2-lat1;dlon=lon2-lon1
    h=math.sin(dlat/2)**2+math.cos(lat1)*math.cos(lat2)*math.sin(dlon/2)**2
    return 6371008.8*2*math.asin(min(1,math.sqrt(h)))

def bearing_deg(a,b):
    lon1,lat1=map(math.radians,a);lon2,lat2=map(math.radians,b)
    dlon=lon2-lon1
    y=math.sin(dlon)*math.cos(lat2)
    x=math.cos(lat1)*math.sin(lat2)-math.sin(lat1)*math.cos(lat2)*math.cos(dlon)
    return (math.degrees(math.atan2(y,x))+360)%360

def local_xy(origin,p):
    lon0,lat0=origin;lon,lat=p
    x=(lon-lon0)*111320.0*math.cos(math.radians(lat0))
    y=(lat-lat0)*110540.0
    return x,y

def matched_target(source:dict,scene:dict):
    match=source.get("match") if isinstance(source.get("match"),dict) else None
    if not match:return None
    bid=str(match.get("building_id") or "")
    try:edge_index=int(match.get("edge_index"))
    except Exception:return None
    for building in scene.get("buildings",[]):
        if str(building.get("id"))!=bid:continue
        ring=building.get("ring") or []
        if 0<=edge_index<len(ring)-1:
            a,b=ring[edge_index],ring[edge_index+1]
            return [(float(a[0])+float(b[0]))/2,(float(a[1])+float(b[1]))/2]
    return None

def metric_depth(relative:np.ndarray,anchor:float,radius:float)->np.ndarray:
    finite=np.isfinite(relative)&(relative>0)
    if not finite.any():return np.full_like(relative,anchor,dtype=np.float32)
    if "Metric-Outdoor" in MODEL_ID or "Metric-VKITTI" in MODEL_ID:
        # Metric Outdoor checkpoints predict absolute outdoor depth. Keep that
        # geometry and only apply a bounded scene-anchor correction when the
        # source is matched to a known facade distance.
        d=np.clip(relative.astype(np.float32),.6,min(max(radius*1.35,55),200))
        h,w=d.shape
        roi=d[int(h*.32):int(h*.72),int(w*.34):int(w*.66)]
        valid=roi[np.isfinite(roi)&(roi>.6)&(roi<180)]
        if valid.size>80 and math.isfinite(anchor) and anchor>3:
            med=float(np.median(valid))
            ratio=anchor/max(med,.5)
            if .45<=ratio<=2.2:
                d*=ratio
        return np.clip(d,.6,min(max(radius*1.35,55),200)).astype(np.float32)
    lo,hi=np.percentile(relative[finite],[3,97])
    n=np.clip((relative-lo)/max(1e-6,hi-lo),0,1)
    inv=.14+.86*n
    med=float(np.median(inv[finite]))
    d=anchor*med/np.maximum(inv,.06)
    return np.clip(d,1.2,min(max(radius*1.25,45),180)).astype(np.float32)

def frame_points(frame:Frame,origin,scene,radius,target_points:int):
    rgb=frame.image;rel=frame.depth
    h,w=rgb.shape[:2]
    source=frame.source
    cam=source.get("coordinates") or origin
    cx,cy=local_xy(origin,cam)
    match=source.get("match") if isinstance(source.get("match"),dict) else {}
    target_dist=match.get("distance_m") if isinstance(match.get("distance_m"),(int,float)) else source.get("distance_m")
    if not isinstance(target_dist,(int,float)) or not math.isfinite(float(target_dist)):
        target=matched_target(source,scene)
        target_dist=haversine_m(cam,target or origin)
    anchor=max(5,min(100,float(target_dist or 28)))
    depth=metric_depth(rel,anchor,radius)
    fov=float(source.get("fov") or 78)
    if source.get("panoramic"):fov=90.0
    fov=max(35,min(110,fov))
    fx=w/(2*math.tan(math.radians(fov)/2));fy=fx
    heading=source.get("heading")
    if not isinstance(heading,(int,float)) or not math.isfinite(float(heading)):
        target=matched_target(source,scene)
        heading=bearing_deg(cam,target or origin)
    yaw=math.radians(float(heading))
    forward=np.array([math.sin(yaw),math.cos(yaw),0.0],np.float32)
    right=np.array([math.cos(yaw),-math.sin(yaw),0.0],np.float32)
    up=np.array([0.0,0.0,1.0],np.float32)
    desired=max(18000,min(target_points,int(target_points/max(1,1))))
    stride=max(1,int(math.sqrt((w*h)/desired)))
    ys=np.arange(stride//2,h,stride,dtype=np.int32);xs=np.arange(stride//2,w,stride,dtype=np.int32)
    xx,yy=np.meshgrid(xs,ys)
    z=depth[yy,xx]
    xn=(xx.astype(np.float32)-(w-1)/2)/fx
    yn=(yy.astype(np.float32)-(h-1)/2)/fy
    rays=forward[None,None,:]+xn[...,None]*right[None,None,:]-yn[...,None]*up[None,None,:]
    rays/=np.maximum(np.linalg.norm(rays,axis=2,keepdims=True),1e-5)
    pts=np.array([cx,cy,1.65],np.float32)[None,None,:]+rays*z[...,None]
    col=rgb[yy,xx]
    # Remove sky/far numerical outliers but keep real roads, vegetation and static street objects.
    rr=np.linalg.norm(pts[...,:2],axis=2)
    valid=np.isfinite(pts).all(axis=2)&(rr<radius*1.18)&(pts[...,2]>-3)&(pts[...,2]<65)&(z<radius*1.25)
    # Suppress likely sky: upper image, very far depth, blue/bright low-gradient pixels.
    upper=yy<h*.48
    blue=(col[...,2]>col[...,0]*1.08)&(col[...,2]>col[...,1]*1.03)&(col[...,2]>105)
    valid&=~(upper&blue&(z>anchor*.85))
    pts=pts[valid];col=col[valid]
    if not len(pts):return pts.astype(np.float32),col.astype(np.uint8)
    return pts.astype(np.float32),col.astype(np.uint8)

def voxel_fuse(points,colors,voxel=.11,max_points=300000):
    if not len(points):return points,colors,np.empty((0,),np.float32)
    q=np.floor(points/voxel).astype(np.int32)
    # Lexicographic voxel identity without overflow-prone manual hashing.
    order=np.lexsort((q[:,2],q[:,1],q[:,0]))
    q=q[order];p=points[order];c=colors[order].astype(np.float32)
    change=np.empty(len(q),bool);change[0]=True;change[1:]=np.any(q[1:]!=q[:-1],axis=1)
    starts=np.flatnonzero(change);ends=np.r_[starts[1:],len(q)]
    count=(ends-starts).astype(np.int32)
    sums=np.add.reduceat(p,starts,axis=0);cs=np.add.reduceat(c,starts,axis=0)
    fp=sums/count[:,None];fc=np.clip(cs/count[:,None],0,255).astype(np.uint8)
    radius=np.clip(voxel*(1.15+.12*np.log2(np.maximum(count,1))),voxel,voxel*2.4).astype(np.float32)
    if len(fp)>max_points:
        score=count.astype(np.float32)
        # Stable density-biased sampling: retain multi-view consensus first.
        idx=np.argpartition(score,-max_points)[-max_points:]
        fp,fc,radius=fp[idx],fc[idx],radius[idx]
    return fp.astype(np.float32),fc,radius

def encode_rcs(points,colors,radius):
    count=len(points);header=struct.pack("<4sHHII",b"RCS1",1,20,count,1)
    rec=np.empty(count,dtype=np.dtype([
        ("x","<f4"),("y","<f4"),("z","<f4"),
        ("r","u1"),("g","u1"),("b","u1"),("a","u1"),("radius","<f4")
    ]))
    rec["x"]=points[:,0];rec["y"]=points[:,1];rec["z"]=points[:,2]
    rec["r"]=colors[:,0];rec["g"]=colors[:,1];rec["b"]=colors[:,2];rec["a"]=255;rec["radius"]=radius
    return header+rec.tobytes(order="C")

def upload(job_id,name,data,mime,kind):
    r=session.put(api(f"/api/v2/internal/realcity/reconstruction/jobs/{job_id}/artifacts/{name}"),
                  params={"mime":mime,"kind":kind},data=data,
                  headers=auth_headers({"x-realcity-worker-id":WORKER_ID,"Content-Type":"application/octet-stream"}),timeout=(10,120))
    r.raise_for_status();return r.json()

def reconstruct(job_id,package,engine:DepthEngine):
    target=package["target"];origin=target["coordinates"];radius=float(package["scene"].get("radius_m") or 190)
    raw=[]
    for i,s in enumerate(package.get("sources",[])):
        im=download_source(s)
        if im is None:continue
        sh=sharpness(im)
        if sh<18:continue
        raw.append(Frame(s,im,sharpness=sh))
        if len(raw)>=32:break
    if not raw:raise RuntimeError("no_decodable_sources")
    heartbeat(job_id,"downloaded",sources=len(raw))

    # Measure actual inter-view visual overlap and prefer a diverse, mutually consistent subset.
    for i in range(len(raw)):
        scores=[]
        for j in range(max(0,i-2),min(len(raw),i+3)):
            if i!=j:scores.append(sift_overlap(raw[i].image,raw[j].image))
        raw[i].overlap=max(scores,default=0.0)
    raw.sort(key=lambda f:(f.overlap*2+min(f.sharpness/250,1)),reverse=True)
    frames=raw[:min(18,len(raw))]
    heartbeat(job_id,"matching",selected=len(frames),mean_overlap=float(np.mean([f.overlap for f in frames])))

    colmap_points,colmap_colors,colmap_report=try_colmap(frames,origin,radius,job_id)
    heartbeat(job_id,"colmap",**colmap_report)

    for i,f in enumerate(frames):
        f.depth=engine.infer(f.image)
        heartbeat(job_id,"depth",frame=i+1,total=len(frames))

    target_total=int(package.get("quality_targets",{}).get("target_points_mobile") or 260000)
    per=max(24000,min(90000,int(target_total*2.2/max(1,len(frames)))))
    ps=[];cs=[]
    for i,f in enumerate(frames):
        p,c=frame_points(f,origin,package["scene"],radius,per)
        if len(p):ps.append(p);cs.append(c)
        heartbeat(job_id,"unproject",frame=i+1,total=len(frames),raw_points=sum(len(x) for x in ps))
    if not ps and not len(colmap_points):raise RuntimeError("no_valid_dense_points")
    depth_points=np.concatenate(ps) if ps else np.empty((0,3),np.float32)
    depth_colors=np.concatenate(cs) if cs else np.empty((0,3),np.uint8)
    if len(colmap_points):
        # MVS is geometrically stronger than monocular completion. Duplicate its
        # samples before voxel averaging so overlapping voxels converge toward
        # the multi-view solution while DA2 still fills vegetation/road gaps.
        points=np.concatenate([colmap_points,colmap_points,depth_points])
        colors=np.concatenate([colmap_colors,colmap_colors,depth_colors])
    else:
        points,colors=depth_points,depth_colors
    points,colors,radii=voxel_fuse(points,colors,voxel=.09 if len(colmap_points)>12000 else .105,max_points=target_total)
    if len(points)<10000:raise RuntimeError("insufficient_dense_geometry")

    bounds={"min":points.min(axis=0).round(3).tolist(),"max":points.max(axis=0).round(3).tolist()}
    rcs=encode_rcs(points,colors,radii)
    source_used=[{"id":f.source.get("id"),"source":f.source.get("source"),"license":f.source.get("license"),"overlap":round(f.overlap,3),"sharpness":round(f.sharpness,1)} for f in frames]
    multi=sum(1 for f in frames if f.overlap>=.12)
    quality="high" if len(frames)>=10 and multi>=5 and len(points)>=180000 else "medium" if len(frames)>=4 and len(points)>=70000 else "limited"
    scene={
        "schema":"shaurmeg.realcity.surfels.v1","engine":"colmap-mvs+depth-anything-v2-small",
        "origin":[origin[0],origin[1],0],"radius_m":radius,"point_count":int(len(points)),
        "bounds":bounds,"sources":source_used,"quality":quality,"colmap":colmap_report,
        "coordinate_system":"local ENU metres, x=east y=north z=up",
        "spatial_truth":"OSM/OpenFreeMap footprint and target coordinates"
    }
    upload(job_id,"surfels.rcs",rcs,"application/octet-stream","surfels")
    upload(job_id,"scene.json",json.dumps(scene,separators=(",",":")).encode(),"application/json","manifest")
    try:
        preview=Image.fromarray(frames[0].image)
        preview.thumbnail((1024,1024),Image.Resampling.LANCZOS)
        bio=io.BytesIO();preview.save(bio,"WEBP",quality=78,method=4)
        upload(job_id,"preview.webp",bio.getvalue(),"image/webp","preview")
    except Exception:
        pass
    return {
        "provider":"colmap-mvs+depth-anything-v2-small","pose_solver":"colmap-bundle-adjustment+gps-similarity" if colmap_report.get("status") in ("dense","sparse") else "gps-heading+sift-overlap",
        "point_count":int(len(points)),"radius_m":radius,"bounds":bounds,"quality":quality,
        "coverage":{"sources_downloaded":len(raw),"sources_used":len(frames),"multiview_sources":multi,"dense_points":int(len(points)),"colmap_points":int(len(colmap_points)),"colmap":colmap_report},
        "camera":{"zoom":18.55,"pitch":67,"bearing":-20}
    }

def complete(job_id,result):
    r=session.post(api(f"/api/v2/internal/realcity/reconstruction/jobs/{job_id}/complete"),
                   json={"worker_id":WORKER_ID,"result":result},headers=auth_headers(),timeout=(10,60))
    r.raise_for_status();return r.json()

def fail(job_id,error):
    try:
        session.post(api(f"/api/v2/internal/realcity/reconstruction/jobs/{job_id}/fail"),
                     json={"worker_id":WORKER_ID,"error":str(error)[:700],"report":{"stage":"failed"}},
                     headers=auth_headers(),timeout=TIMEOUT).raise_for_status()
    except Exception as exc:
        print("fail callback",exc,flush=True)

def main():
    if not TOKEN:raise SystemExit("REALCITY_RECONSTRUCTION_WORKER_TOKEN is required")
    engine=DepthEngine()
    print("worker",WORKER_ID,"api",API,flush=True)
    while True:
        try:
            item=claim()
            if not item:
                time.sleep(POLL);continue
            job_id=item["job_id"];package=item["package"]
            print("job",job_id,package.get("target",{}).get("name"),"sources",len(package.get("sources",[])),flush=True)
            try:
                result=reconstruct(job_id,package,engine)
                complete(job_id,result)
                print("ready",job_id,result,flush=True)
            except Exception as exc:
                print("failed",job_id,repr(exc),flush=True);fail(job_id,exc)
        except KeyboardInterrupt:
            break
        except Exception as exc:
            print("poll error",repr(exc),flush=True);time.sleep(max(POLL,10))

if __name__=="__main__":
    main()
