"""
Общие вспомогательные функции для всех вкладок.
Единственный источник истины для parse_money / format_money / format_date.
"""
from __future__ import annotations

from datetime import datetime


def parse_money(raw: str) -> int:
    """Парсинг денежной строки в число (>= 0)."""
    try:
        cleaned = (raw or "").replace(" ", "").replace(",", "").replace("₸", "")
        return max(0, int(cleaned))
    except (ValueError, TypeError):
        return 0


def format_money(value: int | float | None) -> str:
    """Форматирование числа в денежный формат с разбивкой пробелами."""
    return f"{int(value or 0):,}".replace(",", " ")


def format_date(date_str: str) -> str:
    """Форматирование ISO-даты в ДД.ММ.ГГГГ; возвращает исходную строку при ошибке."""
    try:
        if date_str and len(date_str) >= 10:
            return datetime.fromisoformat(date_str[:10]).strftime("%d.%m.%Y")
    except (ValueError, TypeError):
        pass
    return (date_str or "")[:10] or "—"
