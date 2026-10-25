import importlib.util
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

spec = importlib.util.spec_from_file_location("separation_app", Path(__file__).with_name("app.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
client = TestClient(module.app)

class SeparationServiceTests(unittest.TestCase):
    def test_health_never_claims_model_is_ready_without_smoke_test(self):
        with patch.object(shutil, "which", side_effect=lambda name: "/usr/bin/" + name):
            response = client.get("/health")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["demucsInstalled"])
        self.assertFalse(body["modelWeightsDownloaded"])
        self.assertFalse(body["readyForSeparation"])

    def test_separation_requires_configured_token(self):
        with patch.object(module, "API_TOKEN", ""):
            response = client.post("/separate", files={"file": ("song.wav", b"abc", "audio/wav")})
        self.assertEqual(response.status_code, 503)

    def test_separation_rejects_missing_or_wrong_token(self):
        with patch.object(module, "API_TOKEN", "test-secret"):
            missing = client.post("/separate", files={"file": ("song.wav", b"abc", "audio/wav")})
            wrong = client.post("/separate", headers={"Authorization": "Bearer wrong"}, files={"file": ("song.wav", b"abc", "audio/wav")})
        self.assertEqual(missing.status_code, 401)
        self.assertEqual(wrong.status_code, 401)

    def test_rejects_unsupported_extension(self):
        with patch.object(module, "API_TOKEN", "test-secret"), patch.object(shutil, "which", side_effect=lambda name: "/usr/bin/" + name):
            response = client.post("/separate", headers={"Authorization": "Bearer test-secret"}, files={"file": ("song.exe", b"abc", "application/octet-stream")})
        self.assertEqual(response.status_code, 415)

    def test_empty_upload_is_rejected(self):
        with patch.object(module, "API_TOKEN", "test-secret"), patch.object(shutil, "which", side_effect=lambda name: "/usr/bin/" + name):
            response = client.post("/separate", headers={"Authorization": "Bearer test-secret"}, files={"file": ("song.wav", b"", "audio/wav")})
        self.assertEqual(response.status_code, 400)

    def test_successful_mocked_run_returns_four_stems_zip(self):
        def fake_run(command, **kwargs):
            output_dir = Path(command[command.index('--out') + 1])
            stem_dir = output_dir / module.MODEL_NAME / 'input'
            stem_dir.mkdir(parents=True)
            for name in ('vocals.wav', 'drums.wav', 'bass.wav', 'other.wav'):
                (stem_dir / name).write_bytes(b'fake-audio-stem')
            class Result:
                returncode = 0
                stdout = ''
                stderr = ''
            return Result()

        with patch.object(module, 'API_TOKEN', 'test-secret'), patch.object(shutil, 'which', side_effect=lambda name: '/usr/bin/' + name), patch.object(module.subprocess, 'run', side_effect=fake_run):
            response = client.post('/separate', headers={'Authorization': 'Bearer test-secret'}, files={'file': ('song.wav', b'fake-input', 'audio/wav')})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get('content-type'), 'application/zip')
        import io
        import zipfile
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            self.assertEqual(set(archive.namelist()), {'vocals.wav', 'drums.wav', 'bass.wav', 'other.wav'})

    def test_missing_runtime_returns_service_unavailable(self):
        with patch.object(module, "API_TOKEN", "test-secret"), patch.object(shutil, "which", return_value=None):
            response = client.post("/separate", headers={"Authorization": "Bearer test-secret"}, files={"file": ("song.wav", b"audio", "audio/wav")})
        self.assertEqual(response.status_code, 503)

    def test_upload_size_limit_is_enforced(self):
        with patch.object(module, "API_TOKEN", "test-secret"), patch.object(shutil, "which", side_effect=lambda name: "/usr/bin/" + name), patch.object(module, "MAX_UPLOAD_BYTES", 4):
            response = client.post("/separate", headers={"Authorization": "Bearer test-secret"}, files={"file": ("song.wav", b"12345", "audio/wav")})
        self.assertEqual(response.status_code, 413)

    def test_demucs_failure_does_not_leak_subprocess_logs(self):
        class FailedResult:
            returncode = 1
            stdout = "private output path"
            stderr = "internal error details"

        with patch.object(module, "API_TOKEN", "test-secret"), patch.object(shutil, "which", side_effect=lambda name: "/usr/bin/" + name), patch.object(module.subprocess, "run", return_value=FailedResult()):
            response = client.post("/separate", headers={"Authorization": "Bearer test-secret"}, files={"file": ("song.wav", b"fake-input", "audio/wav")})
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["detail"], "Demucs could not separate this audio file.")
        self.assertNotIn("private output path", response.text)
        self.assertNotIn("internal error details", response.text)

if __name__ == "__main__":
    unittest.main()
