from __future__ import annotations

import json
from pathlib import Path


APP_DIR = Path.home() / "OrdaControlPoint"
CONFIG_PATH = APP_DIR / "config.json"


DEFAULT_CONFIG = {
    "api_base_url": "https://ordaops.kz",
    "device_token": "",
    "last_operator_username": "",
    "draft": {},
    "debt_draft": {},
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
        "draft": data.get("draft") if isinstance(data.get("draft"), dict) else {},
        "debt_draft": data.get("debt_draft") if isinstance(data.get("debt_draft"), dict) else {},
    }


def save_config(config: dict) -> None:
    ensure_app_dir()
    payload = {
        "api_base_url": str(config.get("api_base_url") or DEFAULT_CONFIG["api_base_url"]).rstrip("/"),
        "device_token": str(config.get("device_token") or ""),
        "last_operator_username": str(config.get("last_operator_username") or ""),
        "draft": config.get("draft") if isinstance(config.get("draft"), dict) else {},
        "debt_draft": config.get("debt_draft") if isinstance(config.get("debt_draft"), dict) else {},
    }
    CONFIG_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
