"""Tracks the last-processed message per source so re-runs only look at new
mail, and tracks already-seen message IDs so a message already recorded (or
already judged non-invoice) is never re-fetched/re-parsed."""

from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, field
from datetime import date, timedelta


@dataclass
class SyncState:
    last_run_date: dict[str, str] = field(default_factory=dict)  # source -> ISO date
    seen_message_ids: dict[str, list[str]] = field(default_factory=dict)  # source -> ids

    def since(self, source: str, lookback_days_first_run: int) -> date:
        if source in self.last_run_date:
            return date.fromisoformat(self.last_run_date[source])
        return date.today() - timedelta(days=lookback_days_first_run)

    def mark_seen(self, source: str, message_id: str) -> None:
        self.seen_message_ids.setdefault(source, []).append(message_id)

    def is_seen(self, source: str, message_id: str) -> bool:
        return message_id in self.seen_message_ids.get(source, [])

    def mark_run_complete(self, source: str, run_date: date) -> None:
        self.last_run_date[source] = run_date.isoformat()
        # Cap history so the state file doesn't grow forever.
        self.seen_message_ids[source] = self.seen_message_ids.get(source, [])[-5000:]


def load_state(path: str) -> SyncState:
    if not os.path.exists(path):
        return SyncState()
    with open(path) as f:
        data = json.load(f)
    return SyncState(**data)


def save_state(path: str, state: SyncState) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w") as f:
        json.dump(asdict(state), f, indent=2)
