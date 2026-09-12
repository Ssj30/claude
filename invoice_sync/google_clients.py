"""Builds authenticated Google API clients from the cached OAuth token."""

from __future__ import annotations

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import Resource, build

from invoice_sync.auth_setup import GOOGLE_SCOPES
from invoice_sync.config import Config


def load_credentials(config: Config) -> Credentials:
    creds = Credentials.from_authorized_user_file(config.google_token_path, GOOGLE_SCOPES)
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        with open(config.google_token_path, "w") as f:
            f.write(creds.to_json())
    return creds


def build_gmail(config: Config) -> Resource:
    return build("gmail", "v1", credentials=load_credentials(config), cache_discovery=False)


def build_drive(config: Config) -> Resource:
    return build("drive", "v3", credentials=load_credentials(config), cache_discovery=False)


def build_sheets(config: Config) -> Resource:
    return build("sheets", "v4", credentials=load_credentials(config), cache_discovery=False)
