import io
import shutil
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

import app

client = TestClient(app.app)


class DemucsWorkerTests(unittest.TestCase):
    def setUp(self):
        app.SMOKE_TEST_PASSED = False

    def test_capabilities_never_claims_production_availability(self):
        with patch.object(shutil, "which", side_effect=lambda name: "/usr/bin/" + name):
            body = client.get("/capabilities").json()
        self.assertFalse(body["available"])
        self.assertFalse(body["ready_for_production"])
        self.assertTrue(body["runtime_installed"])
        self.assertFalse(body["paid_provider"])

    def test_health_is_process_health_not_model_readiness(self):
        with patch.object(shutil, "which", return_value=None):
            response = client.get("/health")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertFalse(body["ok"])
        self.assertFalse(body["readyForSeparation"])
        self.assertFalse(body["smokeTest"]["ok"])

    def test_missing_token_configuration_is_unavailable(self):
        with patch.object(app, "WORKER_TOKEN", ""):
            response = client.post("/separate", files={"audio": ("song.wav", b"audio", "audio/wav")})
        self.assertEqual(response.status_code, 503)

    def test_missing_or_wrong_token_is_rejected(self):
        with patch.object(app, "WORKER_TOKEN", "secret"):
            missing = client.post("/separate", files={"audio": ("song.wav", b"audio", "audio/wav")})
            wrong = client.post("/separate", headers={"X-Worker-Token": "wrong"}, files={"audio": ("song.wav", b"audio", "audio/wav")})
        self.assertEqual(missing.status_code, 401)
        self.assertEqual(wrong.status_code, 401)

    def test_unsupported_extension_is_rejected_after_auth(self):
        with patch.object(app, "WORKER_TOKEN", "secret"), patch.object(shutil, "which", side_effect=lambda name: "/usr/bin/" + name):
            response = client.post("/separate", headers={"X-Worker-Token": "secret"}, files={"audio": ("song.exe", b"audio", "application/octet-stream")})
        self.assertEqual(response.status_code, 415)

    def test_missing_runtime_is_rejected(self):
        with patch.object(app, "WORKER_TOKEN", "secret"), patch.object(shutil, "which", return_value=None):
            response = client.post("/separate", headers={"X-Worker-Token": "secret"}, files={"audio": ("song.wav", b"audio", "audio/wav")})
        self.assertEqual(response.status_code, 503)

    def test_success_returns_four_stem_archive(self):
        def fake_run(command, **kwargs):
            if command[0] == "ffprobe":
                class Probe:
                    returncode = 0
                    stdout = "1.5"
                    stderr = ""
                return Probe()
            output_dir = Path(command[command.index("--out") + 1])
            stem_dir = output_dir / "mdx_q" / "input"
            stem_dir.mkdir(parents=True)
            for name in ("vocals.wav", "drums.wav", "bass.wav", "other.wav"):
                (stem_dir / name).write_bytes(b"RIFF" + b"x" * 100)
            class Separation:
                returncode = 0
                stdout = ""
                stderr = ""
            return Separation()

        with patch.object(app, "WORKER_TOKEN", "secret"), patch.object(shutil, "which", side_effect=lambda name: "/usr/bin/" + name), patch.object(app.subprocess, "run", side_effect=fake_run):
            response = client.post("/separate", headers={"X-Worker-Token": "secret"}, files={"audio": ("input.wav", b"fake-audio", "audio/wav")})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("content-type"), "application/zip")
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            self.assertEqual(set(archive.namelist()), {"vocals.wav", "drums.wav", "bass.wav", "other.wav"})
        # A successful real-audio request validates the worker without manual env toggles.
        with patch.object(shutil, "which", side_effect=lambda name: "/usr/bin/" + name):
            health = client.get("/health").json()
        self.assertTrue(health["readyForSeparation"])
        self.assertEqual(health["smokeTest"]["stemCount"], 4)

    def test_invalid_audio_probe_is_rejected(self):
        class BadProbe:
            returncode = 1
            stdout = "not-a-duration"
            stderr = "private diagnostic"
        with patch.object(app, "WORKER_TOKEN", "secret"), patch.object(shutil, "which", side_effect=lambda name: "/usr/bin/" + name), patch.object(app.subprocess, "run", return_value=BadProbe()):
            response = client.post("/separate", headers={"X-Worker-Token": "secret"}, files={"audio": ("input.wav", b"fake-audio", "audio/wav")})
        self.assertEqual(response.status_code, 415)
        self.assertNotIn("private diagnostic", response.text)


if __name__ == "__main__":
    unittest.main()
