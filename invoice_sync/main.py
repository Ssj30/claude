"""Orchestrates one sync run:

  1. Fetch new invoice-like messages from Gmail and Outlook since the last run.
  2. Extract vendor/amount/date/invoice# from each attachment.
  3. Check each candidate against everything already in the ledger (and
     everything recorded earlier in *this* run) for a duplicate.
  4. Upload non-duplicates to Drive, append them to the ledger.
  5. Log duplicates to the Duplicates tab instead of the ledger.
  6. Persist per-source watermarks so the next run only looks at new mail.

Run with: python -m invoice_sync.main
"""

from __future__ import annotations

import logging
from datetime import date

from invoice_sync.config import Config
from invoice_sync.dedup import ExistingInvoice, find_duplicate
from invoice_sync.drive_sync import upload_invoice
from invoice_sync.extraction import build_invoice_record
from invoice_sync.google_clients import build_drive, build_gmail, build_sheets
from invoice_sync.models import InvoiceRecord, RawMessage, Source
from invoice_sync.outlook_auth import get_access_token
from invoice_sync.sheets_sync import (
    DUPLICATES_HEADER,
    LEDGER_HEADER,
    append_duplicate,
    append_invoice,
    ensure_headers,
    load_existing_invoices,
)
from invoice_sync.sources import gmail_source, outlook_source
from invoice_sync.state import load_state, save_state

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("invoice_sync")


def _existing_from_record(record: InvoiceRecord, row_number: int) -> ExistingInvoice:
    return ExistingInvoice(
        row_number=row_number,
        source=record.source.value,
        vendor_normalized=record.vendor_normalized,
        amount=record.amount,
        currency=record.currency,
        invoice_date=record.invoice_date,
        invoice_number=record.invoice_number,
        file_hash=record.dedup_hash,
    )


def collect_messages(config: Config, state) -> list[RawMessage]:
    messages: list[RawMessage] = []

    try:
        gmail = build_gmail(config)
        since = state.since(Source.GMAIL.value, config.lookback_days_first_run)
        gmail_messages = gmail_source.fetch_messages(gmail, config, since)
        messages.extend(
            m for m in gmail_messages if not state.is_seen(Source.GMAIL.value, m.message_id)
        )
        log.info("Gmail: %d new candidate messages since %s", len(gmail_messages), since)
    except FileNotFoundError:
        log.warning("Google credentials not found; skipping Gmail. Run auth_setup.py first.")

    token = get_access_token(config)
    if token:
        since = state.since(Source.OUTLOOK.value, config.lookback_days_first_run)
        outlook_messages = outlook_source.fetch_messages(token, config, since)
        messages.extend(
            m for m in outlook_messages if not state.is_seen(Source.OUTLOOK.value, m.message_id)
        )
        log.info("Outlook: %d new candidate messages since %s", len(outlook_messages), since)
    else:
        log.warning("No Outlook access token available; skipping Outlook fetch.")

    return messages


def run(config: Config | None = None) -> None:
    config = config or Config()
    problems = config.validate_for_run()
    for problem in problems:
        log.warning("Config warning: %s", problem)

    state = load_state(config.state_path)
    today = date.today()

    messages = collect_messages(config, state)
    if not messages:
        log.info("No new messages to process.")
        save_state(config.state_path, state)
        return

    drive = build_drive(config)
    sheets = build_sheets(config)
    ensure_headers(sheets, config.sheet_id, config.sheet_tab_ledger, LEDGER_HEADER)
    ensure_headers(sheets, config.sheet_id, config.sheet_tab_duplicates, DUPLICATES_HEADER)

    existing = load_existing_invoices(sheets, config.sheet_id, config.sheet_tab_ledger)

    recorded, duplicates = 0, 0

    for message in messages:
        state.mark_seen(message.source.value, message.message_id)

        for attachment in message.attachments:
            record = build_invoice_record(message, attachment)

            match = find_duplicate(record, existing, config.dedup)
            if match:
                duplicates += 1
                log.info(
                    "Duplicate: %s $%s from %s (%s) matches row %d — %s",
                    record.vendor_raw,
                    record.amount,
                    record.source.value,
                    message.subject,
                    match.existing_row,
                    match.reason,
                )
                if not config.dry_run:
                    append_duplicate(
                        sheets,
                        config.sheet_id,
                        config.sheet_tab_duplicates,
                        record,
                        match.existing_row,
                        match.reason,
                    )
                continue

            if config.dry_run:
                log.info(
                    "[dry-run] Would record: %s $%s (%s) from %s",
                    record.vendor_raw,
                    record.amount,
                    record.invoice_date,
                    record.source.value,
                )
                recorded += 1
                continue

            file_id, file_link = upload_invoice(drive, config.drive_folder_id, record)
            record.drive_file_id = file_id
            record.drive_file_link = file_link

            row_number = append_invoice(sheets, config.sheet_id, config.sheet_tab_ledger, record)
            existing.append(_existing_from_record(record, row_number))
            recorded += 1
            log.info(
                "Recorded row %d: %s $%s (%s) from %s",
                row_number,
                record.vendor_raw,
                record.amount,
                record.invoice_date,
                record.source.value,
            )

    for source in (Source.GMAIL, Source.OUTLOOK):
        state.mark_run_complete(source.value, today)
    save_state(config.state_path, state)

    log.info("Run complete: %d recorded, %d duplicates skipped.", recorded, duplicates)


if __name__ == "__main__":
    run()
