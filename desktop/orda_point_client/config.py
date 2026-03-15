from __future__ import annotations

import json
from pathlib import Path


APP_DIR = Path.home() / "OrdaControlPoint"
CONFIG_PATH = APP_DIR / "config.json"


DEFAULT_CONFIG = {
    "api_base_url": "https://ordaops.kz",
    "device_token": "",
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
    }


def save_config(config: dict) -> None:
    ensure_app_dir()
    payload = {
        "api_base_url": str(config.get("api_base_url") or DEFAULT_CONFIG["api_base_url"]).rstrip("/"),
        "device_token": str(config.get("device_token") or ""),
    }
    CONFIG_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
