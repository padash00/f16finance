from __future__ import annotations

import json
import sqlite3
from datetime import datetime
from pathlib import Path

from config import APP_DIR, ensure_app_dir


DB_PATH = APP_DIR / "point_client.db"


class OfflineQueue:
    def __init__(self, path: Path | None = None):
        ensure_app_dir()
        self.path = path or DB_PATH
        self._init_db()

    def _connect(self):
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self):
        with self._connect() as conn:
            conn.execute(
                """
                create table if not exists offline_reports (
                    id integer primary key autoincrement,
                    payload text not null,
                    created_at text not null,
                    retries integer not null default 0,
                    last_error text
                )
                """
            )
            conn.execute(
                """
                create table if not exists offline_debt_actions (
                    id integer primary key autoincrement,
                    action text not null,
                    payload text not null,
                    created_at text not null,
                    retries integer not null default 0,
                    last_error text
                )
                """
            )
            conn.commit()

    def enqueue(self, payload: dict):
        self.enqueue_shift(payload)

    def enqueue_shift(self, payload: dict):
        with self._connect() as conn:
            conn.execute(
                "insert into offline_reports (payload, created_at) values (?, ?)",
                (json.dumps(payload, ensure_ascii=False), datetime.now().isoformat()),
            )
            conn.commit()

    def list_pending(self, limit: int = 20) -> list[dict]:
        return self.list_pending_shifts(limit=limit)

    def list_pending_shifts(self, limit: int = 20) -> list[dict]:
        with self._connect() as conn:
            rows = conn.execute(
                "select id, payload, retries, last_error from offline_reports order by created_at asc limit ?",
                (limit,),
            ).fetchall()
            result = []
            for row in rows:
                result.append(
                    {
                        "id": row["id"],
                        "payload": json.loads(row["payload"]),
                        "retries": row["retries"],
                        "last_error": row["last_error"],
                    }
                )
            return result

    def mark_failed(self, item_id: int, error: str):
        self.mark_failed_shift(item_id, error)

    def mark_failed_shift(self, item_id: int, error: str):
        with self._connect() as conn:
            conn.execute(
                "update offline_reports set retries = retries + 1, last_error = ? where id = ?",
                (error[:500], item_id),
            )
            conn.commit()

    def remove(self, item_id: int):
        self.remove_shift(item_id)

    def remove_shift(self, item_id: int):
        with self._connect() as conn:
            conn.execute("delete from offline_reports where id = ?", (item_id,))
            conn.commit()

    def count(self) -> int:
        return self.count_shifts()

    def count_shifts(self) -> int:
        with self._connect() as conn:
            row = conn.execute("select count(*) as total from offline_reports").fetchone()
            return int(row["total"] or 0)

    def enqueue_debt_action(self, action: str, payload: dict):
        with self._connect() as conn:
            conn.execute(
                "insert into offline_debt_actions (action, payload, created_at) values (?, ?, ?)",
                (action, json.dumps(payload, ensure_ascii=False), datetime.now().isoformat()),
            )
            conn.commit()

    def list_pending_debt_actions(self, limit: int = 100) -> list[dict]:
        with self._connect() as conn:
            rows = conn.execute(
                "select id, action, payload, retries, last_error from offline_debt_actions order by created_at asc limit ?",
                (limit,),
            ).fetchall()
            result = []
            for row in rows:
                result.append(
                    {
                        "id": row["id"],
                        "action": row["action"],
                        "payload": json.loads(row["payload"]),
                        "retries": row["retries"],
                        "last_error": row["last_error"],
                    }
                )
            return result

    def mark_failed_debt_action(self, item_id: int, error: str):
        with self._connect() as conn:
            conn.execute(
                "update offline_debt_actions set retries = retries + 1, last_error = ? where id = ?",
                (error[:500], item_id),
            )
            conn.commit()

    def remove_debt_action(self, item_id: int):
        with self._connect() as conn:
            conn.execute("delete from offline_debt_actions where id = ?", (item_id,))
            conn.commit()

    def count_debt_actions(self) -> int:
        with self._connect() as conn:
            row = conn.execute("select count(*) as total from offline_debt_actions").fetchone()
            return int(row["total"] or 0)
