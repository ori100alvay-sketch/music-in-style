# Self-hosted, CPU-only Demucs runtime. No paid inference provider is configured.
FROM node:20-bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip python3-venv ffmpeg tini ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
RUN python3 -m venv /opt/demucs-venv
ENV PATH="/opt/demucs-venv/bin:$PATH" DEMUCS_WORKER_URL=http://127.0.0.1:8001 DEMUCS_MAX_UPLOAD_BYTES=26214400 DEMUCS_MAX_DURATION_SECONDS=300 TORCH_HOME=/var/cache/torch
RUN mkdir -p /var/cache/torch && pip install --upgrade pip && pip install "torch==2.5.1" --index-url https://download.pytorch.org/whl/cpu && pip install "demucs==4.0.1" "fastapi==0.115.6" "uvicorn[standard]==0.34.0" "python-multipart==0.0.20"
# Keep CPU inference disabled by default: the Render free plan has too little RAM/CPU
# for reliable Demucs inference. Enable only on a sufficiently provisioned host after a real smoke test.
ENV DEMUCS_ENABLE_LOCAL_WORKER=false
EXPOSE 10000
CMD ["tini","--","sh","-c","if [ \"$DEMUCS_ENABLE_LOCAL_WORKER\" = \"true\" ]; then uvicorn demucs_worker:app --host 127.0.0.1 --port 8001 & fi; exec npm start"]
