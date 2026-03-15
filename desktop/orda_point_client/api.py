from __future__ import annotations

import json
from typing import Any

import requests


class PointApiClient:
    def __init__(self, api_base_url: str, device_token: str):
        self.api_base_url = api_base_url.rstrip("/")
        self.device_token = device_token.strip()
        self.session = requests.Session()

    def _headers(self) -> dict[str, str]:
        return {
            "Content-Type": "application/json",
            "x-point-device-token": self.device_token,
        }

    def bootstrap(self) -> dict[str, Any]:
        response = self.session.get(
            f"{self.api_base_url}/api/point/bootstrap",
            headers=self._headers(),
            timeout=15,
        )
        self._raise_for_status(response)
        return response.json()

    def send_shift_report(self, payload: dict[str, Any]) -> dict[str, Any]:
        response = self.session.post(
            f"{self.api_base_url}/api/point/shift-report",
            headers=self._headers(),
            json={
                "action": "createShiftReport",
                "payload": payload,
            },
            timeout=20,
        )
        self._raise_for_status(response)
        return response.json()

    def _raise_for_status(self, response: requests.Response):
        if response.ok:
            return

        detail = None
        try:
            payload = response.json()
            if isinstance(payload, dict):
                detail = payload.get("error") or payload.get("message")
            elif isinstance(payload, list):
                detail = json.dumps(payload, ensure_ascii=False)
        except Exception:
            detail = response.text.strip() or None

        if detail:
            raise RuntimeError(f"{response.status_code}: {detail}")
        response.raise_for_status()
