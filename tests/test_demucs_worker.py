import io
import os
import sys
import tempfile
import types
import unittest
import zipfile
from pathlib import Path
from unittest.mock import Mock, patch

# CI checks the HTTP/file-processing contract with model imports stubbed.
# Real model quality is deliberately verified separately with an actual audio smoke test.
sys.modules.setdefault("torch", types.SimpleNamespace(__version__="test-stub"))
sys.modules.setdefault("demucs", types.SimpleNamespace(__version__="test-stub"))

import demucs_worker
from fastapi.testclient import TestClient


class DemucsWorkerTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(demucs_worker.app)
        self.temp = tempfile.TemporaryDirectory()
        self.work_dir = Path(self.temp.name) / "work"
        self.work_dir.mkdir()
        self.old_work_dir = demucs_worker.WORK_DIR
        self.old_max_upload = demucs_worker.MAX_UPLOAD_BYTES
        self.old_duration = demucs_worker.MAX_DURATION_SECONDS
        demucs_worker.WORK_DIR = self.work_dir
        demucs_worker.MAX_UPLOAD_BYTES = 1024
        demucs_worker.MAX_DURATION_SECONDS = 300
        os.environ.pop("DEMUCS_SMOKE_TEST_OK", None)
        os.environ.pop("DEMUCS_SMOKE_TEST_STEM_COUNT", None)

    def tearDown(self):
        demucs_worker.WORK_DIR = self.old_work_dir
        demucs_worker.MAX_UPLOAD_BYTES = self.old_max_upload
        demucs_worker.MAX_DURATION_SECONDS = self.old_duration
        self.temp.cleanup()

    def test_health_does_not_claim_ready_without_smoke_test(self):
        result = self.client.get("/health").json()
        self.assertTrue(result["ok"])
        self.assertEqual(result["device"], "cpu")
        self.assertFalse(result["readyForSeparation"])
        self.assertFalse(result["smokeTest"]["ok"])

    def test_health_requires_four_stems(self):
        os.environ["DEMUCS_SMOKE_TEST_OK"] = "true"
        os.environ["DEMUCS_SMOKE_TEST_STEM_COUNT"] = "3"
        self.assertFalse(self.client.get("/health").json()["readyForSeparation"])
        os.environ["DEMUCS_SMOKE_TEST_STEM_COUNT"] = "4"
        result = self.client.get("/health").json()
        self.assertTrue(result["readyForSeparation"])
        self.assertEqual(result["smokeTest"]["stemCount"], 4)

    def test_rejects_unsupported_extension(self):
        response = self.client.post("/separate", files={"file": ("song.exe", b"not audio", "application/octet-stream")})
        self.assertEqual(response.status_code, 415)

    def test_rejects_empty_audio(self):
        response = self.client.post("/separate", files={"file": ("song.wav", b"", "audio/wav")})
        self.assertEqual(response.status_code, 400)

    def test_rejects_upload_over_limit(self):
        response = self.client.post("/separate", files={"file": ("song.wav", b"x" * 1025, "audio/wav")})
        self.assertEqual(response.status_code, 413)

    def test_rejects_invalid_audio_probe(self):
        with patch.object(demucs_worker.subprocess, "run", return_value=Mock(returncode=1, stdout="", stderr="invalid")):
            response = self.client.post("/separate", files={"file": ("song.wav", b"fake audio", "audio/wav")})
        self.assertEqual(response.status_code, 400)

    def test_success_returns_zip_with_four_stems_when_inference_is_mocked(self):
        def fake_run(command, **kwargs):
            if command[0] == "ffprobe":
                return Mock(returncode=0, stdout="1.0", stderr="")
            output_root = Path(command[command.index("-o") + 1])
            result_dir = output_root / "htdemucs" / "input"
            result_dir.mkdir(parents=True)
            for stem in ("drums.wav", "bass.wav", "other.wav", "vocals.wav"):
                (result_dir / stem).write_bytes(b"RIFF" + b"x" * 128)
            return Mock(returncode=0, stdout="", stderr="")

        with patch.object(demucs_worker.subprocess, "run", side_effect=fake_run):
            response = self.client.post("/separate", files={"file": ("song.wav", b"fake audio", "audio/wav")})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("content-type"), "application/zip")
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            self.assertEqual(set(archive.namelist()), {"drums.wav", "bass.wav", "other.wav", "vocals.wav"})

    def test_demucs_failure_is_reported_without_internal_paths(self):
        def fake_run(command, **kwargs):
            if command[0] == "ffprobe":
                return Mock(returncode=0, stdout="1.0", stderr="")
            return Mock(returncode=1, stdout="", stderr="/private/server/path/model error")

        with patch.object(demucs_worker.subprocess, "run", side_effect=fake_run):
            response = self.client.post("/separate", files={"file": ("song.wav", b"fake audio", "audio/wav")})
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("/private/server/path", response.text)


if __name__ == "__main__":
    unittest.main()
