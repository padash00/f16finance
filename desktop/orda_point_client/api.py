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
        headers = {
            "Content-Type": "application/json",
        }
        if self.device_token:
            headers["x-point-device-token"] = self.device_token
        return headers

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

    def login_operator(self, username: str, password: str) -> dict[str, Any]:
        response = self.session.post(
            f"{self.api_base_url}/api/point/login",
            headers=self._headers(),
            json={
                "username": username,
                "password": password,
            },
            timeout=20,
        )
        self._raise_for_status(response)
        return response.json()

    def list_debts(self) -> dict[str, Any]:
        response = self.session.get(
            f"{self.api_base_url}/api/point/debts",
            headers=self._headers(),
            timeout=20,
        )
        self._raise_for_status(response)
        return response.json()

    def create_debt(self, payload: dict[str, Any]) -> dict[str, Any]:
        response = self.session.post(
            f"{self.api_base_url}/api/point/debts",
            headers=self._headers(),
            json={
                "action": "createDebt",
                "payload": payload,
            },
            timeout=20,
        )
        self._raise_for_status(response)
        return response.json()

    def list_products(self) -> dict[str, Any]:
        response = self.session.get(
            f"{self.api_base_url}/api/point/products",
            headers=self._headers(),
            timeout=20,
        )
        self._raise_for_status(response)
        return response.json()

    def create_product(self, email: str, password: str, payload: dict[str, Any]) -> dict[str, Any]:
        response = self.session.post(
            f"{self.api_base_url}/api/point/products",
            headers=self._headers(),
            json={
                "action": "createProduct",
                "email": email.strip(),
                "password": password,
                "payload": payload,
            },
            timeout=20,
        )
        self._raise_for_status(response)
        return response.json()

    def update_product(
        self,
        email: str,
        password: str,
        product_id: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        response = self.session.post(
            f"{self.api_base_url}/api/point/products",
            headers=self._headers(),
            json={
                "action": "updateProduct",
                "email": email.strip(),
                "password": password,
                "productId": product_id,
                "payload": payload,
            },
            timeout=20,
        )
        self._raise_for_status(response)
        return response.json()

    def delete_product(self, email: str, password: str, product_id: str) -> dict[str, Any]:
        response = self.session.post(
            f"{self.api_base_url}/api/point/products",
            headers=self._headers(),
            json={
                "action": "deleteProduct",
                "email": email.strip(),
                "password": password,
                "productId": product_id,
            },
            timeout=20,
        )
        self._raise_for_status(response)
        return response.json()

    def delete_debt(self, item_id: str) -> dict[str, Any]:
        response = self.session.post(
            f"{self.api_base_url}/api/point/debts",
            headers=self._headers(),
            json={
                "action": "deleteDebt",
                "itemId": item_id,
            },
            timeout=20,
        )
        self._raise_for_status(response)
        return response.json()

    def login_super_admin(self, email: str, password: str) -> dict[str, Any]:
        response = self.session.post(
            f"{self.api_base_url}/api/point/admin-login",
            headers={"Content-Type": "application/json"},
            json={
                "email": email.strip(),
                "password": password,
            },
            timeout=20,
        )
        self._raise_for_status(response)
        return response.json()

    def list_admin_devices(self, email: str, password: str) -> dict[str, Any]:
        response = self.session.post(
            f"{self.api_base_url}/api/point/admin-devices",
            headers={"Content-Type": "application/json"},
            json={
                "email": email.strip(),
                "password": password,
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
