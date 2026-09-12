"""Runtime configuration, loaded from environment variables (see .env.example).

Nothing here talks to any API — it's pure settings so the rest of the code
stays testable without touching real credentials.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field


def _bool(name: str, default: bool) -> bool:
    val = os.environ.get(name)
    if val is None:
        return default
    return val.strip().lower() in {"1", "true", "yes", "on"}


def _list(name: str, default: list[str]) -> list[str]:
    val = os.environ.get(name)
    if not val:
        return default
    return [item.strip() for item in val.split(",") if item.strip()]


@dataclass
class DedupConfig:
    # Amounts within this many cents are treated as "the same".
    amount_tolerance_cents: int = 1
    # Invoice/received dates within this many days are treated as "the same".
    date_tolerance_days: int = 5
    # Vendor name fuzzy-match threshold (0-100, rapidfuzz token_sort_ratio).
    vendor_fuzzy_threshold: int = 82


@dataclass
class Config:
    # --- Google (Gmail search account, Drive, Sheets all share one OAuth app) ---
    google_credentials_path: str = field(
        default_factory=lambda: os.environ.get(
            "GOOGLE_CREDENTIALS_PATH", "credentials/google_credentials.json"
        )
    )
    google_token_path: str = field(
        default_factory=lambda: os.environ.get(
            "GOOGLE_TOKEN_PATH", "credentials/google_token.json"
        )
    )
    drive_folder_id: str = field(
        default_factory=lambda: os.environ.get("DRIVE_FOLDER_ID", "")
    )
    sheet_id: str = field(default_factory=lambda: os.environ.get("SHEET_ID", ""))
    sheet_tab_ledger: str = field(
        default_factory=lambda: os.environ.get("SHEET_TAB_LEDGER", "Invoices")
    )
    sheet_tab_duplicates: str = field(
        default_factory=lambda: os.environ.get("SHEET_TAB_DUPLICATES", "Duplicates")
    )

    # --- Microsoft / Outlook (app registration, client-credentials or device code) ---
    ms_tenant_id: str = field(default_factory=lambda: os.environ.get("MS_TENANT_ID", ""))
    ms_client_id: str = field(default_factory=lambda: os.environ.get("MS_CLIENT_ID", ""))
    ms_client_secret: str = field(
        default_factory=lambda: os.environ.get("MS_CLIENT_SECRET", "")
    )
    ms_token_cache_path: str = field(
        default_factory=lambda: os.environ.get(
            "MS_TOKEN_CACHE_PATH", "credentials/ms_token_cache.json"
        )
    )
    outlook_mailbox: str = field(
        default_factory=lambda: os.environ.get("OUTLOOK_MAILBOX", "me")
    )

    # --- Search behaviour ---
    lookback_days_first_run: int = field(
        default_factory=lambda: int(os.environ.get("LOOKBACK_DAYS_FIRST_RUN", "90"))
    )
    invoice_keywords: list[str] = field(
        default_factory=lambda: _list(
            "INVOICE_KEYWORDS",
            ["invoice", "receipt", "bill", "statement", "payment confirmation"],
        )
    )
    attachment_extensions: list[str] = field(
        default_factory=lambda: _list(
            "ATTACHMENT_EXTENSIONS", [".pdf", ".png", ".jpg", ".jpeg"]
        )
    )

    # --- State / dedup ---
    state_path: str = field(
        default_factory=lambda: os.environ.get("STATE_PATH", "state/sync_state.json")
    )
    dedup: DedupConfig = field(default_factory=DedupConfig)

    dry_run: bool = field(default_factory=lambda: _bool("DRY_RUN", False))

    def validate_for_run(self) -> list[str]:
        """Returns a list of human-readable problems; empty means ready to run."""
        problems = []
        if not self.drive_folder_id:
            problems.append("DRIVE_FOLDER_ID is not set")
        if not self.sheet_id:
            problems.append("SHEET_ID is not set")
        if not (self.ms_tenant_id and self.ms_client_id and self.ms_client_secret):
            problems.append(
                "MS_TENANT_ID / MS_CLIENT_ID / MS_CLIENT_SECRET are not fully set "
                "(Outlook fetching will be skipped)"
            )
        return problems
