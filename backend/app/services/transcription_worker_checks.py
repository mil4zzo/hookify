import unittest
from unittest.mock import Mock, patch

from app.services.transcription_service import TranscriptionResult
from app.services.transcription_worker import (
    _extract_video_info,
    retry_single_transcription,
    run_transcription_batch,
)


class _FakeTracker:
    def __init__(self) -> None:
        self.heartbeats = []

    def heartbeat(self, job_id, status, progress=0, message=None, details=None, result_count=None):
        self.heartbeats.append(
            {
                "job_id": job_id,
                "status": status,
                "progress": progress,
                "message": message,
                "details": details or {},
                "result_count": result_count,
            }
        )
        return True

    def get_job(self, job_id):
        return {"id": job_id, "status": "processing"}


class TestExtractVideoInfo(unittest.TestCase):
    def test_uses_only_primary_video_id_with_actor_id(self) -> None:
        formatted_ads = [
            {
                "ad_name": "ad-sem-primary",
                "creative": {"actor_id": "actor-1", "video_id": "legacy-video"},
            },
            {
                "ad_name": "ad-com-primary",
                "primary_video_id": "video-123",
                "creative": {"actor_id": "actor-2"},
            },
        ]

        result = _extract_video_info(formatted_ads)

        self.assertEqual(
            result,
            {"ad-com-primary": {"video_id": "video-123", "actor_id": "actor-2"}},
        )


class TestRetrySingleTranscription(unittest.TestCase):
    @patch("app.services.transcription_worker._transcribe_single")
    @patch("app.services.transcription_worker._resolve_video_url", return_value="https://video.test/source.mp4")
    @patch("app.services.transcription_worker.GraphAPI")
    def test_retry_passes_non_breaking_check_cancelled(
        self,
        graph_api_cls: Mock,
        resolve_video_url: Mock,
        transcribe_single: Mock,
    ) -> None:
        retry_single_transcription(
            "jwt",
            "user-1",
            "token-1",
            "Meu Anuncio",
            "video-1",
            "actor-1",
        )

        graph_api_cls.assert_called_once_with("token-1", user_id="user-1")
        resolve_video_url.assert_called_once()
        transcribe_single.assert_called_once()
        args = transcribe_single.call_args.args
        self.assertEqual(args[:6], ("jwt", "user-1", "Meu Anuncio", "https://video.test/source.mp4", "video-1", "actor-1"))
        self.assertTrue(callable(args[6]))
        self.assertFalse(args[6]())


class TestRunTranscriptionBatch(unittest.TestCase):
    @patch("app.services.transcription_worker._transcribe_single")
    @patch("app.services.transcription_worker._resolve_video_url")
    @patch("app.services.transcription_worker.GraphAPI")
    @patch("app.services.transcription_worker.supabase_repo.get_existing_transcriptions", return_value={})
    @patch("app.services.transcription_worker.get_job_tracker")
    def test_marks_partial_completion_without_new_status(
        self,
        get_job_tracker: Mock,
        get_existing_transcriptions: Mock,
        graph_api_cls: Mock,
        resolve_video_url: Mock,
        transcribe_single: Mock,
    ) -> None:
        tracker = _FakeTracker()
        get_job_tracker.return_value = tracker
        resolve_video_url.side_effect = [
            "https://video.test/a.mp4",
            "https://video.test/b.mp4",
        ]
        transcribe_single.side_effect = [
            TranscriptionResult(success=True),
            TranscriptionResult(success=False, error="erro"),
        ]

        formatted_ads = [
            {"ad_name": "ad-1", "primary_video_id": "video-1", "creative": {"actor_id": "actor-1"}},
            {"ad_name": "ad-2", "primary_video_id": "video-2", "creative": {"actor_id": "actor-2"}},
        ]

        run_transcription_batch(
            "jwt",
            "user-1",
            "access-token",
            formatted_ads,
            transcription_job_id="job-1",
        )

        final_heartbeat = tracker.heartbeats[-1]
        self.assertEqual(final_heartbeat["status"], "completed")
        self.assertEqual(final_heartbeat["details"]["success_count"], 1)
        self.assertEqual(final_heartbeat["details"]["fail_count"], 1)
        self.assertEqual(final_heartbeat["details"]["skipped_existing"], 0)
        self.assertTrue(final_heartbeat["details"]["completed_with_failures"])
        self.assertIn("parcialmente", final_heartbeat["message"])

    @patch("app.services.transcription_worker._transcribe_single")
    @patch("app.services.transcription_worker._resolve_video_url", return_value="https://video.test/a.mp4")
    @patch("app.services.transcription_worker.GraphAPI")
    @patch("app.services.transcription_worker.supabase_repo.get_existing_transcriptions", return_value={})
    @patch("app.services.transcription_worker.get_job_tracker")
    def test_marks_failed_when_all_transcriptions_fail(
        self,
        get_job_tracker: Mock,
        get_existing_transcriptions: Mock,
        graph_api_cls: Mock,
        resolve_video_url: Mock,
        transcribe_single: Mock,
    ) -> None:
        tracker = _FakeTracker()
        get_job_tracker.return_value = tracker
        transcribe_single.return_value = TranscriptionResult(success=False, error="erro")

        formatted_ads = [
            {"ad_name": "ad-1", "primary_video_id": "video-1", "creative": {"actor_id": "actor-1"}},
        ]

        run_transcription_batch(
            "jwt",
            "user-1",
            "access-token",
            formatted_ads,
            transcription_job_id="job-2",
        )

        final_heartbeat = tracker.heartbeats[-1]
        self.assertEqual(final_heartbeat["status"], "failed")
        self.assertEqual(final_heartbeat["details"]["success_count"], 0)
        self.assertEqual(final_heartbeat["details"]["fail_count"], 1)
        self.assertEqual(final_heartbeat["details"]["skipped_existing"], 0)
        self.assertFalse(final_heartbeat["details"]["completed_with_failures"])


if __name__ == "__main__":
    unittest.main()
