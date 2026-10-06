FROM nvidia/cuda:12.8.1-cudnn-devel-ubuntu24.04
ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv git cmake ninja-build build-essential ca-certificates \
    libboost-program-options-dev libboost-graph-dev libboost-system-dev \
    libeigen3-dev libflann-dev libfreeimage-dev libmetis-dev libgoogle-glog-dev \
    libgtest-dev libgmock-dev libsqlite3-dev libglew-dev libcgal-dev libceres-dev \
    libsuitesparse-dev libglib2.0-0 libgl1 \
 && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 https://github.com/colmap/colmap.git /tmp/colmap \
 && cmake -S /tmp/colmap -B /tmp/colmap/build -GNinja \
      -DCMAKE_BUILD_TYPE=Release -DGUI_ENABLED=OFF -DCUDA_ENABLED=ON \
      -DCMAKE_CUDA_ARCHITECTURES="89;90" \
 && cmake --build /tmp/colmap/build --target colmap -j2 \
 && cmake --install /tmp/colmap/build \
 && rm -rf /tmp/colmap
WORKDIR /app
COPY v2/reconstruction-worker/requirements.txt /app/requirements.txt
RUN pip3 install --break-system-packages -r /app/requirements.txt
COPY v2/reconstruction-worker/worker.py /app/worker.py
CMD ["python3","/app/worker.py"]
