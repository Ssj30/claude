from datetime import date

import pytest

from invoice_sync.config import DedupConfig
from invoice_sync.dedup import ExistingInvoice, find_duplicate
from invoice_sync.extraction import normalize_vendor
from invoice_sync.models import Attachment, InvoiceRecord, Source


def make_record(
    *,
    source=Source.GMAIL,
    vendor="Acme Cloud Hosting Inc.",
    amount=129.00,
    invoice_date=date(2026, 3, 4),
    invoice_number="INV-1042",
    data=b"pdf-bytes-a",
    message_id="msg-1",
) -> InvoiceRecord:
    return InvoiceRecord(
        source=source,
        message_id=message_id,
        vendor_raw=vendor,
        vendor_normalized=normalize_vendor(vendor),
        amount=amount,
        currency="USD",
        invoice_date=invoice_date,
        invoice_number=invoice_number,
        attachment=Attachment(filename="invoice.pdf", content_type="application/pdf", data=data),
        email_subject=f"Your invoice from {vendor}",
    )


def make_existing(**overrides) -> ExistingInvoice:
    defaults = dict(
        row_number=2,
        source="gmail",
        vendor_normalized=normalize_vendor("Acme Cloud Hosting Inc."),
        amount=129.00,
        currency="USD",
        invoice_date=date(2026, 3, 4),
        invoice_number="INV-1042",
        file_hash="deadbeef",
    )
    defaults.update(overrides)
    return ExistingInvoice(**defaults)


@pytest.fixture
def config() -> DedupConfig:
    return DedupConfig()


def test_no_match_when_ledger_empty(config):
    candidate = make_record()
    assert find_duplicate(candidate, [], config) is None


def test_identical_attachment_bytes_is_duplicate_even_if_metadata_differs(config):
    import hashlib

    shared_bytes = b"identical pdf content"
    existing = make_existing(
        vendor_normalized="totally different vendor",
        amount=1.0,
        invoice_date=date(2020, 1, 1),
        invoice_number=None,
        file_hash=hashlib.sha256(shared_bytes).hexdigest(),
    )
    candidate = make_record(vendor="Someone Else", amount=999, invoice_number=None, data=shared_bytes)
    match = find_duplicate(candidate, [existing], config)
    assert match is not None
    assert match.existing_row == 2
    assert "identical attachment" in match.reason


def test_same_invoice_number_and_amount_is_duplicate_despite_vendor_spelling(config):
    existing = make_existing(vendor_normalized=normalize_vendor("ACME CLOUD HOSTING, LLC"))
    candidate = make_record(vendor="Acme Cloud Hosting Inc.", invoice_number="inv-1042")
    match = find_duplicate(candidate, [existing], config)
    assert match is not None
    assert "invoice number" in match.reason


def test_cross_source_fuzzy_match_same_transaction(config):
    """The core scenario: same transaction hits Gmail and Outlook with no
    shared invoice number and slightly different vendor text/date."""
    existing = make_existing(
        source="outlook",
        vendor_normalized=normalize_vendor("Acme Cloud Hosting"),
        invoice_number=None,
        invoice_date=date(2026, 3, 5),  # one day off from the Gmail copy
        file_hash="unrelated-hash",
    )
    candidate = make_record(
        source=Source.GMAIL,
        vendor="ACME CLOUD HOSTING INC",
        invoice_number=None,
        invoice_date=date(2026, 3, 4),
        data=b"different-bytes-different-forward",
    )
    match = find_duplicate(candidate, [existing], config)
    assert match is not None
    assert "cross-source" in match.reason


def test_different_vendor_same_amount_is_not_a_duplicate(config):
    existing = make_existing(vendor_normalized=normalize_vendor("Totally Different Co"))
    candidate = make_record(vendor="Acme Cloud Hosting Inc.", invoice_number=None)
    assert find_duplicate(candidate, [existing], config) is None


def test_same_vendor_different_month_is_not_a_duplicate(config):
    """Recurring monthly invoices from the same vendor for the same amount
    must NOT be flagged as duplicates of each other."""
    existing = make_existing(invoice_date=date(2026, 1, 4), invoice_number="INV-1001")
    candidate = make_record(invoice_date=date(2026, 3, 4), invoice_number="INV-1042")
    assert find_duplicate(candidate, [existing], config) is None


def test_amount_off_by_more_than_tolerance_is_not_a_duplicate(config):
    existing = make_existing(amount=129.00, invoice_number=None)
    candidate = make_record(amount=130.00, invoice_number=None)
    assert find_duplicate(candidate, [existing], config) is None


def test_amount_within_rounding_tolerance_matches(config):
    existing = make_existing(amount=129.00, invoice_number=None)
    candidate = make_record(amount=129.004, invoice_number=None)  # float rounding noise
    match = find_duplicate(candidate, [existing], config)
    assert match is not None
