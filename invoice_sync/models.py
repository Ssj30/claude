"""Core data types shared across the pipeline."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import date
from enum import Enum


class Source(str, Enum):
    GMAIL = "gmail"
    OUTLOOK = "outlook"


@dataclass
class Attachment:
    """A single email attachment, already downloaded into memory."""

    filename: str
    content_type: str
    data: bytes

    @property
    def sha256(self) -> str:
        return hashlib.sha256(self.data).hexdigest()

    @property
    def size(self) -> int:
        return len(self.data)


@dataclass
class RawMessage:
    """A mail message pulled from Gmail or Outlook, before invoice extraction."""

    source: Source
    message_id: str
    subject: str
    sender_name: str
    sender_email: str
    received_at: date
    attachments: list[Attachment] = field(default_factory=list)
    permalink: str | None = None


@dataclass
class InvoiceRecord:
    """A normalized invoice, ready to be written to Sheets/Drive and matched
    against other invoices for duplicates."""

    source: Source
    message_id: str
    vendor_raw: str
    vendor_normalized: str
    amount: float | None
    currency: str
    invoice_date: date | None
    invoice_number: str | None
    attachment: Attachment
    email_subject: str
    email_permalink: str | None = None

    # Filled in later, once uploaded / matched.
    drive_file_id: str | None = None
    drive_file_link: str | None = None
    is_duplicate: bool = False
    duplicate_of_row: int | None = None
    duplicate_reason: str | None = None

    @property
    def dedup_hash(self) -> str:
        return self.attachment.sha256
