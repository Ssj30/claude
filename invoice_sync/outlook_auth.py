"""Acquires a Microsoft Graph access token for unattended runs.

Prefers app-only client-credentials (requires the Azure AD app to have
Mail.Read application-permission, admin-consented) since that runs
non-interactively on a schedule. Falls back to the cached device-code token
if client-credentials aren't configured.
"""

from __future__ import annotations

import json
import os

import msal

from invoice_sync.config import Config


def get_access_token(config: Config) -> str | None:
    if not (config.ms_tenant_id and config.ms_client_id):
        return None

    authority = f"https://login.microsoftonline.com/{config.ms_tenant_id}"

    if config.ms_client_secret:
        app = msal.ConfidentialClientApplication(
            client_id=config.ms_client_id,
            client_credential=config.ms_client_secret,
            authority=authority,
        )
        result = app.acquire_token_for_client(scopes=["https://graph.microsoft.com/.default"])
        if "access_token" in result:
            return result["access_token"]
        raise RuntimeError(f"Outlook app-only auth failed: {result.get('error_description')}")

    if os.path.exists(config.ms_token_cache_path):
        cache = msal.SerializableTokenCache()
        with open(config.ms_token_cache_path) as f:
            cache.deserialize(json.load(f))
        app = msal.PublicClientApplication(
            client_id=config.ms_client_id, authority=authority, token_cache=cache
        )
        accounts = app.get_accounts()
        if accounts:
            result = app.acquire_token_silent(["Mail.Read"], account=accounts[0])
            if result and "access_token" in result:
                return result["access_token"]

    return None
