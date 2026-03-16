from __future__ import annotations

from datetime import datetime

import requests
from PyQt6.QtCore import QDate, Qt, QThread, pyqtSignal
from PyQt6.QtGui import QIntValidator
from PyQt6.QtWidgets import (
    QDateEdit,
    QGridLayout,
    QGroupBox,
    QHBoxLayout,
    QInputDialog,
    QLabel,
    QLineEdit,
    QMessageBox,
    QPlainTextEdit,
    QPushButton,
    QVBoxLayout,
    QWidget,
)


# ──────────────────────────────────────────────
# TELEGRAM WORKER
# ──────────────────────────────────────────────
class _TelegramWorker(QThread):
    """Sends a Telegram message in the background (fire-and-forget)."""

    def __init__(self, bot_token: str, chat_id: str, text: str):
        super().__init__()
        self.bot_token = bot_token
        self.chat_id = chat_id
        self.text = text

    def run(self):
        try:
            requests.post(
                f"https://api.telegram.org/bot{self.bot_token}/sendMessage",
                json={"chat_id": self.chat_id, "text": self.text, "parse_mode": "HTML"},
                timeout=10,
            )
        except Exception:
            pass  # fire-and-forget — ошибки Telegram не критичны


def parse_money(raw: str) -> int:
    try:
        return max(0, int((raw or "").replace(" ", "").replace(",", "")))
    except ValueError:
        return 0


def format_money(value: int) -> str:
    return f"{int(value):,}".replace(",", " ")


def is_last_day_of_month(qdate: QDate) -> bool:
    return qdate.day() == qdate.daysInMonth()


class ShiftReportTab(QWidget):
    def __init__(self, main_window):
        super().__init__(main_window)
        self.main_window = main_window
        self.inputs: dict[str, QLineEdit] = {}
        self.selected_shift: str | None = None
        self.init_ui()
        self.load_draft()
        self.update_calculation()

    def init_ui(self):
        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(16)

        metrics = QHBoxLayout()
        self.result_label = QLabel("ИТОГ: 0 ₸")
        self.result_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.result_label.setStyleSheet(
            "font-size: 28px; font-weight: 700; color: #60a5fa; "
            "background: #0f172a; border: 2px solid #60a5fa; border-radius: 16px; padding: 16px 20px;"
        )
        self.summary_label = QLabel("Факт: 0 ₸ • Kaspi: 0 ₸")
        self.summary_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.summary_label.setStyleSheet(
            "font-size: 15px; color: #cbd5e1; background: #111827; "
            "border: 1px solid #1f2937; border-radius: 16px; padding: 18px 20px;"
        )
        metrics.addWidget(self.result_label, 2)
        metrics.addWidget(self.summary_label, 1)
        root.addLayout(metrics)

        self.fact_group = QGroupBox("Фактические средства")
        fact_grid = QGridLayout(self.fact_group)
        self.inputs["cash"] = self.make_input("Наличные", fact_grid, 0)
        self.inputs["coins"] = self.make_input("Мелочь", fact_grid, 1)
        self.inputs["kaspi_pos"] = self.make_input("Kaspi POS", fact_grid, 2)
        self.inputs["kaspi_online"] = self.make_input("Kaspi Online", fact_grid, 3)
        self.inputs["debts"] = self.make_input("Компенсация / тех", fact_grid, 4)

        self.sys_group = QGroupBox("Данные системы")
        sys_grid = QGridLayout(self.sys_group)
        self.inputs["start_cash"] = self.make_input("Касса утро", sys_grid, 0)
        self.inputs["wipon"] = self.make_input("Senet", sys_grid, 1)

        forms = QHBoxLayout()
        forms.setSpacing(16)
        forms.addWidget(self.fact_group, 2)
        forms.addWidget(self.sys_group, 1)
        root.addLayout(forms)

        self.meta_group = QGroupBox("Смена")
        meta_grid = QGridLayout(self.meta_group)
        self.date_edit = QDateEdit()
        self.date_edit.setCalendarPopup(True)
        self.date_edit.setDate(QDate.currentDate())
        self.shift_value = QLineEdit()
        self.shift_value.setReadOnly(True)
        self.shift_value.setText("Выберите: день или ночь")
        self.comment_edit = QPlainTextEdit()
        self.comment_edit.setPlaceholderText("Комментарий к смене")
        self.comment_edit.setFixedHeight(88)
        self.day_btn = QPushButton("День")
        self.night_btn = QPushButton("Ночь")
        self.day_btn.clicked.connect(lambda: self.set_shift("day"))
        self.night_btn.clicked.connect(lambda: self.set_shift("night"))

        shift_row = QHBoxLayout()
        shift_row.addWidget(self.day_btn)
        shift_row.addWidget(self.night_btn)
        shift_row.addWidget(self.shift_value, 1)

        meta_grid.addWidget(QLabel("Дата"), 0, 0)
        meta_grid.addWidget(self.date_edit, 0, 1)
        meta_grid.addWidget(QLabel("Смена"), 1, 0)
        meta_grid.addLayout(shift_row, 1, 1)
        meta_grid.addWidget(QLabel("Комментарий"), 2, 0, Qt.AlignmentFlag.AlignTop)
        meta_grid.addWidget(self.comment_edit, 2, 1)
        root.addWidget(self.meta_group)

        action_row = QHBoxLayout()
        self.clear_btn = QPushButton("Сброс")
        self.clear_btn.clicked.connect(self.clear_form)
        self.send_btn = QPushButton("Закрыть смену")
        self.send_btn.clicked.connect(self.submit_shift_report)
        action_row.addWidget(self.clear_btn)
        action_row.addStretch(1)
        action_row.addWidget(self.send_btn)
        root.addLayout(action_row)

    def make_input(self, label_text: str, grid: QGridLayout, row: int) -> QLineEdit:
        grid.addWidget(QLabel(label_text), row, 0)
        line = QLineEdit("0")
        line.setAlignment(Qt.AlignmentFlag.AlignRight)
        line.setValidator(QIntValidator(0, 9_999_999))
        line.textChanged.connect(self.update_calculation)
        grid.addWidget(line, row, 1)
        return line

    def set_operator_enabled(self, enabled: bool):
        self.setEnabled(enabled)

    def get_value(self, key: str) -> int:
        return parse_money(self.inputs[key].text())

    def calculation(self) -> dict[str, int]:
        wipon = self.get_value("wipon")
        kaspi_pos = self.get_value("kaspi_pos")
        kaspi_online = self.get_value("kaspi_online")
        debts = self.get_value("debts")
        cash = self.get_value("cash")
        coins = self.get_value("coins")
        start_cash = self.get_value("start_cash")
        actual = (cash + coins + kaspi_pos + debts) - start_cash
        diff = actual - wipon
        return {
            "wipon": wipon,
            "kaspi_pos": kaspi_pos,
            "kaspi_online": kaspi_online,
            "debts": debts,
            "cash": cash,
            "coins": coins,
            "start_cash": start_cash,
            "actual": actual,
            "diff": diff,
        }

    def update_calculation(self):
        calc = self.calculation()
        diff = calc["diff"]

        if diff > 0:
            color = "#22c55e"
            prefix = "+"
        elif diff < 0:
            color = "#ef4444"
            prefix = ""
        else:
            color = "#60a5fa"
            prefix = ""

        self.result_label.setText(f"ИТОГ: {prefix}{format_money(diff)} ₸")
        self.result_label.setStyleSheet(
            "font-size: 28px; font-weight: 700; "
            f"color: {color}; background: #0f172a; border: 2px solid {color}; "
            "border-radius: 16px; padding: 16px 20px;"
        )
        kaspi_total = calc["kaspi_pos"] + calc["kaspi_online"]
        self.summary_label.setText(
            f"Факт: {format_money(calc['actual'])} ₸ • "
            f"Kaspi: {format_money(kaspi_total)} ₸ • "
            f"Senet: {format_money(calc['wipon'])} ₸"
        )

    def set_shift(self, shift: str):
        self.selected_shift = shift
        self.shift_value.setText("Дневная смена" if shift == "day" else "Ночная смена")

    def validate_form(self) -> bool:
        if not self.main_window.current_operator:
            QMessageBox.warning(self, "Сменный отчёт", "Сначала войдите как оператор.")
            return False

        if self.selected_shift not in ("day", "night"):
            QMessageBox.warning(self, "Сменный отчёт", "Выберите смену.")
            return False

        cash = self.get_value("cash")
        if cash > 500_000:
            reply = QMessageBox.question(
                self,
                "Проверка суммы",
                f"Наличные {format_money(cash)} ₸ выглядят подозрительно. Продолжить?",
            )
            if reply != QMessageBox.StandardButton.Yes:
                return False

        total = (
            self.get_value("wipon")
            + self.get_value("kaspi_pos")
            + self.get_value("cash")
            + self.get_value("start_cash")
        )
        if total == 0:
            QMessageBox.warning(self, "Сменный отчёт", "Заполните данные по смене.")
            return False

        return True

    def ask_split(self, payload: dict, calc: dict[str, int]) -> list[dict] | None:
        reply = QMessageBox.question(
            self,
            "Разбивка по месяцу",
            "Это последний день месяца и ночная смена.\nРазбить выручку на две даты?",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
        )
        if reply != QMessageBox.StandardButton.Yes:
            return None

        kaspi_after, ok1 = QInputDialog.getInt(
            self,
            "Kaspi POS после 00:00",
            f"Kaspi POS за 00:00–08:00 (макс {calc['kaspi_pos']}):",
            0,
            0,
            calc["kaspi_pos"],
        )
        if not ok1:
            return None

        online_after, ok2 = QInputDialog.getInt(
            self,
            "Kaspi Online после 00:00",
            f"Online за 00:00–08:00 (макс {calc['kaspi_online']}):",
            0,
            0,
            calc["kaspi_online"],
        )
        if not ok2:
            return None

        cash_after, ok3 = QInputDialog.getInt(
            self,
            "Наличные после 00:00",
            f"Наличные за 00:00–08:00 (макс {calc['cash']}):",
            0,
            0,
            calc["cash"],
        )
        if not ok3:
            return None

        next_date = self.date_edit.date().addDays(1).toString("yyyy-MM-dd")
        common_meta = payload["meta"]
        return [
            {
                **payload,
                "cash_amount": calc["cash"] - cash_after,
                "kaspi_amount": calc["kaspi_pos"] - kaspi_after,
                "online_amount": calc["kaspi_online"] - online_after,
                "meta": {
                    **common_meta,
                    "split_mode": True,
                    "split_part": "before-midnight",
                    "original_date": payload["date"],
                },
            },
            {
                **payload,
                "date": next_date,
                "cash_amount": cash_after,
                "kaspi_amount": kaspi_after,
                "online_amount": online_after,
                "comment": (payload.get("comment") or "") or "Часть ночной смены после 00:00",
                "local_ref": f"{payload['operator_id']}:{next_date}:{payload['shift']}:split",
                "meta": {
                    **common_meta,
                    "split_mode": True,
                    "split_part": "after-midnight",
                    "original_date": payload["date"],
                },
            },
        ]

    def current_payload(self):
        if not self.main_window.current_operator:
            return None, None

        calc = self.calculation()
        operator_id = self.main_window.current_operator["operator_id"]
        date_str = self.date_edit.date().toString("yyyy-MM-dd")
        payload = {
            "date": date_str,
            "operator_id": operator_id,
            "shift": self.selected_shift,
            "cash_amount": calc["cash"],
            "kaspi_amount": calc["kaspi_pos"],
            "online_amount": calc["kaspi_online"],
            "card_amount": 0,
            "comment": self.comment_edit.toPlainText().strip() or None,
            "source": "orda-point-client-arena",
            "local_ref": f"{operator_id}:{date_str}:{self.selected_shift}",
            "meta": {
                "coins": calc["coins"],
                "debts": calc["debts"],
                "start_cash": calc["start_cash"],
                "wipon": calc["wipon"],
                "diff": calc["diff"],
                "split_mode": False,
                "split_part": None,
                "original_date": date_str,
            },
        }
        return payload, calc

    def submit_shift_report(self):
        if not self.validate_form():
            return

        payload, calc = self.current_payload()
        if not payload or calc is None:
            return

        if calc["diff"] < 0:
            reply = QMessageBox.question(
                self,
                "Недостача",
                f"Недостача: {format_money(calc['diff'])} ₸\nЗакрыть смену?",
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            )
            if reply != QMessageBox.StandardButton.Yes:
                return

        if not self.main_window.api:
            QMessageBox.warning(self, "Сменный отчёт", "Сначала подключите точку.")
            return

        batches = [payload]
        if payload["shift"] == "night" and is_last_day_of_month(self.date_edit.date()):
            split_entries = self.ask_split(payload, calc)
            if split_entries is None:
                return
            if split_entries:
                batches = split_entries

        saved_offline = False
        errors: list[str] = []
        for item in batches:
            try:
                self.main_window.api.send_shift_report(item)
            except Exception as error:
                self.main_window.queue.enqueue_shift(item)
                saved_offline = True
                errors.append(str(error))

        self.main_window.refresh_queue_label()
        self.save_draft()

        if errors and len(errors) == len(batches):
            QMessageBox.warning(
                self,
                "Оффлайн-очередь",
                "Нет связи с сервером. Смена сохранена локально и будет отправлена позже.\n\n"
                + "\n".join(errors[:2]),
            )
            return

        if saved_offline:
            QMessageBox.warning(
                self,
                "Частичная отправка",
                "Часть данных ушла на сайт, часть сохранена в оффлайн-очередь.",
            )
        else:
            QMessageBox.information(self, "Сменный отчёт", "Смена отправлена в Orda Control.")

        date_str = self.date_edit.date().toString("yyyy-MM-dd")
        self._send_telegram(calc, date_str)
        self.clear_form()

    def _send_telegram(self, calc: dict[str, int], date_str: str):
        """Send shift summary to Telegram if bot token is configured."""
        cfg = self.main_window.config
        bot_token = str(cfg.get("telegram_bot_token") or "").strip()
        if not bot_token:
            return

        # Try operator's personal chat first, then group chat
        operator = self.main_window.current_operator or {}
        personal_chat = str(operator.get("telegram_chat_id") or "").strip()
        group_chat = str(cfg.get("telegram_chat_id") or "").strip()

        company = (self.main_window.bootstrap_data or {}).get("company") or {}
        company_name = company.get("name", "—")
        operator_name = (
            operator.get("full_name")
            or operator.get("name")
            or "Оператор"
        )
        shift_label = "🌞 Дневная" if self.selected_shift == "day" else "🌙 Ночная"
        now_str = datetime.now().strftime("%d.%m.%Y %H:%M")

        diff = calc["diff"]
        if diff > 0:
            diff_line = f"📊 ИТОГ: <b>+{format_money(diff)} ₸</b> ✅"
        elif diff < 0:
            diff_line = f"📊 ИТОГ: <b>{format_money(diff)} ₸</b> ⚠️ недостача"
        else:
            diff_line = f"📊 ИТОГ: <b>0 ₸</b> ✓"

        kaspi_total = calc["kaspi_pos"] + calc["kaspi_online"]
        lines = [
            f"🧾 <b>Смена закрыта</b>  {now_str}",
            f"🏢 {company_name}",
            f"👤 {operator_name}  •  {shift_label}  ({date_str})",
            "─────────────────────",
            f"💵 Нал: <b>{format_money(calc['cash'])} ₸</b>",
            f"🪙 Мелочь: {format_money(calc['coins'])} ₸",
            f"💳 Kaspi POS: {format_money(calc['kaspi_pos'])} ₸",
            f"🛒 Kaspi Online: {format_money(calc['kaspi_online'])} ₸",
            f"💳 Kaspi итого: {format_money(kaspi_total)} ₸",
            "─────────────────────",
            f"🖥 Senet: {format_money(calc['wipon'])} ₸",
            f"🚀 Касса утро: {format_money(calc['start_cash'])} ₸",
            f"🔧 Компенсация: {format_money(calc['debts'])} ₸",
            "─────────────────────",
            diff_line,
        ]
        comment = self.comment_edit.toPlainText().strip()
        if comment:
            lines.append(f"💬 {comment}")

        message = "\n".join(lines)

        # Keep refs so threads aren't GC'd
        self._tg_workers: list = getattr(self, "_tg_workers", [])

        for chat_id in filter(None, {personal_chat, group_chat}):
            w = _TelegramWorker(bot_token, chat_id, message)
            self._tg_workers.append(w)
            w.finished.connect(lambda worker=w: self._tg_workers.remove(worker) if worker in self._tg_workers else None)
            w.start()

    def save_draft(self):
        self.main_window.config["draft"] = {
            "date": self.date_edit.date().toString("yyyy-MM-dd"),
            "selected_shift": self.selected_shift,
            "comment": self.comment_edit.toPlainText(),
            "inputs": {key: field.text() for key, field in self.inputs.items()},
        }
        self.main_window.save_config()

    def load_draft(self):
        draft = self.main_window.config.get("draft") or {}
        if draft.get("date"):
            parsed = QDate.fromString(str(draft["date"]), "yyyy-MM-dd")
            if parsed.isValid():
                self.date_edit.setDate(parsed)

        self.selected_shift = draft.get("selected_shift")
        if self.selected_shift == "day":
            self.shift_value.setText("Дневная смена")
        elif self.selected_shift == "night":
            self.shift_value.setText("Ночная смена")
        else:
            self.shift_value.setText("Выберите: день или ночь")

        inputs = draft.get("inputs") or {}
        for key, field in self.inputs.items():
            field.setText(str(inputs.get(key) or "0"))

        self.comment_edit.setPlainText(str(draft.get("comment") or ""))
        self.update_calculation()

    def clear_form(self):
        for field in self.inputs.values():
            field.setText("0")
        self.comment_edit.clear()
        self.selected_shift = None
        self.shift_value.setText("Выберите: день или ночь")
        self.date_edit.setDate(QDate.currentDate())
        self.update_calculation()
        self.save_draft()
