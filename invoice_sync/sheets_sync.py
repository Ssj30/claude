"""Reads/writes the bookkeeping ledger in Google Sheets.

Two tabs:
  - `Invoices`   the ledger itself, one row per recorded (non-duplicate) invoice.
  - `Duplicates` an audit trail of every invoice that was recognized as a
                 duplicate of something already in the ledger, so nothing
                 silently disappears.
"""

from __future__ import annotations

from datetime import date, datetime

from googleapiclient.discovery import Resource

from invoice_sync.dedup import ExistingInvoice
from invoice_sync.models import InvoiceRecord

LEDGER_HEADER = [
    "Synced At",
    "Invoice Date",
    "Vendor",
    "Vendor Key",
    "Amount",
    "Currency",
    "Invoice #",
    "Source",
    "Email Subject",
    "Drive Link",
    "Email Link",
    "File SHA256",
    "Message ID",
    "Status",
]

DUPLICATES_HEADER = [
    "Detected At",
    "Duplicate Of Row",
    "Vendor",
    "Amount",
    "Currency",
    "Source",
    "Reason",
    "Email Subject",
    "Email Link",
    "Message ID",
]

# Column indices (0-based) into LEDGER_HEADER, used when parsing existing rows.
COL_INVOICE_DATE = 1
COL_VENDOR_KEY = 3
COL_AMOUNT = 4
COL_CURRENCY = 5
COL_INVOICE_NUMBER = 6
COL_SOURCE = 7
COL_FILE_HASH = 11


def ensure_headers(sheets: Resource, sheet_id: str, tab: str, header: list[str]) -> None:
    result = (
        sheets.spreadsheets()
        .values()
        .get(spreadsheetId=sheet_id, range=f"{tab}!A1:Z1")
        .execute()
    )
    if result.get("values"):
        return
    sheets.spreadsheets().values().update(
        spreadsheetId=sheet_id,
        range=f"{tab}!A1",
        valueInputOption="RAW",
        body={"values": [header]},
    ).execute()


def load_existing_invoices(sheets: Resource, sheet_id: str, tab: str) -> list[ExistingInvoice]:
    result = (
        sheets.spreadsheets()
        .values()
        .get(spreadsheetId=sheet_id, range=f"{tab}!A2:Z")
        .execute()
    )
    rows = result.get("values", [])
    existing: list[ExistingInvoice] = []
    for idx, row in enumerate(rows, start=2):  # row 1 is the header
        row = row + [""] * (len(LEDGER_HEADER) - len(row))
        invoice_date = None
        if row[COL_INVOICE_DATE]:
            try:
                invoice_date = date.fromisoformat(row[COL_INVOICE_DATE])
            except ValueError:
                pass
        amount = None
        if row[COL_AMOUNT]:
            try:
                amount = float(row[COL_AMOUNT])
            except ValueError:
                pass
        existing.append(
            ExistingInvoice(
                row_number=idx,
                source=row[COL_SOURCE],
                vendor_normalized=row[COL_VENDOR_KEY],
                amount=amount,
                currency=row[COL_CURRENCY],
                invoice_date=invoice_date,
                invoice_number=row[COL_INVOICE_NUMBER] or None,
                file_hash=row[COL_FILE_HASH] or None,
            )
        )
    return existing


def append_invoice(sheets: Resource, sheet_id: str, tab: str, record: InvoiceRecord) -> int:
    """Appends a recorded invoice row. Returns the new row number."""
    status = "Recorded" if record.amount is not None and record.invoice_date else "Needs Review"
    row = [
        datetime.utcnow().isoformat(timespec="seconds") + "Z",
        record.invoice_date.isoformat() if record.invoice_date else "",
        record.vendor_raw,
        record.vendor_normalized,
        f"{record.amount:.2f}" if record.amount is not None else "",
        record.currency,
        record.invoice_number or "",
        record.source.value,
        record.email_subject,
        record.drive_file_link or "",
        record.email_permalink or "",
        record.dedup_hash,
        record.message_id,
        status,
    ]
    result = (
        sheets.spreadsheets()
        .values()
        .append(
            spreadsheetId=sheet_id,
            range=f"{tab}!A1",
            valueInputOption="RAW",
            insertDataOption="INSERT_ROWS",
            body={"values": [row]},
        )
        .execute()
    )
    updated_range = result["updates"]["updatedRange"]  # e.g. "Invoices!A17:N17"
    row_number = int("".join(ch for ch in updated_range.split("!")[1].split(":")[0] if ch.isdigit()))
    return row_number


def append_duplicate(
    sheets: Resource,
    sheet_id: str,
    tab: str,
    record: InvoiceRecord,
    existing_row: int,
    reason: str,
) -> None:
    row = [
        datetime.utcnow().isoformat(timespec="seconds") + "Z",
        existing_row,
        record.vendor_raw,
        f"{record.amount:.2f}" if record.amount is not None else "",
        record.currency,
        record.source.value,
        reason,
        record.email_subject,
        record.email_permalink or "",
        record.message_id,
    ]
    sheets.spreadsheets().values().append(
        spreadsheetId=sheet_id,
        range=f"{tab}!A1",
        valueInputOption="RAW",
        insertDataOption="INSERT_ROWS",
        body={"values": [row]},
    ).execute()
