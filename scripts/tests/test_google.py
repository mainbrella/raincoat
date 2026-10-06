import contextlib
import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

MODULE_PATH = Path(__file__).resolve().parents[1] / "google.py"
spec = importlib.util.spec_from_file_location("google_cli", MODULE_PATH)
google_cli = importlib.util.module_from_spec(spec)
spec.loader.exec_module(google_cli)


class NumberEnum:
    def __init__(self, value):
        self.name = {1: "SEARCH", 2: "ENABLED", 3: "ELIGIBLE", 4: "PAUSED", 5: "PAUSED"}[value]


class CampaignCliTests(unittest.TestCase):
    def test_normalize_customer_ids(self):
        self.assertEqual(google_cli.normalize_customer_id("123-456-7890"), "1234567890")
        self.assertEqual(google_cli.normalize_customer_id(" 1234567890 "), "1234567890")
        with self.assertRaises(ValueError):
            google_cli.normalize_customer_id("12-3456-7890")

    def test_config_path_precedence(self):
        env = {"GOOGLE_ADS_CONFIGURATION_FILE_PATH": "~/custom.yaml"}
        self.assertEqual(
            google_cli.resolve_config_path("./explicit.yaml", env), Path("./explicit.yaml")
        )
        self.assertEqual(
            google_cli.resolve_config_path(None, env), Path("~/custom.yaml").expanduser()
        )
        with patch.object(google_cli.Path, "home", return_value=Path("/tmp/user")):
            self.assertEqual(
                google_cli.resolve_config_path(None, {}), Path("/tmp/user/google-ads.yaml")
            )

    def test_query_running_and_all_filters(self):
        running = google_cli.build_query()
        self.assertIn("campaign.status = ENABLED", running)
        self.assertIn("(ELIGIBLE, LIMITED, LEARNING)", running)
        self.assertIn("ORDER BY campaign.name, campaign.id", running)
        self.assertIn("campaign.status != REMOVED", google_cli.build_query(all_campaigns=True))

    def test_fetch_campaigns_collects_multiple_batches(self):
        def row(campaign_id, name, primary_status):
            return SimpleNamespace(
                campaign=SimpleNamespace(
                    id=campaign_id,
                    name=name,
                    advertising_channel_type=1,
                    status=2,
                    primary_status=3 if primary_status == "ELIGIBLE" else 5,
                )
            )

        service = SimpleNamespace(
            search_stream=lambda **kwargs: [
                SimpleNamespace(results=[row(123, "Alpha", "ELIGIBLE")]),
                SimpleNamespace(results=[row(456, "Beta", "PAUSED")]),
            ]
        )
        client = SimpleNamespace(
            get_service=lambda name: service,
            enums=SimpleNamespace(
                AdvertisingChannelTypeEnum=NumberEnum,
                CampaignStatusEnum=NumberEnum,
                CampaignPrimaryStatusEnum=NumberEnum,
            ),
        )
        rows = google_cli.fetch_campaigns(client, "1234567890")
        self.assertEqual([item["id"] for item in rows], ["123", "456"])
        self.assertEqual(rows[0]["primary_status"], "ELIGIBLE")

    def test_enum_name_supports_protobuf_style_wrappers(self):
        wrapper = SimpleNamespace(CampaignStatus=SimpleNamespace(Name=lambda value: {2: "ENABLED"}[value]))
        enums = SimpleNamespace(CampaignStatusEnum=wrapper)
        self.assertEqual(google_cli._enum_name(enums, "CampaignStatusEnum", 2), "ENABLED")

    def test_json_output_and_empty_output(self):
        with tempfile.NamedTemporaryFile() as config:
            out = io.StringIO()
            with patch.object(google_cli, "_load_client", return_value=(object(), type("Api", (Exception,), {}), type("Auth", (Exception,), {}), type("Call", (Exception,), {}))), \
                 patch.object(google_cli, "fetch_campaigns", return_value=[{"id": "1", "name": "Camp", "channel": "SEARCH", "status": "ENABLED", "primary_status": "LIMITED"}]), \
                 contextlib.redirect_stdout(out):
                self.assertEqual(google_cli.main(["-c", "123-456-7890", "--config", config.name, "--json"]), 0)
            self.assertEqual(json.loads(out.getvalue())[0]["name"], "Camp")

            out = io.StringIO()
            with patch.object(google_cli, "_load_client", return_value=(object(), type("Api", (Exception,), {}), type("Auth", (Exception,), {}), type("Call", (Exception,), {}))), \
                 patch.object(google_cli, "fetch_campaigns", return_value=[]), \
                 contextlib.redirect_stdout(out):
                self.assertEqual(google_cli.main(["-c", "1234567890", "--config", config.name]), 0)
            self.assertEqual(out.getvalue().strip(), "No running campaigns found.")

    def test_client_auth_failure_is_reported_without_raw_details(self):
        with tempfile.NamedTemporaryFile() as config:
            err = io.StringIO()
            with patch.object(
                google_cli,
                "_load_client",
                side_effect=RuntimeError("Google Ads authentication failed; check credentials."),
            ), contextlib.redirect_stderr(err):
                self.assertEqual(
                    google_cli.main(["-c", "1234567890", "--config", config.name]), 1
                )
            self.assertIn("authentication failed", err.getvalue())

    def test_environment_credentials_are_used_without_config_override(self):
        with tempfile.NamedTemporaryFile() as config:
            fake_api_error = type("Api", (Exception,), {})
            fake_auth_error = type("Auth", (Exception,), {})
            fake_call_error = type("Call", (Exception,), {})
            with patch.dict(
                google_cli.os.environ,
                {
                    "GOOGLE_ADS_CLIENT_ID": "oauth-client",
                    "GOOGLE_ADS_CONFIGURATION_FILE_PATH": "",
                },
                clear=False,
            ), patch.object(google_cli, "resolve_config_path", return_value=Path(config.name)), \
                 patch.object(google_cli, "fetch_campaigns", return_value=[]):
                with patch.object(
                    google_cli,
                    "_load_client",
                    return_value=(object(), fake_api_error, fake_auth_error, fake_call_error),
                ) as load_client, contextlib.redirect_stdout(io.StringIO()):
                    self.assertEqual(google_cli.main(["-c", "1234567890"]), 0)
                    self.assertEqual(load_client.call_args.args[0], None)
                    self.assertTrue(load_client.call_args.args[2])
                    self.assertEqual(
                        google_cli.main(["-c", "1234567890", "--config", config.name]), 0
                    )
                    self.assertEqual(load_client.call_args.args[0], Path(config.name))
                    self.assertFalse(load_client.call_args.args[2])

    def test_api_error_returns_nonzero_without_stdout(self):
        api_error = type("Api", (Exception,), {})
        api_error_instance = api_error()
        api_error_instance.request_id = "request-123"
        api_error_instance.failure = SimpleNamespace(
            errors=[SimpleNamespace(message="Invalid customer")]
        )
        with tempfile.NamedTemporaryFile() as config:
            out = io.StringIO()
            err = io.StringIO()
            with patch.object(
                google_cli,
                "_load_client",
                return_value=(object(), api_error, type("Auth", (Exception,), {}), type("Call", (Exception,), {})),
            ), patch.object(google_cli, "fetch_campaigns", side_effect=api_error_instance), \
                 contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                self.assertEqual(google_cli.main(["-c", "1234567890", "--config", config.name]), 1)
            self.assertEqual(out.getvalue(), "")
            self.assertIn("request-123", err.getvalue())

    def test_missing_config_is_reported(self):
        err = io.StringIO()
        with patch.dict(google_cli.os.environ, {}, clear=True), \
             patch.object(google_cli, "resolve_config_path", return_value=Path("/missing/ads.yaml")), \
             contextlib.redirect_stderr(err):
            self.assertEqual(google_cli.main(["-c", "1234567890"]), 1)
        self.assertIn("Configuration file not found", err.getvalue())


if __name__ == "__main__":
    unittest.main()
