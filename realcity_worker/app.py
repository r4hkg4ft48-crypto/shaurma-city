from __future__ import annotations

import base64
import hashlib
import io
import json
import math
import os
import struct
import time
import urllib.parse
from dataclasses import dataclass
from typing import Any, Iterable

import numpy as np
import requests
import torch
import torch.nn.functional as F
from fastapi import FastAPI
from PIL import Image
from transformers import AutoImageProcessor, AutoModelForDepthEstimation

API_URL=os.environ.get("REALCITY_API_URL","https://shaurma-city-api.onrender.com/api/v2").rstrip("/")
TOKEN=os.environ.get("REALCITY_RECONSTRUCTION_WORKER_TOKEN","")
WORKER_ID=os.environ.get("REALCITY_WORKER_ID") or ("gpu-"+os.uname().nodename)
MODEL_ID=os.environ.get("REALCITY_DEPTH_MODEL","depth-anything/Depth-Anything-V2-Metric-Outdoor-Small-hf")
MAX_SOURCES=max(1,min(96,int(os.environ.get("REALCITY_MAX_SOURCES","64"))))
MAX_POINTS=max(50000,min(1500000,int(os.environ.get("REALCITY_MAX_POINTS","480000"))))
POLL_SECONDS=max(2,min(60,int(os.environ.get("REALCITY_POLL_SECONDS","8"))))
REQUEST_TIMEOUT=max(8,min(90,int(os.environ.get("REALCITY_SOURCE_TIMEOUT","25"))))
USER_AGENT="Shaurmeg-RealCity-Reconstruction/1.0"
ALLOWED_HOST_SUFFIXES=(
    "wikimedia.org","upload.wikimedia.org","kartaview.org","openstreetcam.org",
    "panoramax.xyz","panoramax.fr","ign.fr",
)
app=FastAPI(title="Shaurmeg RealCity Reconstruction Worker",version="1.0")

_device="cuda" if torch.cuda.is_available() else "cpu"
_dtype=torch.float16 if _device=="cuda" else torch.float32
_processor=None
_model=None

@dataclass
class Frame:
    source: dict[str,Any]
    image: Image.Image
    depth: np.ndarray
    heading_deg: float
    fov_deg: float
    camera_xy: tuple[float,float]
    camera_z: float=1.7

def _headers()->dict[str,str]:
    return {"x-realcity-worker-token":TOKEN,"content-type":"application/json"}

def _host_ok(url:str)->bool:
    try:
        u=urllib.parse.urlparse(url)
        if u.scheme!="https" or not u.hostname:
            return False
        host=u.hostname.lower().strip(".")
        return any(host==s or host.endswith("."+s) for s in ALLOWED_HOST_SUFFIXES)
    except Exception:
        return False

def _get_model():
    global _processor,_model
    if _model is None:
        _processor=AutoImageProcessor.from_pretrained(MODEL_ID)
        _model=AutoModelForDepthEstimation.from_pretrained(
            MODEL_ID,
            torch_dtype=_dtype if _device=="cuda" else None,
        ).to(_device).eval()
    return _processor,_model

def _metric_frame(origin:list[float],p:list[float])->tuple[float,float]:
    lon0,lat0=map(float,origin[:2]);lon,lat=map(float,p[:2])
    y=(lat-lat0)*110540.0
    x=(lon-lon0)*111320.0*math.cos(math.radians(lat0))
    return x,y

def _bearing(a:list[float],b:list[float])->float:
    lon1,lat1=map(math.radians,a[:2]);lon2,lat2=map(math.radians,b[:2])
    dl=lon2-lon1
    y=math.sin(dl)*math.cos(lat2)
    x=math.cos(lat1)*math.sin(lat2)-math.sin(lat1)*math.cos(lat2)*math.cos(dl)
    return (math.degrees(math.atan2(y,x))+360.0)%360.0

def _scene_edge_mid(scene:dict[str,Any],match:dict[str,Any]|None)->list[float]|None:
    if not match:
        return None
    bid=str(match.get("building_id",""));ei=int(match.get("edge_index",-1))
    for b in scene.get("buildings",[]):
        if str(b.get("id"))!=bid:
            continue
        ring=b.get("ring") or []
        if 0<=ei<len(ring)-1:
            a,bp=ring[ei],ring[ei+1]
            return [(float(a[0])+float(bp[0]))/2.0,(float(a[1])+float(bp[1]))/2.0]
    return None

def _download_image(source:dict[str,Any])->Image.Image:
    url=str(source.get("image_url") or "")
    if not _host_ok(url):
        raise ValueError("source_host_not_allowed")
    r=requests.get(url,timeout=REQUEST_TIMEOUT,headers={"User-Agent":USER_AGENT},stream=True)
    r.raise_for_status()
    raw=r.raw.read(12*1024*1024+1)
    if len(raw)>12*1024*1024:
        raise ValueError("source_too_large")
    im=Image.open(io.BytesIO(raw)).convert("RGB")
    im.thumbnail((1600,1200),Image.Resampling.LANCZOS)
    return im

@torch.inference_mode()
def _depth(image:Image.Image)->np.ndarray:
    processor,model=_get_model()
    inputs=processor(images=image,return_tensors="pt")
    pixel_values=inputs["pixel_values"].to(_device)
    if _device=="cuda":
        pixel_values=pixel_values.to(_dtype)
    outputs=model(pixel_values=pixel_values)
    d=outputs.predicted_depth
    d=F.interpolate(d.unsqueeze(1),size=(image.height,image.width),mode="bicubic",align_corners=False).squeeze(0).squeeze(0)
    arr=d.float().cpu().numpy()
    arr=np.nan_to_num(arr,nan=0.0,posinf=0.0,neginf=0.0)
    return np.clip(arr,0.0,300.0)

def _frame(source:dict[str,Any],scene:dict[str,Any],origin:list[float])->Frame:
    im=_download_image(source)
    depth=_depth(im)
    coords=source.get("coordinates") or origin
    camera_xy=_metric_frame(origin,coords)
    match=source.get("match")
    heading=source.get("heading")
    if heading is None:
        target=_scene_edge_mid(scene,match)
        heading=_bearing(coords,target) if target else 0.0
    fov=float(source.get("fov") or (360.0 if source.get("panoramic") else 78.0))
    return Frame(source=source,image=im,depth=depth,heading_deg=float(heading),fov_deg=max(30.0,min(360.0,fov)),camera_xy=camera_xy)

def _sky_or_invalid(rgb:np.ndarray,depth:float,y:int,h:int)->bool:
    if depth<=0.15 or depth>180.0:
        return True
    r,g,b=map(int,rgb[:3])
    if y<h*.53 and b>r*1.12 and b>g*.98 and b>118:
        return True
    if y<h*.34 and r>175 and g>175 and b>175 and abs(r-g)<25 and abs(g-b)<25:
        return True
    return False

def _iter_points(frame:Frame,origin:list[float],radius:float)->Iterable[tuple[float,float,float,int,int,int,int,int]]:
    img=np.asarray(frame.image,dtype=np.uint8)
    dep=frame.depth
    h,w=dep.shape
    if frame.fov_deg>=300:
        hfov=math.radians(360.0)
        stride=max(2,int(math.sqrt((w*h)/95000)))
        for y in range(0,h,stride):
            elev=(0.5-y/max(1,h-1))*math.pi
            ce=math.cos(elev);se=math.sin(elev)
            for x in range(0,w,stride):
                d=float(dep[y,x])
                if _sky_or_invalid(img[y,x],d,y,h):
                    continue
                azi=math.radians(frame.heading_deg)+(x/max(1,w-1)-.5)*hfov
                wx=frame.camera_xy[0]+math.sin(azi)*ce*d
                wy=frame.camera_xy[1]+math.cos(azi)*ce*d
                wz=frame.camera_z+se*d
                rr=math.hypot(wx,wy)
                if rr>radius or wz<-2.5 or wz>65:
                    continue
                c=img[y,x]
                conf=220 if d<45 else 185 if d<90 else 145
                rad=max(35,min(220,int(d*1.8)))
                yield wx,wy,wz,int(c[0]),int(c[1]),int(c[2]),rad,conf
        return
    hfov=math.radians(frame.fov_deg)
    fx=(w/2.0)/math.tan(hfov/2.0)
    fy=fx
    cx=(w-1)/2.0;cy=(h-1)/2.0
    yaw=math.radians(frame.heading_deg)
    sy,cyaw=math.sin(yaw),math.cos(yaw)
    stride=max(2,int(math.sqrt((w*h)/100000)))
    for y in range(0,h,stride):
        for x in range(0,w,stride):
            d=float(dep[y,x])
            if _sky_or_invalid(img[y,x],d,y,h):
                continue
            rx=(x-cx)/fx*d
            rz=(cy-y)/fy*d
            forward=d
            wx=frame.camera_xy[0]+sy*forward+cyaw*rx
            wy=frame.camera_xy[1]+cyaw*forward-sy*rx
            wz=frame.camera_z+rz
            rr=math.hypot(wx,wy)
            if rr>radius or wz<-2.5 or wz>65:
                continue
            c=img[y,x]
            conf=230 if d<35 else 195 if d<80 else 150
            rad=max(30,min(210,int(d*1.55)))
            yield wx,wy,wz,int(c[0]),int(c[1]),int(c[2]),rad,conf

def _voxel_merge(points:list[tuple],voxel:float,limit:int)->list[tuple]:
    cells={}
    for p in points:
        key=(round(p[0]/voxel),round(p[1]/voxel),round(p[2]/voxel))
        old=cells.get(key)
        if old is None or p[7]>old[7]:
            cells[key]=p
    vals=list(cells.values())
    if len(vals)>limit:
        vals.sort(key=lambda p:(math.hypot(p[0],p[1]),-p[7]))
        step=len(vals)/limit
        vals=[vals[int(i*step)] for i in range(limit)]
    return vals

def _encode_rcs(points:list[tuple])->tuple[bytes,list[float]]:
    if not points:
        raise ValueError("no_points")
    xyz=np.asarray([[p[0],p[1],p[2]] for p in points],dtype=np.float32)
    mins=xyz.min(axis=0);maxs=xyz.max(axis=0)
    out=bytearray(32+20*len(points))
    struct.pack_into("<4sI6f",out,0,b"RCS1",len(points),float(mins[0]),float(mins[1]),float(mins[2]),float(maxs[0]),float(maxs[1]),float(maxs[2]))
    off=32
    for p in points:
        struct.pack_into("<fffBBBBHBB",out,off,float(p[0]),float(p[1]),float(p[2]),int(p[3]),int(p[4]),int(p[5]),255,int(p[6]),int(p[7]),0)
        off+=20
    return bytes(out),[float(*[0])]

def _encode_rcs(points:list[tuple])->tuple[bytes,list[float]]:
    if not points:
        raise ValueError("no_points")
    xyz=np.asarray([[p[0],p[1],p[2]] for p in points],dtype=np.float32)
    mins=xyz.min(axis=0);maxs=xyz.max(axis=0)
    out=bytearray(32+20*len(points))
    struct.pack_into("<4sI6f",out,0,b"RCS1",len(points),float(mins[0]),float(mins[1]),float(mins[2]),float(maxs[0]),float(maxs[1]),float(maxs[2]))
    off=32
    for p in points:
        struct.pack_into("<fffBBBBHBB",out,off,float(p[0]),float(p[1]),float(p[2]),int(p[3]),int(p[4]),int(p[5]),255,int(p[6]),int(p[7]),0)
        off+=20
    return bytes(out),[float(mins[0]),float(mins[1]),float(mins[2]),float(maxs[0]),float(maxs[1]),float(maxs[2])]

def _post(path:str,payload:dict[str,Any],timeout:int=30):
    r=requests.post(API_URL+path,headers=_headers(),json=payload,timeout=timeout)
    r.raise_for_status()
    return r.json()

def _put_artifact(job_id:str,name:str,data:bytes,kind:str,mime:str):
    url=API_URL+f"/internal/realcity/reconstruction/jobs/{job_id}/artifacts/{urllib.parse.quote(name)}?kind={urllib.parse.quote(kind)}&mime={urllib.parse.quote(mime)}"
    r=requests.put(url,headers={"x-realcity-worker-token":TOKEN,"x-realcity-worker-id":WORKER_ID,"content-type":"application/octet-stream"},data=data,timeout=120)
    r.raise_for_status()
    return r.json()

def reconstruct(package:dict[str,Any])->dict[str,Any]:
    target=package["target"];scene=package["scene"];origin=target["coordinates"]
    radius=min(float(package.get("quality_targets",{}).get("near_radius_m") or scene.get("radius_m") or 140),180.0)
    sources=(package.get("sources") or [])[:MAX_SOURCES]
    frames=[];errors=[]
    for source in sources:
        try:
            frames.append(_frame(source,scene,origin))
        except Exception as e:
            errors.append({"id":source.get("id"),"error":str(e)[:160]})
    if not frames:
        raise RuntimeError("no_usable_frames")
    points=[]
    for f in frames:
        points.extend(_iter_points(f,origin,radius))
    if not points:
        raise RuntimeError("no_dense_points")
    points=_voxel_merge(points,0.07,min(MAX_POINTS,650000))
    if len(points)<15000:
        points=_voxel_merge(points,0.04,min(MAX_POINTS,650000))
    binary,bounds=_encode_rcs(points)
    near=sum(1 for p in points if math.hypot(p[0],p[1])<=45)
    coverage={
        "usable_frames":len(frames),"requested_frames":len(sources),"points":len(points),
        "near_points":near,"radius_m":radius,
        "angular_bins":len(set(int((f.heading_deg%360)//45) for f in frames)),
    }
    quality="photoreal-dense" if len(frames)>=6 and coverage["angular_bins"]>=3 and len(points)>=180000 else "photoreal-partial"
    scene_json=json.dumps({
        "schema":"shaurmeg.realcity.photoreal.scene.v1","origin":origin,"bounds":bounds,"radius_m":radius,
        "point_count":len(points),"coverage":coverage,"quality":quality,
        "engine":{"depth":MODEL_ID,"pose":"gps-heading+osm-edge-anchor","fusion":"metric-depth-surfel-v1"},
        "sources":[{"id":f.source.get("id"),"source":f.source.get("source"),"license":f.source.get("license"),"attribution":f.source.get("attribution")} for f in frames],
    },ensure_ascii=False,separators=(",",":")).encode()
    return {"surfels":binary,"scene":scene_json,"bounds":bounds,"radius_m":radius,"point_count":len(points),"coverage":coverage,"quality":quality,"errors":errors}

def process_once()->bool:
    if not TOKEN:
        raise RuntimeError("REALCITY_RECONSTRUCTION_WORKER_TOKEN_required")
    claim=_post("/internal/realcity/reconstruction/claim",{"worker_id":WORKER_ID})
    if not claim.get("job_id"):
        return False
    job_id=str(claim["job_id"]);package=claim["package"]
    started=time.time()
    try:
        _post(f"/internal/realcity/reconstruction/jobs/{job_id}/heartbeat",{"worker_id":WORKER_ID,"report":{"stage":"loading_sources","device":_device,"model":MODEL_ID}})
        result=reconstruct(package)
        _post(f"/internal/realcity/reconstruction/jobs/{job_id}/heartbeat",{"worker_id":WORKER_ID,"report":{"stage":"uploading","point_count":result["point_count"]}})
        _put_artifact(job_id,"surfels.rcs",result["surfels"],"surfel-cloud-v1","application/vnd.realcity.surfels")
        _put_artifact(job_id,"scene.json",result["scene"],"scene-manifest-v1","application/json")
        final={
            "worker_id":WORKER_ID,
            "result":{
                "provider":MODEL_ID,"pose_solver":"gps_heading_osm_anchor",
                "radius_m":result["radius_m"],"point_count":result["point_count"],"bounds":result["bounds"],
                "coverage":result["coverage"],"quality":result["quality"],
                "elapsed_sec":round(time.time()-started,2),"source_errors":result["errors"],
            }
        }
        _post(f"/internal/realcity/reconstruction/jobs/{job_id}/complete",final,timeout=60)
        return True
    except Exception as e:
        try:
            _post(f"/internal/realcity/reconstruction/jobs/{job_id}/fail",{"worker_id":WORKER_ID,"error":str(e)[:800],"report":{"elapsed_sec":round(time.time()-started,2)}})
        except Exception:
            pass
        return True

@app.get("/health")
def health():
    return {"ok":True,"worker_id":WORKER_ID,"device":_device,"cuda":torch.cuda.is_available(),"model":MODEL_ID}

@app.post("/run-once")
def run_once():
    return {"ok":True,"processed":process_once()}

@app.on_event("startup")
def start_loop():
    import threading
    def loop():
        while True:
            try:
                worked=process_once()
                if not worked:
                    time.sleep(POLL_SECONDS)
            except Exception:
                time.sleep(POLL_SECONDS)
    threading.Thread(target=loop,name="realcity-worker",daemon=True).start()
