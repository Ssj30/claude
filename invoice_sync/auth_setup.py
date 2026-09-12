"""One-time interactive auth helpers.

Run:
    python -m invoice_sync.auth_setup google         # opens a local browser (run on your own machine)
    python -m invoice_sync.auth_setup google-device  # device-code flow — no browser needed where this runs
    python -m invoice_sync.auth_setup outlook         # device-code flow, writes ms_token_cache.json

After that, `main.py` runs non-interactively using the cached tokens/refresh
tokens (Google) or client-credentials (Outlook, if you configured an app-only
Azure AD app instead of device code).

`google-device` is the one to use from a headless environment (a server, a
container, this automation's own CI runner): it never opens a browser here —
it prints a short code and a URL, you open that URL on *any* device (your
phone is fine) and enter the code there, and this process polls Google until
you've approved it. It needs an OAuth client of type "TVs and Limited Input
devices" (not "Desktop app") from Google Cloud Console — see README.md.
"""

from __future__ import annotations

import json
import os
import sys
import time

import requests

from invoice_sync.config import Config

GOOGLE_SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/spreadsheets",
]

GOOGLE_DEVICE_CODE_URL = "https://oauth2.googleapis.com/device/code"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"


def setup_google(config: Config) -> None:
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow

    creds = None
    if os.path.exists(config.google_token_path):
        creds = Credentials.from_authorized_user_file(config.google_token_path, GOOGLE_SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(
                config.google_credentials_path, GOOGLE_SCOPES
            )
            creds = flow.run_local_server(port=0)

        os.makedirs(os.path.dirname(config.google_token_path), exist_ok=True)
        with open(config.google_token_path, "w") as f:
            f.write(creds.to_json())
    print(f"Google credentials ready at {config.google_token_path}")


def _load_google_client_id_secret(config: Config) -> tuple[str, str]:
    with open(config.google_credentials_path) as f:
        client_config = json.load(f)
    info = client_config.get("installed") or client_config.get("web")
    if not info:
        raise RuntimeError(
            f"{config.google_credentials_path} doesn't look like a Google OAuth "
            "client secrets file (expected an 'installed' or 'web' key)."
        )
    return info["client_id"], info["client_secret"]


def setup_google_device_flow(config: Config) -> None:
    client_id, client_secret = _load_google_client_id_secret(config)
    scope = " ".join(GOOGLE_SCOPES)

    resp = requests.post(
        GOOGLE_DEVICE_CODE_URL, data={"client_id": client_id, "scope": scope}, timeout=30
    )
    resp.raise_for_status()
    device = resp.json()

    print(f"1. On any device, open: {device['verification_url']}")
    print(f"2. Enter this code:    {device['user_code']}")
    print(f"(expires in {device['expires_in'] // 60} minutes — waiting for approval...)")

    interval = device.get("interval", 5)
    deadline = time.time() + device["expires_in"]
    token: dict | None = None

    while time.time() < deadline:
        time.sleep(interval)
        token_resp = requests.post(
            GOOGLE_TOKEN_URL,
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "device_code": device["device_code"],
                "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
            },
            timeout=30,
        )
        payload = token_resp.json()
        if token_resp.status_code == 200:
            token = payload
            break
        error = payload.get("error")
        if error == "authorization_pending":
            continue
        if error == "slow_down":
            interval += 5
            continue
        raise RuntimeError(f"Google device authorization failed: {payload}")

    if token is None:
        raise RuntimeError("Timed out waiting for Google device authorization approval.")

    creds_payload = {
        "token": token["access_token"],
        "refresh_token": token.get("refresh_token"),
        "token_uri": GOOGLE_TOKEN_URL,
        "client_id": client_id,
        "client_secret": client_secret,
        "scopes": GOOGLE_SCOPES,
    }
    os.makedirs(os.path.dirname(config.google_token_path), exist_ok=True)
    with open(config.google_token_path, "w") as f:
        json.dump(creds_payload, f)
    print(f"Google credentials ready at {config.google_token_path}")


def setup_outlook_device_code(config: Config) -> None:
    import msal

    app = msal.PublicClientApplication(
        client_id=config.ms_client_id,
        authority=f"https://login.microsoftonline.com/{config.ms_tenant_id}",
    )
    flow = app.initiate_device_flow(scopes=["Mail.Read"])
    if "user_code" not in flow:
        raise RuntimeError(f"Failed to create device flow: {flow}")

    print(flow["message"])
    result = app.acquire_token_by_device_flow(flow)
    if "access_token" not in result:
        raise RuntimeError(f"Auth failed: {result.get('error_description')}")

    os.makedirs(os.path.dirname(config.ms_token_cache_path), exist_ok=True)
    with open(config.ms_token_cache_path, "w") as f:
        json.dump(app.token_cache.serialize(), f)
    print(f"Outlook device-code token cache ready at {config.ms_token_cache_path}")


def main() -> None:
    valid = {"google", "google-device", "outlook"}
    if len(sys.argv) != 2 or sys.argv[1] not in valid:
        print(f"Usage: python -m invoice_sync.auth_setup [{'|'.join(sorted(valid))}]")
        sys.exit(1)

    config = Config()
    if sys.argv[1] == "google":
        setup_google(config)
    elif sys.argv[1] == "google-device":
        setup_google_device_flow(config)
    else:
        setup_outlook_device_code(config)


if __name__ == "__main__":
    main()
