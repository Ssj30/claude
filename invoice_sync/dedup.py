"""Cross-source duplicate detection.

The scenario this exists for: the same transaction generates an invoice
email in Gmail (e.g. forwarded, or a personal account) *and* in Outlook
(e.g. a work account cc'd, or a shared mailbox), or the same vendor simply
emails the invoice twice. We never want the same expense to hit the
bookkeeping ledger twice.

Matching runs in three tiers, cheapest/most-certain first:

1. Identical attachment bytes (sha256) -> always a duplicate, whatever the
   source, subject, or vendor text say.
2. Same normalized invoice number + same amount -> duplicate. Invoice
   numbers are vendor-issued and essentially unique, so this is treated as
   certain even across wildly different vendor-name spellings.
3. Fuzzy match: amount equal (within a cent-level tolerance), invoice date
   within a configurable window, and vendor name similarity above a
   threshold -> duplicate.

Tier 3 is the one that actually catches "two mailboxes, same transaction",
since the Gmail and Outlook copies of an invoice rarely have byte-identical
attachments (different forwarding wraps them, generates new PDFs, etc.).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

try:
    from rapidfuzz import fuzz

    def _similarity(a: str, b: str) -> float:
        return fuzz.token_sort_ratio(a, b)

except ImportError:  # pragma: no cover - exercised when rapidfuzz isn't installed
    from difflib import SequenceMatcher

    def _similarity(a: str, b: str) -> float:
        return SequenceMatcher(None, a, b).ratio() * 100

from invoice_sync.config import DedupConfig
from invoice_sync.models import InvoiceRecord


@dataclass
class ExistingInvoice:
    """A previously-recorded invoice, as read back from the sheet, that new
    invoices get checked against."""

    row_number: int
    source: str
    vendor_normalized: str
    amount: float | None
    currency: str
    invoice_date: date | None
    invoice_number: str | None
    file_hash: str | None


@dataclass
class DuplicateMatch:
    existing_row: int
    reason: str


def _amounts_match(a: float | None, b: float | None, tolerance_cents: int) -> bool:
    if a is None or b is None:
        return False
    return abs(round(a * 100) - round(b * 100)) <= tolerance_cents


def _dates_close(a: date | None, b: date | None, tolerance_days: int) -> bool:
    if a is None or b is None:
        return False
    return abs((a - b).days) <= tolerance_days


def _normalize_invoice_number(value: str | None) -> str | None:
    if not value:
        return None
    return "".join(ch for ch in value.lower() if ch.isalnum())


def find_duplicate(
    candidate: InvoiceRecord,
    existing: list[ExistingInvoice],
    config: DedupConfig,
) -> DuplicateMatch | None:
    """Return the first existing invoice that `candidate` duplicates, or
    None if it looks like a genuinely new transaction."""

    candidate_number = _normalize_invoice_number(candidate.invoice_number)

    # Tier 1: identical file content, regardless of everything else.
    for row in existing:
        if row.file_hash and row.file_hash == candidate.dedup_hash:
            return DuplicateMatch(
                existing_row=row.row_number,
                reason="identical attachment content",
            )

    # Tier 2: same invoice number + same amount is essentially certain,
    # even if it came through a different mailbox or the vendor name was
    # spelled differently in each email.
    if candidate_number and candidate.amount is not None:
        for row in existing:
            row_number = _normalize_invoice_number(row.invoice_number)
            if row_number and row_number == candidate_number and _amounts_match(
                candidate.amount, row.amount, config.amount_tolerance_cents
            ):
                return DuplicateMatch(
                    existing_row=row.row_number,
                    reason=f"same invoice number ({candidate.invoice_number}) and amount",
                )

    # Tier 3: fuzzy match on vendor + amount + date window. This is the tier
    # that catches "same transaction, two different mailboxes" when the two
    # copies aren't byte-identical and don't share a machine-readable
    # invoice number.
    best: DuplicateMatch | None = None
    best_score = 0.0
    for row in existing:
        if not _amounts_match(candidate.amount, row.amount, config.amount_tolerance_cents):
            continue
        if not _dates_close(candidate.invoice_date, row.invoice_date, config.date_tolerance_days):
            continue
        score = _similarity(candidate.vendor_normalized, row.vendor_normalized)
        if score >= config.vendor_fuzzy_threshold and score > best_score:
            best_score = score
            cross_source = row.source != candidate.source.value
            best = DuplicateMatch(
                existing_row=row.row_number,
                reason=(
                    f"same amount/date, vendor match {score:.0f}% "
                    f"({'cross-source: ' + row.source + ' vs ' + candidate.source.value if cross_source else 'same source'})"
                ),
            )

    return best
