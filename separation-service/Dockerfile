FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TORCH_HOME=/models/torch \
    HF_HOME=/models/huggingface

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir demucs==4.0.1

COPY app.py .
RUN useradd --create-home --uid 10001 appuser \
    && mkdir -p /tmp/music-in-style /models/torch /models/huggingface \
    && chown -R appuser:appuser /app /tmp/music-in-style /models

USER appuser
EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
