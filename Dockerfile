# Optional self-hosted local Demucs runtime. Not used by the existing Node-only Render service
# until Render is explicitly switched to Docker. CPU-only by design; no inference provider keys.
FROM node:20-bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip python3-venv ffmpeg tini ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
RUN python3 -m venv /opt/demucs-venv
ENV PATH="/opt/demucs-venv/bin:$PATH"
RUN pip install --upgrade pip && pip install "torch==2.5.1" --index-url https://download.pytorch.org/whl/cpu && pip install "demucs==4.0.1" "fastapi==0.115.6" "uvicorn[standard]==0.34.0" "python-multipart==0.0.20"
ENV DEMUCS_WORKER_URL=http://127.0.0.1:8001
EXPOSE 10000
CMD ["tini","--","sh","-c","uvicorn demucs_worker:app --host 127.0.0.1 --port 8001 & exec npm start"]
