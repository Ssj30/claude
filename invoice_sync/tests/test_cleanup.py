from datetime import date

import pytest

from invoice_sync.cleanup import plan_cleanup
from invoice_sync.config import DedupConfig
from invoice_sync.dedup import ExistingInvoice
from invoice_sync.extraction import normalize_vendor


def row(
    row_number: int,
    *,
    source="gmail",
    vendor="Acme Cloud Hosting Inc.",
    amount=129.00,
    invoice_date=date(2026, 3, 4),
    invoice_number="INV-1042",
    file_hash="hash-a",
    drive_file_id="drive-a",
) -> ExistingInvoice:
    return ExistingInvoice(
        row_number=row_number,
        source=source,
        vendor_normalized=normalize_vendor(vendor),
        amount=amount,
        currency="USD",
        invoice_date=invoice_date,
        invoice_number=invoice_number,
        file_hash=file_hash,
        drive_file_id=drive_file_id,
    )


@pytest.fixture
def config() -> DedupConfig:
    return DedupConfig()


def test_no_rows_nothing_to_do(config):
    plan = plan_cleanup([], config)
    assert plan.keep == []
    assert plan.delete == []


def test_all_unique_rows_all_kept(config):
    rows = [
        row(2, vendor="Acme", amount=100, invoice_number="A1", file_hash="h1", drive_file_id="d1"),
        row(3, vendor="Beta Corp", amount=200, invoice_number="B1", file_hash="h2", drive_file_id="d2"),
    ]
    plan = plan_cleanup(rows, config)
    assert len(plan.keep) == 2
    assert plan.delete == []


def test_keeps_earliest_row_deletes_later_duplicate(config):
    original = row(2, file_hash="shared-hash", drive_file_id="drive-original")
    duplicate = row(5, source="outlook", file_hash="shared-hash", drive_file_id="drive-dup")
    plan = plan_cleanup([duplicate, original], config)  # order shouldn't matter
    assert [r.row_number for r in plan.keep] == [2]
    assert [r.row_number for r, _ in plan.delete] == [5]


def test_same_vendor_different_date_is_not_a_duplicate(config):
    """Recurring invoices from the same vendor for the same amount, on
    different billing dates, must both survive cleanup."""
    jan = row(2, invoice_date=date(2026, 1, 4), invoice_number="INV-1001", file_hash="h1")
    mar = row(3, invoice_date=date(2026, 3, 4), invoice_number="INV-1042", file_hash="h2")
    plan = plan_cleanup([jan, mar], config)
    assert len(plan.keep) == 2
    assert plan.delete == []


def test_same_vendor_different_invoice_number_close_dates_still_flagged_by_amount_date():
    """If two rows share amount + a close date + similar vendor but
    different invoice numbers, tier 3 still catches it (this is exactly the
    cross-mailbox scenario) — different invoice numbers alone don't save it
    once amount and date both line up."""
    config = DedupConfig()
    a = row(2, invoice_number="A-1", invoice_date=date(2026, 3, 4), file_hash="h1")
    b = row(3, invoice_number="B-2", invoice_date=date(2026, 3, 5), file_hash="h2", source="outlook")
    plan = plan_cleanup([a, b], config)
    assert len(plan.keep) == 1
    assert len(plan.delete) == 1


def test_three_way_duplicate_keeps_only_the_first():
    config = DedupConfig()
    rows = [
        row(2, file_hash="shared", drive_file_id="d1"),
        row(3, file_hash="shared", drive_file_id="d2", source="outlook"),
        row(4, file_hash="shared", drive_file_id="d3"),
    ]
    plan = plan_cleanup(rows, config)
    assert [r.row_number for r in plan.keep] == [2]
    assert sorted(r.row_number for r, _ in plan.delete) == [3, 4]
