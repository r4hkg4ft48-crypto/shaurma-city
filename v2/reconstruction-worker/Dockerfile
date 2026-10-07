FROM pytorch/pytorch:2.7.1-cuda12.8-cudnn9-devel

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/models/huggingface

RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    git libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY v2/reconstruction-worker/requirements.txt /app/requirements.txt
RUN python -m pip install --upgrade pip && pip install -r /app/requirements.txt
RUN pip install --no-deps git+https://github.com/facebookresearch/map-anything.git@3d10cf7a3016fc0f9bb13a071ee66c47b10be0d9
RUN python - <<'PY'
import torch
import pycolmap
from vggt.models.vggt import VGGT
from mapanything.models import MapAnything
from gsplat.rendering import rasterization
from transformers import AutoImageProcessor,AutoModelForDepthEstimation
model='depth-anything/Depth-Anything-V2-Metric-Outdoor-Small-hf'
AutoImageProcessor.from_pretrained(model)
AutoModelForDepthEstimation.from_pretrained(model)
print('gpu worker imports ok',torch.__version__,pycolmap.__version__,MapAnything.__name__)
print('cached',model)
PY

COPY v2/reconstruction-worker/app.py /app/app.py

EXPOSE 8000
CMD ["uvicorn","app:app","--host","0.0.0.0","--port","8000","--workers","1"]
