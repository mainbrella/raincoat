#!/usr/bin/env python3
"""List Google Ads campaigns for a customer account."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Iterable

_ENV_AUTH_KEYS = (
    "GOOGLE_ADS_CLIENT_ID",
    "GOOGLE_ADS_CLIENT_SECRET",
    "GOOGLE_ADS_REFRESH_TOKEN",
    "GOOGLE_ADS_DEVELOPER_TOKEN",
    "GOOGLE_ADS_JSON_KEY_FILE_PATH",
    "GOOGLE_ADS_USE_APPLICATION_DEFAULT_CREDENTIALS",
)


def normalize_customer_id(value: str) -> str:
    """Return a Google Ads customer ID as ten digits."""
    value = value.strip()
    if re.fullmatch(r"[0-9]{10}", value):
        return value
    match = re.fullmatch(r"([0-9]{3})-([0-9]{3})-([0-9]{4})", value)
    if match:
        return "".join(match.groups())
    raise ValueError("customer ID must be 10 digits, optionally formatted as 123-456-7890")


def resolve_config_path(explicit_path: str | None, environ: dict[str, str] | None = None) -> Path:
    """Resolve the config using CLI, Google Ads env, then the standard home path."""
    environ = os.environ if environ is None else environ
    configured = explicit_path or environ.get("GOOGLE_ADS_CONFIGURATION_FILE_PATH")
    return Path(configured).expanduser() if configured else Path.home() / "google-ads.yaml"


def build_query(all_campaigns: bool = False) -> str:
    fields = (
        "campaign.id, campaign.name, campaign.advertising_channel_type, "
        "campaign.status, campaign.primary_status"
    )
    if all_campaigns:
        where = "campaign.status != REMOVED"
    else:
        where = (
            "campaign.status = ENABLED AND campaign.primary_status IN "
            "(ELIGIBLE, LIMITED, LEARNING)"
        )
    return f"SELECT {fields} FROM campaign WHERE {where} ORDER BY campaign.name, campaign.id"


def _enum_name(enum_manager: Any, enum_class_name: str, value: Any) -> str:
    enum_type = getattr(enum_manager, enum_class_name)
    if callable(enum_type):
        return enum_type(value).name
    # With use_proto_plus=false, generated enum wrappers expose the nested
    # protobuf enum descriptor instead of a callable enum class.
    enum_name = enum_class_name[:-4] if enum_class_name.endswith("Enum") else enum_class_name
    return getattr(enum_type, enum_name).Name(value)


def fetch_campaigns(client: Any, customer_id: str, all_campaigns: bool = False) -> list[dict[str, Any]]:
    """Fetch campaigns from all SearchStream batches and return JSON-ready rows."""
    service = client.get_service("GoogleAdsService")
    stream = service.search_stream(
        customer_id=customer_id,
        query=build_query(all_campaigns),
        timeout=60,
    )
    rows: list[dict[str, Any]] = []
    for batch in stream:
        for row in batch.results:
            campaign = row.campaign
            status = _enum_name(client.enums, "CampaignStatusEnum", campaign.status)
            primary_status = _enum_name(client.enums, "CampaignPrimaryStatusEnum", campaign.primary_status)
            rows.append(
                {
                    "id": str(campaign.id),
                    "name": campaign.name,
                    "channel": _enum_name(client.enums, "AdvertisingChannelTypeEnum", campaign.advertising_channel_type),
                    "status": status,
                    "primary_status": primary_status,
                }
            )
    return rows


def print_table(campaigns: list[dict[str, Any]]) -> None:
    headers = ("ID", "NAME", "CHANNEL", "STATUS", "SERVING")
    values = [
        (item["id"], item["name"], item["channel"], item["status"], item["primary_status"])
        for item in campaigns
    ]
    widths = [max(len(headers[i]), *(len(row[i]) for row in values)) for i in range(len(headers))]
    print("  ".join(headers[i].ljust(widths[i]) for i in range(len(headers))))
    for row in values:
        print("  ".join(row[i].ljust(widths[i]) for i in range(len(headers))))


def _make_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="List running Google Ads campaigns.")
    parser.add_argument(
        "--customer-id", "-c", default=os.environ.get("GOOGLE_ADS_CUSTOMER_ID"),
        help="10-digit customer ID (default: GOOGLE_ADS_CUSTOMER_ID)",
    )
    parser.add_argument("--config", help="path to google-ads.yaml")
    parser.add_argument(
        "--login-customer-id",
        help="manager account ID to use for the API request",
    )
    parser.add_argument(
        "--all", action="store_true", dest="all_campaigns",
        help="include every non-removed campaign, including campaigns that are not serving",
    )
    parser.add_argument("--json", action="store_true", help="print JSON instead of a table")
    return parser


def _load_client(
    config_path: Path | None,
    login_customer_id: str | None,
    use_environment: bool = False,
) -> tuple[Any, type[Exception], type[Exception], type[Exception]]:
    # google.py shares a name with Google's namespace package. Remove this script
    # directory before importing google.ads so Python cannot resolve this file as
    # the `google` package. Keeping it out avoids recursive imports.
    script_dir = str(Path(__file__).resolve().parent)
    sys.path[:] = [
        entry for entry in sys.path
        if str(Path(entry or os.getcwd()).resolve()) != script_dir
    ]

    try:
        from google.ads.googleads.client import GoogleAdsClient
        from google.ads.googleads.errors import GoogleAdsException
        from google.auth.exceptions import GoogleAuthError
        from google.api_core.exceptions import GoogleAPICallError
        import yaml
    except ImportError as exc:
        raise RuntimeError(
            "Google Ads client library is missing; install it with `python -m pip install -r requirements.txt`."
        ) from exc

    try:
        if use_environment:
            client = GoogleAdsClient.load_from_env()
        else:
            client = GoogleAdsClient.load_from_storage(str(config_path))
    except yaml.YAMLError:
        # Parser errors can quote credential values; do not echo them.
        raise ValueError("configuration YAML is invalid") from None
    except GoogleAuthError:
        # OAuth errors can include credential response data; keep the message safe.
        raise RuntimeError("Google Ads authentication failed; check the OAuth credentials and refresh token.") from None
    if login_customer_id:
        client.login_customer_id = login_customer_id
    return client, GoogleAdsException, GoogleAuthError, GoogleAPICallError


def main(argv: Iterable[str] | None = None) -> int:
    parser = _make_parser()
    args = parser.parse_args(argv)

    if not args.customer_id:
        parser.error("provide --customer-id or set GOOGLE_ADS_CUSTOMER_ID")
    try:
        customer_id = normalize_customer_id(args.customer_id)
        login_customer_id = (
            normalize_customer_id(args.login_customer_id) if args.login_customer_id else None
        )
    except ValueError as exc:
        parser.error(str(exc))

    config_override = args.config or os.environ.get("GOOGLE_ADS_CONFIGURATION_FILE_PATH")
    use_environment = not config_override and any(os.environ.get(key) for key in _ENV_AUTH_KEYS)
    config_path = None if use_environment else resolve_config_path(config_override)
    if config_path is not None and not config_path.is_file():
        print(
            f"Configuration file not found: {config_path}\n"
            "Create google-ads.yaml, pass --config PATH, or configure Google Ads environment credentials.",
            file=sys.stderr,
        )
        return 1

    try:
        client, google_ads_exception, google_auth_error, google_api_error = _load_client(
            config_path, login_customer_id, use_environment
        )
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    except OSError:
        print("Could not read Google Ads configuration file.", file=sys.stderr)
        return 1
    except ValueError:
        print("Google Ads configuration is invalid; check its YAML syntax and required fields.", file=sys.stderr)
        return 1
    except ImportError as exc:
        print(f"Google Ads dependencies are unavailable: {exc}", file=sys.stderr)
        return 1

    try:
        campaigns = fetch_campaigns(client, customer_id, args.all_campaigns)
    except google_ads_exception as exc:
        print(f"Google Ads API request failed (request ID: {exc.request_id}):", file=sys.stderr)
        for error in exc.failure.errors:
            print(f"  {error.message}", file=sys.stderr)
        return 1
    except google_auth_error:
        print("Google Ads authentication failed; check the OAuth credentials and refresh token.", file=sys.stderr)
        return 1
    except google_api_error as exc:
        print(f"Google Ads API call failed: {exc}", file=sys.stderr)
        return 1

    if args.json:
        print(json.dumps(campaigns, indent=2))
    elif campaigns:
        print_table(campaigns)
    else:
        print("No campaigns found." if args.all_campaigns else "No running campaigns found.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
