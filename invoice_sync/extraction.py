"""Pulls structured invoice fields (vendor, amount, date, invoice #) out of a
raw email + attachment.

This is deliberately heuristic and conservative: bookkeeping data quality
matters more than recall, and every row written to the sheet keeps the
original PDF link so a human can correct any field that looks wrong.
"""

from __future__ import annotations

import re
from datetime import date, datetime

from dateutil import parser as dateparser

from invoice_sync.models import Attachment, InvoiceRecord, RawMessage

# Ordered most- to least-specific; searched in this order so "Total Due"
# outranks a bare "Total" (and neither matches inside "Subtotal").
_AMOUNT_LABELS = [
    "total due",
    "balance due",
    "amount due",
    "amount paid",
    "grand total",
    "total amount",
    r"(?<!sub)total",
]
_AMOUNT_LABEL_RE = [
    re.compile(
        rf"\b{label}\b\s*[:\-]?\s*"
        r"(?P<currency>USD|EUR|GBP|CAD|AUD|\$|€|£)?\s*"
        r"(?P<amount>[\d]{1,3}(?:[,.\s]\d{3})*(?:[.,]\d{2}))",
        re.IGNORECASE,
    )
    for label in _AMOUNT_LABELS
]
_FALLBACK_AMOUNT_RE = re.compile(
    r"(?P<currency>USD|EUR|GBP|CAD|AUD|\$|€|£)\s*"
    r"(?P<amount>[\d]{1,3}(?:[,.\s]\d{3})*(?:[.,]\d{2}))"
)
_INVOICE_NO_RE = re.compile(
    r"(?:invoice|receipt|order)\s*(?:#|no\.?|number|id)?\s*[:\-]?\s*([A-Za-z0-9][A-Za-z0-9\-_/]{2,24})",
    re.IGNORECASE,
)
_DATE_RE = re.compile(
    r"(?:invoice date|date of issue|issued|date)\s*[:\-]?\s*"
    r"([A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4})",
    re.IGNORECASE,
)

_CURRENCY_SYMBOLS = {"$": "USD", "€": "EUR", "£": "GBP"}

_VENDOR_SUFFIX_RE = re.compile(
    r"\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|company|gmbh|plc)\b\.?",
    re.IGNORECASE,
)
_NON_ALNUM_RE = re.compile(r"[^a-z0-9]+")


def normalize_vendor(raw: str) -> str:
    """Collapse a vendor / sender name into a comparable key: lowercase, no
    legal-entity suffixes, no punctuation."""
    name = raw.lower()
    name = name.split("@")[0] if "@" in name and " " not in name else name
    name = _VENDOR_SUFFIX_RE.sub(" ", name)
    name = _NON_ALNUM_RE.sub(" ", name)
    return " ".join(name.split()).strip()


def _clean_amount(raw: str) -> float | None:
    raw = raw.strip()
    # Handle both "1,234.56" and "1.234,56" styles.
    if "," in raw and "." in raw:
        if raw.rfind(",") > raw.rfind("."):
            raw = raw.replace(".", "").replace(",", ".")
        else:
            raw = raw.replace(",", "")
    elif "," in raw:
        # Could be thousands separator or decimal comma.
        parts = raw.split(",")
        if len(parts[-1]) == 2:
            raw = raw.replace(",", ".")
        else:
            raw = raw.replace(",", "")
    try:
        return round(float(raw), 2)
    except ValueError:
        return None


def _extract_amount(text: str) -> tuple[float | None, str]:
    for pattern in (*_AMOUNT_LABEL_RE, _FALLBACK_AMOUNT_RE):
        match = pattern.search(text)
        if match:
            amount = _clean_amount(match.group("amount"))
            if amount is None:
                continue
            currency_token = match.group("currency") or "USD"
            currency = _CURRENCY_SYMBOLS.get(currency_token, currency_token.upper())
            return amount, currency
    return None, "USD"


def _extract_invoice_number(text: str) -> str | None:
    match = _INVOICE_NO_RE.search(text)
    if match:
        return match.group(1).strip().rstrip(".,")
    return None


def _extract_date(text: str, fallback: date) -> date:
    match = _DATE_RE.search(text)
    if match:
        try:
            parsed = dateparser.parse(match.group(1), fuzzy=True)
            if parsed:
                return parsed.date()
        except (ValueError, OverflowError):
            pass
    return fallback


def extract_pdf_text(data: bytes) -> str:
    """Best-effort text extraction from a PDF attachment. Returns "" for
    non-PDF or unreadable content rather than raising, since a missing field
    just means a blanker (still reviewable) sheet row."""
    try:
        import pdfplumber
    except ImportError:
        return ""

    import io

    text_parts: list[str] = []
    try:
        with pdfplumber.open(io.BytesIO(data)) as pdf:
            for page in pdf.pages[:5]:  # invoices are short; cap for speed
                extracted = page.extract_text() or ""
                text_parts.append(extracted)
    except Exception:
        return ""
    return "\n".join(text_parts)


def build_invoice_record(message: RawMessage, attachment: Attachment) -> InvoiceRecord:
    """Turn one (email, attachment) pair into a normalized InvoiceRecord."""
    body_text = ""
    if attachment.content_type == "application/pdf" or attachment.filename.lower().endswith(
        ".pdf"
    ):
        body_text = extract_pdf_text(attachment.data)

    # Fall back to subject line if the PDF had no extractable text (e.g. a
    # scanned image invoice) so amount/date extraction still gets a shot.
    search_text = f"{body_text}\n{message.subject}"

    amount, currency = _extract_amount(search_text)
    invoice_number = _extract_invoice_number(search_text)
    invoice_date = _extract_date(search_text, fallback=message.received_at)

    vendor_raw = message.sender_name or message.sender_email
    vendor_normalized = normalize_vendor(vendor_raw)

    return InvoiceRecord(
        source=message.source,
        message_id=message.message_id,
        vendor_raw=vendor_raw,
        vendor_normalized=vendor_normalized,
        amount=amount,
        currency=currency,
        invoice_date=invoice_date,
        invoice_number=invoice_number,
        attachment=attachment,
        email_subject=message.subject,
        email_permalink=message.permalink,
    )
