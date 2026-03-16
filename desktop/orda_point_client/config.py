from __future__ import annotations

import json
import os
from pathlib import Path


# Allows multiple instances to coexist with different config dirs.
# Set ORDA_APP_DIR before importing this module, e.g.:
#   os.environ["ORDA_APP_DIR"] = str(Path.home() / "OrdaPoint_Ramen")
_env_dir = os.environ.get("ORDA_APP_DIR", "")
APP_DIR = Path(_env_dir) if _env_dir else Path.home() / "OrdaControlPoint"
CONFIG_PATH = APP_DIR / "config.json"


DEFAULT_CONFIG = {
    "api_base_url": "https://ordaops.kz",
    "device_token": "",
    "last_operator_username": "",
    "telegram_bot_token": "",
    "telegram_chat_id": "",
    "draft": {},
    "debt_draft": {},
    "scanner_draft": {},
}


def ensure_app_dir() -> Path:
    APP_DIR.mkdir(parents=True, exist_ok=True)
    return APP_DIR


def load_config() -> dict:
    ensure_app_dir()
    if not CONFIG_PATH.exists():
        return dict(DEFAULT_CONFIG)

    try:
        data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception:
        return dict(DEFAULT_CONFIG)

    return {
        "api_base_url": str(data.get("api_base_url") or DEFAULT_CONFIG["api_base_url"]).rstrip("/"),
        "device_token": str(data.get("device_token") or ""),
        "last_operator_username": str(data.get("last_operator_username") or ""),
        "telegram_bot_token": str(data.get("telegram_bot_token") or ""),
        "telegram_chat_id": str(data.get("telegram_chat_id") or ""),
        "draft": data.get("draft") if isinstance(data.get("draft"), dict) else {},
        "debt_draft": data.get("debt_draft") if isinstance(data.get("debt_draft"), dict) else {},
        "scanner_draft": data.get("scanner_draft") if isinstance(data.get("scanner_draft"), dict) else {},
    }


def save_config(config: dict) -> None:
    ensure_app_dir()
    payload = {
        "api_base_url": str(config.get("api_base_url") or DEFAULT_CONFIG["api_base_url"]).rstrip("/"),
        "device_token": str(config.get("device_token") or ""),
        "last_operator_username": str(config.get("last_operator_username") or ""),
        "telegram_bot_token": str(config.get("telegram_bot_token") or ""),
        "telegram_chat_id": str(config.get("telegram_chat_id") or ""),
        "draft": config.get("draft") if isinstance(config.get("draft"), dict) else {},
        "debt_draft": config.get("debt_draft") if isinstance(config.get("debt_draft"), dict) else {},
        "scanner_draft": config.get("scanner_draft") if isinstance(config.get("scanner_draft"), dict) else {},
    }
    CONFIG_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
