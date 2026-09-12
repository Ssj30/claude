"""Maintenance pass: scan the whole ledger for duplicate rows using the same
matching rules as ingestion, and remove the redundant ones — deleting the
sheet row AND trashing its Drive file — while keeping the earliest-recorded
copy of each real invoice.

This exists for duplicates that got into the ledger before this dedup logic
existed (or from a manual sheet edit), rather than for day-to-day runs:
`invoice_sync.main` already refuses to record a new duplicate at all, so on
an ongoing basis there should be nothing here to clean up.

Run with:
    python -m invoice_sync.cleanup            # deletes duplicates found
    python -m invoice_sync.cleanup --dry-run  # only prints what it would do
"""

from __future__ import annotations

import argparse
import logging
from dataclasses import dataclass

from invoice_sync.config import Config, DedupConfig
from invoice_sync.dedup import ExistingInvoice, find_duplicate_among_existing
from invoice_sync.drive_sync import trash_file
from invoice_sync.google_clients import build_drive, build_sheets
from invoice_sync.sheets_sync import delete_rows, get_sheet_tab_id, load_existing_invoices

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("invoice_sync.cleanup")


@dataclass
class CleanupPlan:
    keep: list[ExistingInvoice]
    delete: list[tuple[ExistingInvoice, str]]  # (row, reason it's a duplicate)


def plan_cleanup(rows: list[ExistingInvoice], config: DedupConfig) -> CleanupPlan:
    """Pure function (no API calls) so this is unit-testable: walks rows in
    the order they were recorded, keeping the first occurrence of each
    invoice and flagging every later match as a duplicate to remove."""
    kept: list[ExistingInvoice] = []
    delete: list[tuple[ExistingInvoice, str]] = []
    for row in sorted(rows, key=lambda r: r.row_number):
        match = find_duplicate_among_existing(row, kept, config)
        if match:
            delete.append((row, match.reason))
        else:
            kept.append(row)
    return CleanupPlan(keep=kept, delete=delete)


def run_cleanup(config: Config | None = None, dry_run: bool = False) -> CleanupPlan:
    config = config or Config()
    sheets = build_sheets(config)
    drive = build_drive(config)

    rows = load_existing_invoices(sheets, config.sheet_id, config.sheet_tab_ledger)
    plan = plan_cleanup(rows, config.dedup)

    log.info(
        "Ledger scan: %d rows, %d unique, %d duplicates to remove",
        len(rows),
        len(plan.keep),
        len(plan.delete),
    )

    for row, reason in plan.delete:
        log.info(
            "%sRemoving row %d: %s $%s (%s) — %s",
            "[dry-run] " if dry_run else "",
            row.row_number,
            row.vendor_normalized,
            row.amount,
            row.invoice_date,
            reason,
        )

    if dry_run or not plan.delete:
        return plan

    for row, _reason in plan.delete:
        if row.drive_file_id:
            try:
                trash_file(drive, row.drive_file_id)
            except Exception:
                log.exception("Failed to trash Drive file %s for row %d", row.drive_file_id, row.row_number)

    # Sheets row indices shift as rows above them are deleted, so delete
    # bottom-to-top.
    tab_id = get_sheet_tab_id(sheets, config.sheet_id, config.sheet_tab_ledger)
    row_numbers = sorted((row.row_number for row, _ in plan.delete), reverse=True)
    delete_rows(sheets, config.sheet_id, tab_id, row_numbers)

    return plan


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run", action="store_true", help="Only print what would be removed."
    )
    args = parser.parse_args()
    run_cleanup(dry_run=args.dry_run)


if __name__ == "__main__":
    main()
