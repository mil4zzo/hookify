import unittest

import httpx

from app.core.supabase_retry import with_postgrest_retry


class _APIErrorLike(Exception):
    """Mimics postgrest.APIError shape (.code, .details)."""

    def __init__(self, code: str, message: str = "", details: dict | None = None) -> None:
        super().__init__(message or code)
        self.code = code
        self.details = details or {}


class TestWithPostgrestRetry(unittest.TestCase):
    def test_first_call_ok(self) -> None:
        self.assertEqual(with_postgrest_retry("op", lambda: 42), 42)

    def test_retries_on_remote_protocol_error(self) -> None:
        calls = [0]

        def flaky() -> str:
            calls[0] += 1
            if calls[0] < 2:
                raise httpx.RemoteProtocolError("connection terminated")
            return "ok"

        self.assertEqual(with_postgrest_retry("op", flaky, attempts=4), "ok")
        self.assertEqual(calls[0], 2)

    def test_raises_after_exhausted(self) -> None:
        def always_fail() -> None:
            raise httpx.RemoteProtocolError("x")

        with self.assertRaises(httpx.RemoteProtocolError):
            with_postgrest_retry("op", always_fail, attempts=2, base_delay=0.01)

    def test_retries_on_deadlock_via_code_attr(self) -> None:
        calls = [0]

        def flaky() -> str:
            calls[0] += 1
            if calls[0] < 2:
                raise _APIErrorLike(code="40P01", message="deadlock detected")
            return "ok"

        self.assertEqual(with_postgrest_retry("op", flaky, attempts=4, base_delay=0.01), "ok")
        self.assertEqual(calls[0], 2)

    def test_retries_on_deadlock_via_string_match(self) -> None:
        calls = [0]

        def flaky() -> str:
            calls[0] += 1
            if calls[0] < 2:
                raise RuntimeError("{'code': '40P01', 'message': 'deadlock detected'}")
            return "ok"

        self.assertEqual(with_postgrest_retry("op", flaky, attempts=4, base_delay=0.01), "ok")
        self.assertEqual(calls[0], 2)

    def test_does_not_retry_on_unrelated_error(self) -> None:
        calls = [0]

        def fail() -> None:
            calls[0] += 1
            raise ValueError("unrelated")

        with self.assertRaises(ValueError):
            with_postgrest_retry("op", fail, attempts=4, base_delay=0.01)
        self.assertEqual(calls[0], 1)

    def test_raises_after_exhausted_deadlock(self) -> None:
        def always_deadlock() -> None:
            raise _APIErrorLike(code="40P01", message="deadlock detected")

        with self.assertRaises(_APIErrorLike):
            with_postgrest_retry("op", always_deadlock, attempts=2, base_delay=0.01)


if __name__ == "__main__":
    unittest.main()
