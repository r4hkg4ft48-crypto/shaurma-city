FROM nvidia/cuda:12.8.1-cudnn-runtime-ubuntu24.04
ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip python3-venv libglib2.0-0 libgl1 ca-certificates colmap && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY v2/reconstruction-worker/requirements.txt /app/requirements.txt
RUN pip3 install --break-system-packages -r /app/requirements.txt
COPY v2/reconstruction-worker/worker.py /app/worker.py
CMD ["python3","/app/worker.py"]
