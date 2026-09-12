"""One-time interactive auth helpers.

Run:
    python -m invoice_sync.auth_setup google     # opens a browser, writes google_token.json
    python -m invoice_sync.auth_setup outlook    # device-code flow, writes ms_token_cache.json

After that, `main.py` runs non-interactively using the cached tokens/refresh
tokens (Google) or client-credentials (Outlook, if you configured an app-only
Azure AD app instead of device code).
"""

from __future__ import annotations

import json
import os
import sys

from invoice_sync.config import Config

GOOGLE_SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/spreadsheets",
]


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
    if len(sys.argv) != 2 or sys.argv[1] not in {"google", "outlook"}:
        print("Usage: python -m invoice_sync.auth_setup [google|outlook]")
        sys.exit(1)

    config = Config()
    if sys.argv[1] == "google":
        setup_google(config)
    else:
        setup_outlook_device_code(config)


if __name__ == "__main__":
    main()
