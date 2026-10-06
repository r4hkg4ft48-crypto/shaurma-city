FROM nvidia/cuda:12.8.1-cudnn-runtime-ubuntu24.04
ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 HF_HOME=/models
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv ca-certificates libglib2.0-0 libgl1 \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY v2/reconstruction-worker/requirements.txt /app/requirements.txt
RUN pip3 install --break-system-packages -r /app/requirements.txt
RUN python3 - <<'PY'
from transformers import AutoImageProcessor,AutoModelForDepthEstimation
m='depth-anything/Depth-Anything-V2-Metric-Outdoor-Small-hf'
AutoImageProcessor.from_pretrained(m)
AutoModelForDepthEstimation.from_pretrained(m)
print('cached',m)
PY
COPY v2/reconstruction-worker/worker.py /app/worker.py
CMD ["python3","/app/worker.py"]
