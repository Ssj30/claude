# Invoice Sync

Fetches invoices from Gmail and Outlook, saves the attachments to Google
Drive, and writes a bookkeeping-ready ledger row to Google Sheets for each
one — while recognizing when the *same* invoice arrived through both
mailboxes (or arrived twice from one vendor) so it's never recorded twice.

## How it works

```
Gmail  ──┐                                   ┌── Google Drive (PDF filed by year/month)
         ├── extract vendor/amount/date ── dedup check ──┤
Outlook ─┘                                   └── Google Sheets ledger (+ Duplicates tab)
```

1. **Fetch** — searches Gmail and Outlook for recent messages that have an
   attachment and look invoice-like (subject/body keywords: invoice,
   receipt, bill, statement, ...). Only new mail since the last run is
   pulled (a watermark is kept per mailbox in `state/sync_state.json`).
2. **Extract** — pulls vendor, amount, currency, invoice date and invoice
   number out of the PDF text (falls back to the email subject/date if the
   PDF has no extractable text, e.g. a scanned image).
3. **De-duplicate** (`invoice_sync/dedup.py`) — before anything is written,
   every candidate is checked against everything already in the ledger:
   - identical attachment bytes → duplicate, always
   - same invoice number + same amount → duplicate, even with a different
     mailbox or vendor-name spelling
   - same amount + invoice date within a few days + fuzzy-matching vendor
     name → duplicate — **this is the case that catches the same
     transaction emailing an invoice into both Gmail and Outlook**, since
     the two copies are rarely byte-identical.
   Everything else is a new transaction.
4. **Record** — new invoices get uploaded to
   `<Drive folder>/<year>/<month>/` and appended as a row to the `Invoices`
   tab. Anything recognized as a duplicate is logged to a `Duplicates` tab
   instead (with a pointer back to the original row and why it matched), so
   nothing silently disappears — you can always audit or override it.

## Ledger columns

`Invoices` tab: Synced At, Invoice Date, Vendor, Vendor Key, Amount,
Currency, Invoice #, Source, Email Subject, Drive Link, Email Link, File
SHA256, Message ID, Status (`Recorded` / `Needs Review` if amount or date
couldn't be extracted — check these by hand).

`Duplicates` tab: Detected At, Duplicate Of Row, Vendor, Amount, Currency,
Source, Reason, Email Subject, Email Link, Message ID.

## Setup

### 1. Google Cloud project (Gmail read + Drive + Sheets)

1. Create a project at console.cloud.google.com, enable the **Gmail API**,
   **Google Drive API**, and **Google Sheets API**.
2. Create an OAuth **client ID** (type: Desktop app) under
   *APIs & Services → Credentials*, download it as
   `credentials/google_credentials.json`.
3. On the OAuth consent screen, add yourself as a test user (or publish the
   app) and add the three scopes used in `auth_setup.py`.
4. Run once, locally, to complete the browser consent flow:
   ```
   python -m invoice_sync.auth_setup google
   ```
   This writes `credentials/google_token.json` (contains a refresh token —
   keep it secret; for CI, base64/paste its contents into the
   `GOOGLE_TOKEN_JSON` GitHub secret).
5. Create (or reuse) a Drive folder for invoices and a Google Sheet for the
   ledger; copy their IDs from the URL into `DRIVE_FOLDER_ID` / `SHEET_ID`.

### 2. Azure AD app registration (Outlook)

1. In portal.azure.com → *Azure Active Directory → App registrations*,
   create a new app.
2. Under *API permissions*, add Microsoft Graph **Mail.Read**.
   - For a fully unattended scheduled run, use the **Application**
     permission type and have an admin grant consent, then create a
     **client secret** (*Certificates & secrets*) and set
     `MS_CLIENT_SECRET`. This is app-only auth — set `OUTLOOK_MAILBOX` to
     the mailbox you want it to read (e.g. `users/you@yourcompany.com`),
     since there's no signed-in user.
   - For a personal/free Outlook.com account (no admin/app-only option),
     use the **Delegated** permission type instead and run:
     ```
     python -m invoice_sync.auth_setup outlook
     ```
     which does a one-time device-code sign-in and caches a refresh token
     in `credentials/ms_token_cache.json`. Leave `MS_CLIENT_SECRET` blank
     so the app uses this cached token instead of client-credentials.
3. Copy the tenant ID and client ID into `.env`.

### 3. Configure and run

```
cp .env.example .env    # fill in the values from steps 1-2
pip install -r requirements.txt
python -m invoice_sync.main
```

Set `DRY_RUN=true` for a first pass that logs what it *would* record/flag
as a duplicate without touching Drive or Sheets.

### 4. Schedule it

`.github/workflows/invoice-sync.yml` runs it daily via GitHub Actions.
Add these repo secrets: `GOOGLE_TOKEN_JSON` (contents of
`credentials/google_token.json`), `DRIVE_FOLDER_ID`, `SHEET_ID`,
`MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET` (or
`MS_TOKEN_CACHE_JSON` if using device-code auth), `OUTLOOK_MAILBOX`. Any
other scheduler (cron on a server, a cloud function on a timer) works too —
`python -m invoice_sync.main` is the entire entrypoint.

## Tuning duplicate detection

`invoice_sync/config.py`'s `DedupConfig`:

- `amount_tolerance_cents` (default 1) — treat amounts this close as equal.
- `date_tolerance_days` (default 5) — how many days apart an invoice/received
  date can be and still be considered "the same" transaction. Raise this if
  your two mailboxes tend to receive the same invoice several days apart
  (e.g. one is a forward); lower it if unrelated same-amount invoices from
  recurring vendors are being flagged.
- `vendor_fuzzy_threshold` (default 82, 0-100) — how similar vendor names
  must be. Lower it if the same vendor emails from very differently-named
  addresses across your two accounts; raise it if unrelated vendors with
  similar names are colliding.

## Tests

```
pip install -r requirements.txt
pytest invoice_sync/tests
```

`tests/test_dedup.py` is the important one — it exercises the exact
scenario this project exists for (same transaction, two mailboxes, no
shared invoice number) alongside the negative cases (recurring monthly
invoices from the same vendor must *not* collide).

## Limitations / things to review

- Field extraction is regex/heuristic, not a full invoice-parsing model —
  every row keeps the Drive/email links so you can eyeball anything marked
  `Needs Review`.
- Scanned/image invoices with no embedded text won't yield amount/date/
  invoice-number automatically; they're still uploaded and logged with
  `Needs Review` so you can fill in the fields by hand.
- Duplicate detection is tuned for "same vendor, same amount, close dates"
  — a vendor that reuses invoice numbers across unrelated customers, or two
  genuinely separate charges of the exact same round amount on the same
  day, are edge cases worth spot-checking the `Duplicates` tab for.
