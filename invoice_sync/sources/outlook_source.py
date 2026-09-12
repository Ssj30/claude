"""Fetches candidate invoice emails from Outlook / Microsoft 365 via Microsoft
Graph, using an Azure AD app registration (client-credentials flow against a
single mailbox, or delegated device-code flow — see auth_setup.py).
"""

from __future__ import annotations

import base64
from datetime import date, datetime

import requests

from invoice_sync.config import Config
from invoice_sync.models import Attachment, RawMessage, Source

GRAPH_BASE = "https://graph.microsoft.com/v1.0"
MS_SCOPES = ["Mail.Read"]


def _build_filter(config: Config, since: date) -> str:
    since_iso = datetime(since.year, since.month, since.day).strftime("%Y-%m-%dT%H:%M:%SZ")
    return f"receivedDateTime ge {since_iso} and hasAttachments eq true"


def _build_search(config: Config) -> str:
    # Graph $search does an OR-ish full text match; keep it simple and let
    # extraction.py be the real filter on top of "has an attachment".
    return " OR ".join(config.invoice_keywords)


def fetch_messages(access_token: str, config: Config, since: date) -> list[RawMessage]:
    headers = {
        "Authorization": f"Bearer {access_token}",
        "ConsistencyLevel": "eventual",
    }
    params = {
        "$filter": _build_filter(config, since),
        "$search": f'"{_build_search(config)}"',
        "$top": "50",
        "$select": "id,subject,from,receivedDateTime,hasAttachments,webLink",
    }
    mailbox = config.outlook_mailbox
    url = f"{GRAPH_BASE}/{mailbox}/messages" if mailbox != "me" else f"{GRAPH_BASE}/me/messages"

    messages: list[RawMessage] = []
    while url:
        resp = requests.get(url, headers=headers, params=params, timeout=30)
        resp.raise_for_status()
        payload = resp.json()
        params = None  # only needed on first request; nextLink carries the rest

        for item in payload.get("value", []):
            if not item.get("hasAttachments"):
                continue
            raw = _fetch_attachments(item, headers, config)
            if raw is not None:
                messages.append(raw)

        url = payload.get("@odata.nextLink")

    return messages


def _fetch_attachments(item: dict, headers: dict, config: Config) -> RawMessage | None:
    msg_id = item["id"]
    resp = requests.get(
        f"{GRAPH_BASE}/me/messages/{msg_id}/attachments", headers=headers, timeout=30
    )
    resp.raise_for_status()

    attachments: list[Attachment] = []
    for att in resp.json().get("value", []):
        filename = att.get("name", "")
        if not any(filename.lower().endswith(ext) for ext in config.attachment_extensions):
            continue
        content_bytes = att.get("contentBytes")
        if not content_bytes:
            continue
        attachments.append(
            Attachment(
                filename=filename,
                content_type=att.get("contentType", "application/octet-stream"),
                data=base64.b64decode(content_bytes),
            )
        )

    if not attachments:
        return None

    sender = item.get("from", {}).get("emailAddress", {})
    received = item["receivedDateTime"][:10]

    return RawMessage(
        source=Source.OUTLOOK,
        message_id=msg_id,
        subject=item.get("subject", ""),
        sender_name=sender.get("name", ""),
        sender_email=sender.get("address", ""),
        received_at=date.fromisoformat(received),
        attachments=attachments,
        permalink=item.get("webLink"),
    )
