import importlib.util
import unittest

SPEC = importlib.util.spec_from_file_location("demucs_worker", "demucs_worker.py")
worker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(worker)


class WorkerSafetyTests(unittest.TestCase):
    def test_health_reports_local_cpu_only_engine(self):
        response = worker.health()
        self.assertTrue(response["ok"])
        self.assertEqual(response["engine"], "demucs")
        self.assertEqual(response["device"], "cpu")

    def test_audio_extensions_allowlist(self):
        allowed = {".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aac"}
        for ext in allowed:
            self.assertIn(ext, allowed)
        self.assertNotIn(".exe", allowed)
        self.assertNotIn(".zip", allowed)

    def test_upload_and_duration_limits_are_bounded(self):
        self.assertLessEqual(worker.MAX_UPLOAD_BYTES, 100 * 1024 * 1024)
        self.assertGreater(worker.MAX_UPLOAD_BYTES, 0)
        self.assertGreater(worker.MAX_DURATION_SECONDS, 0)
        self.assertLessEqual(worker.MAX_DURATION_SECONDS, 600)


if __name__ == "__main__":
    unittest.main()
