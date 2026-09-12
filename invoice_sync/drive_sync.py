"""Uploads invoice attachments into a Drive folder, organized by year/month."""

from __future__ import annotations

import io

from googleapiclient.discovery import Resource
from googleapiclient.http import MediaIoBaseUpload

from invoice_sync.models import InvoiceRecord

_folder_cache: dict[str, str] = {}


def _get_or_create_subfolder(drive: Resource, parent_id: str, name: str) -> str:
    cache_key = f"{parent_id}/{name}"
    if cache_key in _folder_cache:
        return _folder_cache[cache_key]

    query = (
        f"'{parent_id}' in parents and name = '{name}' "
        "and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
    )
    resp = drive.files().list(q=query, fields="files(id)").execute()
    files = resp.get("files", [])
    if files:
        folder_id = files[0]["id"]
    else:
        metadata = {
            "name": name,
            "mimeType": "application/vnd.google-apps.folder",
            "parents": [parent_id],
        }
        folder = drive.files().create(body=metadata, fields="id").execute()
        folder_id = folder["id"]

    _folder_cache[cache_key] = folder_id
    return folder_id


def upload_invoice(drive: Resource, root_folder_id: str, record: InvoiceRecord) -> tuple[str, str]:
    """Uploads the invoice's attachment, filed under <root>/<YYYY>/<MM>/.
    Returns (file_id, web_view_link)."""
    invoice_date = record.invoice_date
    year_folder = _get_or_create_subfolder(drive, root_folder_id, str(invoice_date.year))
    month_folder = _get_or_create_subfolder(drive, year_folder, f"{invoice_date.month:02d}")

    vendor_slug = record.vendor_normalized.replace(" ", "-") or "unknown-vendor"
    amount_part = f"{record.amount:.2f}" if record.amount is not None else "unknown"
    ext = record.attachment.filename.rsplit(".", 1)[-1] if "." in record.attachment.filename else "pdf"
    filename = f"{invoice_date.isoformat()}_{vendor_slug}_{amount_part}_{record.source.value}.{ext}"

    metadata = {"name": filename, "parents": [month_folder]}
    media = MediaIoBaseUpload(
        io.BytesIO(record.attachment.data), mimetype=record.attachment.content_type, resumable=False
    )
    uploaded = (
        drive.files()
        .create(body=metadata, media_body=media, fields="id, webViewLink")
        .execute()
    )
    return uploaded["id"], uploaded.get("webViewLink", "")
