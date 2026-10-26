import importlib.util
import os
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

MODULE_PATH = Path(__file__).resolve().parents[1] / "demucs-worker" / "app.py"
SPEC = importlib.util.spec_from_file_location("demucs_service_app", MODULE_PATH)
service = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(service)


class DemucsServiceTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(service.app)
        self.old_token = service.WORKER_TOKEN
        service.WORKER_TOKEN = "test-secret-token"
        self.old_smoke_ok = os.environ.pop("DEMUCS_SMOKE_TEST_OK", None)
        self.old_stem_count = os.environ.pop("DEMUCS_SMOKE_TEST_STEM_COUNT", None)

    def tearDown(self):
        service.WORKER_TOKEN = self.old_token
        os.environ.pop("DEMUCS_SMOKE_TEST_OK", None)
        os.environ.pop("DEMUCS_SMOKE_TEST_STEM_COUNT", None)
        if self.old_smoke_ok is not None:
            os.environ["DEMUCS_SMOKE_TEST_OK"] = self.old_smoke_ok
        if self.old_stem_count is not None:
            os.environ["DEMUCS_SMOKE_TEST_STEM_COUNT"] = self.old_stem_count

    def test_health_contract_matches_main_app_but_never_assumes_smoke_success(self):
        with patch.object(service.shutil, "which", return_value="/usr/bin/fake"):
            data = self.client.get("/health").json()
        self.assertTrue(data["ok"])
        self.assertEqual(data["engine"], "demucs")
        self.assertFalse(data["readyForSeparation"])
        self.assertFalse(data["smokeTest"]["ok"])
        self.assertEqual(data["smokeTest"]["stemCount"], 0)

    def test_health_requires_smoke_flag_and_four_stems(self):
        os.environ["DEMUCS_SMOKE_TEST_OK"] = "true"
        os.environ["DEMUCS_SMOKE_TEST_STEM_COUNT"] = "3"
        with patch.object(service.shutil, "which", return_value="/usr/bin/fake"):
            self.assertFalse(self.client.get("/health").json()["readyForSeparation"])
            os.environ["DEMUCS_SMOKE_TEST_STEM_COUNT"] = "4"
            self.assertTrue(self.client.get("/health").json()["readyForSeparation"])

    def test_separation_rejects_missing_and_invalid_tokens(self):
        with patch.object(service.shutil, "which", return_value="/usr/bin/fake"):
            missing = self.client.post("/separate", files={"audio": ("song.wav", b"fake", "audio/wav")})
            invalid = self.client.post("/separate", headers={"X-Worker-Token": "wrong"}, files={"audio": ("song.wav", b"fake", "audio/wav")})
        self.assertEqual(missing.status_code, 401)
        self.assertEqual(invalid.status_code, 401)

    def test_separation_requires_runtime_even_with_valid_token(self):
        with patch.object(service.shutil, "which", return_value=None):
            response = self.client.post("/separate", headers={"X-Worker-Token": "test-secret-token"}, files={"audio": ("song.wav", b"fake", "audio/wav")})
        self.assertEqual(response.status_code, 503)


if __name__ == "__main__":
    unittest.main()
