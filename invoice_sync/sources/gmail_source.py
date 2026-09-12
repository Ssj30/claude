"""Fetches candidate invoice emails from Gmail via the Gmail API.

Auth: uses a Google OAuth "installed app" credential (the same one used for
Drive + Sheets, since all three scopes live under one consumer OAuth app).
Run `python -m invoice_sync.auth_setup` once to produce the token file.
"""

from __future__ import annotations

import base64
from datetime import date, datetime, timedelta

from googleapiclient.discovery import Resource

from invoice_sync.config import Config
from invoice_sync.models import Attachment, RawMessage, Source

GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]


def _build_query(config: Config, since: date) -> str:
    keyword_clause = " OR ".join(f'"{kw}"' for kw in config.invoice_keywords)
    after = since.strftime("%Y/%m/%d")
    return f"has:attachment ({keyword_clause}) after:{after}"


def fetch_messages(service: Resource, config: Config, since: date) -> list[RawMessage]:
    """Search Gmail for invoice-like messages with attachments since `since`."""
    query = _build_query(config, since)
    messages: list[RawMessage] = []

    request = service.users().messages().list(userId="me", q=query, maxResults=100)
    while request is not None:
        response = request.execute()
        for item in response.get("messages", []):
            msg = (
                service.users()
                .messages()
                .get(userId="me", id=item["id"], format="full")
                .execute()
            )
            raw = _parse_message(service, msg, config)
            if raw is not None:
                messages.append(raw)
        request = service.users().messages().list_next(request, response)

    return messages


def _header(headers: list[dict], name: str) -> str:
    for h in headers:
        if h["name"].lower() == name.lower():
            return h["value"]
    return ""


def _parse_sender(from_header: str) -> tuple[str, str]:
    # "Jane Vendor <billing@vendor.com>" -> ("Jane Vendor", "billing@vendor.com")
    if "<" in from_header and ">" in from_header:
        name, email = from_header.rsplit("<", 1)
        return name.strip().strip('"'), email.rstrip(">").strip()
    return from_header, from_header


def _walk_parts(parts: list[dict]) -> list[dict]:
    flat = []
    for part in parts:
        if part.get("parts"):
            flat.extend(_walk_parts(part["parts"]))
        else:
            flat.append(part)
    return flat


def _parse_message(service: Resource, msg: dict, config: Config) -> RawMessage | None:
    headers = msg["payload"].get("headers", [])
    subject = _header(headers, "Subject")
    from_header = _header(headers, "From")
    sender_name, sender_email = _parse_sender(from_header)

    internal_ts = int(msg.get("internalDate", "0")) / 1000
    received_at = datetime.fromtimestamp(internal_ts).date()

    parts = _walk_parts(msg["payload"].get("parts", []) or [])
    attachments: list[Attachment] = []
    for part in parts:
        filename = part.get("filename") or ""
        if not filename:
            continue
        if not any(filename.lower().endswith(ext) for ext in config.attachment_extensions):
            continue
        body = part.get("body", {})
        attachment_id = body.get("attachmentId")
        if not attachment_id:
            continue
        raw = (
            service.users()
            .messages()
            .attachments()
            .get(userId="me", messageId=msg["id"], id=attachment_id)
            .execute()
        )
        data = base64.urlsafe_b64decode(raw["data"])
        attachments.append(
            Attachment(
                filename=filename,
                content_type=part.get("mimeType", "application/octet-stream"),
                data=data,
            )
        )

    if not attachments:
        return None

    return RawMessage(
        source=Source.GMAIL,
        message_id=msg["id"],
        subject=subject,
        sender_name=sender_name,
        sender_email=sender_email,
        received_at=received_at,
        attachments=attachments,
        permalink=f"https://mail.google.com/mail/u/0/#all/{msg['id']}",
    )
