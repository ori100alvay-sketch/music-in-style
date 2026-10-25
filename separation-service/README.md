# Local Demucs separation service (opt-in)

This is an isolated, open-source Demucs service. It is **not wired into the public Node app by default** and the app must not advertise it as active until a real audio smoke test passes.

## Cost and deployment notes

- No paid inference API or Replicate token is used by this service.
- It still consumes CPU/RAM/storage and downloads model weights at first run. Hosting compute may cost money; "open source" does not mean "free hosting".
- Do not deploy to a paid plan without explicit budget approval. The current Render free Node service is not assumed to have enough memory/compute for Demucs.
- Start with a local Docker run on a machine with Python-compatible CPU support. Separation can be slow without a GPU.
- The first run needs network access to fetch model weights. For offline deployment, pre-cache and validate weights separately.

## Run locally

From this directory:

```sh
docker build -t music-in-style-demucs .
docker run --rm -p 8000:8000 --memory=6g music-in-style-demucs
```

Then visit `http://127.0.0.1:8000/health`. This endpoint intentionally reports `readyForSeparation: false`: it verifies installed executables only, not model weights or actual audio output.

Run unit tests in an environment with the requirements installed:

```sh
pip install -r requirements.txt
pip install demucs==4.0.1
python -m unittest test_app.py
```

For a real smoke test, use a short audio file you own or are licensed to process:

```sh
curl -f -F 'file=@sample.wav' http://127.0.0.1:8000/separate -o stems.zip
unzip -l stems.zip
```

Verify the ZIP contains `vocals.wav`, `drums.wav`, `bass.wav`, and `other.wav` and listen to the output before changing the UI or enabling a Node proxy.

## API

- `GET /health`: reports installed runtime and deliberately never claims separation is ready.
- `POST /separate`: multipart form field `file`; returns a ZIP of four stems on success.
- Maximum upload defaults to 40 MiB and runtime timeout to 900 seconds. Override with `MAX_UPLOAD_BYTES` and `SEPARATION_TIMEOUT_SECONDS`.
