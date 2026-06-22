import unittest

from app.services.meta_api_errors import MetaAPIError, TokenExpiredError, extract_data_or_raise


class TestMetaAPIErrorFromGraph(unittest.TestCase):
    def test_composes_user_msg_and_subcode(self) -> None:
        err = MetaAPIError.from_graph_result(
            {
                "status": "http_error",
                "message": "Invalid parameter",
                "error": {
                    "message": "Invalid parameter",
                    "code": 100,
                    "error_subcode": 1234,
                    "error_user_msg": "Escolha um orcamento valido",
                },
            },
        )
        self.assertEqual(err.error_code, "100")
        self.assertEqual(err.subcode, 1234)
        self.assertIn("Invalid parameter", err.message)
        self.assertIn("Escolha um orcamento valido", err.message)
        self.assertIn("subcode=1234", err.message)


class TestExtractDataOrRaise(unittest.TestCase):
    def test_success_returns_data(self) -> None:
        self.assertEqual(
            extract_data_or_raise({"status": "success", "data": {"id": "1"}}),
            {"id": "1"},
        )

    def test_raises_meta_api_error(self) -> None:
        with self.assertRaises(MetaAPIError) as ctx:
            extract_data_or_raise(
                {
                    "status": "http_error",
                    "error": {"message": "fail", "code": 200},
                },
            )
        self.assertEqual(ctx.exception.error_code, "200")

    def test_raises_token_expired(self) -> None:
        with self.assertRaises(TokenExpiredError):
            extract_data_or_raise(
                {
                    "status": "auth_error",
                    "message": "expired",
                    "error": {"message": "expired", "code": 190},
                },
            )


if __name__ == "__main__":
    unittest.main()
