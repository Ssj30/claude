from datetime import date

from invoice_sync.extraction import (
    _extract_amount,
    _extract_date,
    _extract_invoice_number,
    normalize_vendor,
)


def test_normalize_vendor_strips_legal_suffix_and_punctuation():
    assert normalize_vendor("Acme Cloud Hosting, Inc.") == "acme cloud hosting"
    assert normalize_vendor("ACME CLOUD HOSTING LLC") == "acme cloud hosting"


def test_normalize_vendor_from_email_local_part():
    assert normalize_vendor("billing@acme.com") == "billing"


def test_extract_amount_prefers_labeled_total():
    text = "Subtotal: $100.00\nTax: $9.00\nTotal Due: $109.00"
    amount, currency = _extract_amount(text)
    assert amount == 109.00
    assert currency == "USD"


def test_extract_amount_handles_comma_thousands():
    text = "Amount Due: $1,234.56"
    amount, currency = _extract_amount(text)
    assert amount == 1234.56


def test_extract_amount_handles_european_format():
    text = "Total: EUR 1.234,56"
    amount, currency = _extract_amount(text)
    assert amount == 1234.56
    assert currency == "EUR"


def test_extract_invoice_number():
    assert _extract_invoice_number("Invoice #INV-2024-0042 is attached") == "INV-2024-0042"
    assert _extract_invoice_number("Invoice Number: 88213") == "88213"


def test_extract_date_falls_back_when_not_found():
    fallback = date(2026, 3, 1)
    assert _extract_date("no dates here", fallback) == fallback


def test_extract_date_parses_labeled_date():
    fallback = date(2020, 1, 1)
    result = _extract_date("Invoice Date: March 4, 2026", fallback)
    assert result == date(2026, 3, 4)
