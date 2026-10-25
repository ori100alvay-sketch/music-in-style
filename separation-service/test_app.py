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

    def test_rejects_unsupported_extension(self):
        response = client.post("/separate", files={"file": ("song.exe", b"abc", "application/octet-stream")})
        self.assertEqual(response.status_code, 415)

    def test_empty_upload_is_rejected(self):
        with patch.object(shutil, "which", side_effect=lambda name: "/usr/bin/" + name):
            response = client.post("/separate", files={"file": ("song.wav", b"", "audio/wav")})
        self.assertEqual(response.status_code, 400)

    def test_missing_runtime_returns_service_unavailable(self):
        with patch.object(shutil, "which", return_value=None):
            response = client.post("/separate", files={"file": ("song.wav", b"audio", "audio/wav")})
        self.assertEqual(response.status_code, 503)

if __name__ == "__main__":
    unittest.main()
