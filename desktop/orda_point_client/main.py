from __future__ import annotations

import sys

from PyQt6.QtCore import QDate, Qt, QTimer
from PyQt6.QtGui import QIntValidator
from PyQt6.QtWidgets import (
    QApplication,
    QComboBox,
    QDateEdit,
    QDialog,
    QFormLayout,
    QGridLayout,
    QGroupBox,
    QHBoxLayout,
    QInputDialog,
    QLabel,
    QLineEdit,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QPlainTextEdit,
    QVBoxLayout,
    QWidget,
)

from api import PointApiClient
from config import load_config, save_config
from storage import OfflineQueue


def parse_money(raw: str) -> int:
    try:
        return max(0, int((raw or "").replace(" ", "").replace(",", "")))
    except ValueError:
        return 0


def format_money(value: int) -> str:
    return f"{int(value):,}".replace(",", " ")


def is_last_day_of_month(qdate: QDate) -> bool:
    return qdate.day() == qdate.daysInMonth()


class ActivationDialog(QDialog):
    def __init__(self, config: dict, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Подключение точки")
        self.setModal(True)
        self.resize(460, 220)

        layout = QVBoxLayout(self)

        intro = QLabel(
            "Укажите адрес Orda Control и device token этой точки.\n"
            "После подключения программа сразу откроет калькулятор смены."
        )
        intro.setWordWrap(True)
        intro.setStyleSheet("color: #94a3b8; font-size: 13px;")
        layout.addWidget(intro)

        form = QFormLayout()
        self.api_url = QLineEdit(config.get("api_base_url") or "")
        self.device_token = QLineEdit(config.get("device_token") or "")
        form.addRow("API URL", self.api_url)
        form.addRow("Device token", self.device_token)
        layout.addLayout(form)

        buttons = QHBoxLayout()
        buttons.addStretch(1)
        connect_btn = QPushButton("Подключить")
        connect_btn.clicked.connect(self.accept)
        buttons.addWidget(connect_btn)
        layout.addLayout(buttons)

    def payload(self) -> dict:
        return {
            "api_base_url": self.api_url.text().strip().rstrip("/"),
            "device_token": self.device_token.text().strip(),
        }


class PointMainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Orda Control Point • Калькулятор смены")
        self.resize(880, 660)

        self.config = load_config()
        self.queue = OfflineQueue()
        self.api: PointApiClient | None = None
        self.bootstrap_data: dict | None = None
        self.inputs: dict[str, QLineEdit] = {}

        container = QWidget()
        self.setCentralWidget(container)
        root = QVBoxLayout(container)
        root.setContentsMargins(20, 20, 20, 20)
        root.setSpacing(16)

        header = QHBoxLayout()
        self.title_label = QLabel("Калькулятор смены")
        self.title_label.setStyleSheet("font-size: 24px; font-weight: 700;")
        self.status_label = QLabel("Подключение...")
        self.status_label.setStyleSheet("color: #94a3b8; font-size: 13px;")
        header.addWidget(self.title_label)
        header.addStretch(1)
        header.addWidget(self.status_label)
        root.addLayout(header)

        self.company_label = QLabel("Точка: —")
        self.company_label.setStyleSheet("font-size: 14px; color: #cbd5e1;")
        root.addWidget(self.company_label)

        toolbar = QHBoxLayout()
        self.connect_btn = QPushButton("Настройки точки")
        self.connect_btn.clicked.connect(lambda: self.configure_connection(required=False))
        self.retry_btn = QPushButton("Отправить очередь")
        self.retry_btn.clicked.connect(self.flush_queue)
        toolbar.addWidget(self.connect_btn)
        toolbar.addWidget(self.retry_btn)
        toolbar.addStretch(1)
        self.queue_label = QLabel("Очередь: 0")
        self.queue_label.setStyleSheet("color: #cbd5e1; font-size: 13px;")
        toolbar.addWidget(self.queue_label)
        root.addLayout(toolbar)

        metrics = QHBoxLayout()
        self.result_label = QLabel("ИТОГ: 0 ₸")
        self.result_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.result_label.setStyleSheet(
            "font-size: 28px; font-weight: 700; color: #60a5fa; "
            "background: #0f172a; border: 2px solid #60a5fa; border-radius: 16px; "
            "padding: 16px 20px;"
        )
        self.summary_label = QLabel("Факт: 0 ₸ • Kaspi: 0 ₸")
        self.summary_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.summary_label.setStyleSheet(
            "font-size: 15px; color: #cbd5e1; "
            "background: #111827; border: 1px solid #1f2937; border-radius: 16px; "
            "padding: 18px 20px;"
        )
        metrics.addWidget(self.result_label, 2)
        metrics.addWidget(self.summary_label, 1)
        root.addLayout(metrics)

        forms = QHBoxLayout()
        forms.setSpacing(16)

        fact_group = QGroupBox("Фактические средства")
        fact_grid = QGridLayout(fact_group)
        self.inputs["cash"] = self.make_input("Наличные", fact_grid, 0)
        self.inputs["coins"] = self.make_input("Мелочь", fact_grid, 1)
        self.inputs["kaspi_pos"] = self.make_input("Kaspi POS", fact_grid, 2)
        self.inputs["kaspi_online"] = self.make_input("Kaspi Online", fact_grid, 3)
        self.inputs["debts"] = self.make_input("Компенсация / тех", fact_grid, 4)

        sys_group = QGroupBox("Данные системы")
        sys_grid = QGridLayout(sys_group)
        self.inputs["start_cash"] = self.make_input("Касса утро", sys_grid, 0)
        self.inputs["wipon"] = self.make_input("Senet", sys_grid, 1)

        forms.addWidget(fact_group, 2)
        forms.addWidget(sys_group, 1)
        root.addLayout(forms)

        meta_group = QGroupBox("Смена")
        meta_grid = QGridLayout(meta_group)
        self.operator_box = QComboBox()
        self.date_edit = QDateEdit()
        self.date_edit.setCalendarPopup(True)
        self.date_edit.setDate(QDate.currentDate())
        self.shift_box = QComboBox()
        self.shift_box.addItem("— Выберите смену —", None)
        self.shift_box.addItem("День", "day")
        self.shift_box.addItem("Ночь", "night")
        self.comment_edit = QPlainTextEdit()
        self.comment_edit.setPlaceholderText("Комментарий к смене")
        self.comment_edit.setFixedHeight(88)

        meta_grid.addWidget(QLabel("Оператор"), 0, 0)
        meta_grid.addWidget(self.operator_box, 0, 1)
        meta_grid.addWidget(QLabel("Дата"), 0, 2)
        meta_grid.addWidget(self.date_edit, 0, 3)
        meta_grid.addWidget(QLabel("Смена"), 1, 0)
        meta_grid.addWidget(self.shift_box, 1, 1)
        meta_grid.addWidget(QLabel("Комментарий"), 2, 0, Qt.AlignmentFlag.AlignTop)
        meta_grid.addWidget(self.comment_edit, 2, 1, 1, 3)
        root.addWidget(meta_group)

        action_row = QHBoxLayout()
        self.clear_btn = QPushButton("Сброс")
        self.clear_btn.clicked.connect(self.clear_form)
        self.send_btn = QPushButton("Закрыть смену")
        self.send_btn.clicked.connect(self.submit_shift_report)
        action_row.addWidget(self.clear_btn)
        action_row.addStretch(1)
        action_row.addWidget(self.send_btn)
        root.addLayout(action_row)

        self.refresh_queue_label()
        self.update_calculation()
        self.setup_autosave()
        QTimer.singleShot(0, self.ensure_connected)

    def make_input(self, label_text: str, grid: QGridLayout, row: int) -> QLineEdit:
        grid.addWidget(QLabel(label_text), row, 0)
        line = QLineEdit("0")
        line.setAlignment(Qt.AlignmentFlag.AlignRight)
        line.setValidator(QIntValidator(0, 9_999_999))
        line.textChanged.connect(self.update_calculation)
        grid.addWidget(line, row, 1)
        return line

    def ensure_connected(self):
        if self.bootstrap_if_possible(show_error=False):
            return
        self.configure_connection(required=True)

    def configure_connection(self, required: bool):
        while True:
            dialog = ActivationDialog(self.config, self)
            if dialog.exec() != QDialog.DialogCode.Accepted:
                if required and not self.bootstrap_data:
                    self.close()
                return

            payload = dialog.payload()
            if not payload["api_base_url"] or not payload["device_token"]:
                QMessageBox.warning(self, "Подключение", "Нужны API URL и device token.")
                if required:
                    continue
                return

            self.config.update(payload)
            save_config(self.config)

            if self.bootstrap_if_possible(show_success=True):
                return

            if not required:
                return

    def bootstrap_if_possible(self, show_success: bool = False, show_error: bool = True) -> bool:
        api_url = (self.config.get("api_base_url") or "").strip()
        device_token = (self.config.get("device_token") or "").strip()
        if not api_url or not device_token:
            self.status_label.setText("Нужен API URL и device token")
            return False

        try:
            self.api = PointApiClient(api_url, device_token)
            self.bootstrap_data = self.api.bootstrap()
            self.hydrate_bootstrap()
            if show_success:
                QMessageBox.information(self, "Подключение", "Точка успешно подключена.")
            return True
        except Exception as error:
            self.api = None
            self.bootstrap_data = None
            self.status_label.setText("Ошибка bootstrap")
            if show_error:
                QMessageBox.critical(self, "Point bootstrap", str(error))
            return False

    def hydrate_bootstrap(self):
        company = (self.bootstrap_data or {}).get("company") or {}
        operators = (self.bootstrap_data or {}).get("operators") or []
        device = (self.bootstrap_data or {}).get("device") or {}

        self.company_label.setText(
            f"Точка: {company.get('name', '—')}  |  Режим: {device.get('point_mode', '—')}"
        )
        self.status_label.setText(f"Подключено • {device.get('name', 'device')}")
        self.setWindowTitle(f"Orda Control Point • {company.get('name', 'Точка')}")

        self.operator_box.clear()
        self.operator_box.addItem("— Выберите оператора —", None)
        for operator in operators:
            label = operator.get("full_name") or operator.get("name") or "Оператор"
            role = operator.get("role_in_company") or "operator"
            self.operator_box.addItem(f"{label} · {role}", operator)

        self.load_draft()
        self.inputs["cash"].setFocus()

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

    def validate_form(self) -> bool:
        if self.operator_box.currentData() is None:
            QMessageBox.warning(self, "Сменный отчёт", "Выберите оператора.")
            self.operator_box.setFocus()
            return False

        if self.shift_box.currentData() is None:
            QMessageBox.warning(self, "Сменный отчёт", "Выберите смену.")
            self.shift_box.setFocus()
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

    def current_payload(self) -> tuple[dict, dict[str, int]] | tuple[None, None]:
        operator = self.operator_box.currentData()
        if not operator:
            return None, None

        calc = self.calculation()
        payload = {
            "date": self.date_edit.date().toString("yyyy-MM-dd"),
            "operator_id": operator["id"],
            "shift": self.shift_box.currentData(),
            "cash_amount": calc["cash"],
            "kaspi_amount": calc["kaspi_pos"],
            "online_amount": calc["kaspi_online"],
            "card_amount": 0,
            "comment": self.comment_edit.toPlainText().strip() or None,
            "source": "orda-point-client-arena",
            "local_ref": (
                f"{operator['id']}:"
                f"{self.date_edit.date().toString('yyyy-MM-dd')}:"
                f"{self.shift_box.currentData()}"
            ),
            "meta": {
                "coins": calc["coins"],
                "debts": calc["debts"],
                "start_cash": calc["start_cash"],
                "wipon": calc["wipon"],
                "diff": calc["diff"],
                "split_mode": False,
                "split_part": None,
                "original_date": self.date_edit.date().toString("yyyy-MM-dd"),
            },
        }
        return payload, calc

    def submit_shift_report(self):
        if not self.validate_form():
            return

        payload, calc = self.current_payload()
        if not payload or calc is None:
            return

        diff = calc["diff"]
        if diff < 0:
            reply = QMessageBox.question(
                self,
                "Недостача",
                f"Недостача: {format_money(diff)} ₸\nЗакрыть смену?",
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            )
            if reply != QMessageBox.StandardButton.Yes:
                return

        if not self.api:
            QMessageBox.warning(self, "Сменный отчёт", "Сначала подключите точку.")
            return

        batches = [payload]
        if payload["shift"] == "night" and is_last_day_of_month(self.date_edit.date()):
          split_entries = self.ask_split(payload, calc)
          if split_entries is None and payload["shift"] == "night" and is_last_day_of_month(self.date_edit.date()):
              return
          if split_entries:
              batches = split_entries

        saved_offline = False
        errors: list[str] = []
        for item in batches:
            try:
                self.api.send_shift_report(item)
            except Exception as error:
                self.queue.enqueue(item)
                saved_offline = True
                errors.append(str(error))

        self.refresh_queue_label()
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

        self.clear_form()

    def flush_queue(self):
        if not self.api:
            QMessageBox.warning(self, "Очередь", "Сначала подключите точку.")
            return

        sent = 0
        failed = 0
        for item in self.queue.list_pending():
            try:
                self.api.send_shift_report(item["payload"])
                self.queue.remove(item["id"])
                sent += 1
            except Exception as error:
                self.queue.mark_failed(item["id"], str(error))
                failed += 1

        self.refresh_queue_label()
        QMessageBox.information(
            self,
            "Очередь",
            f"Отправлено: {sent}\nОсталось с ошибкой: {failed}",
        )

    def refresh_queue_label(self):
        self.queue_label.setText(f"Очередь: {self.queue.count()}")

    def save_draft(self):
        self.config["draft"] = {
            "date": self.date_edit.date().toString("yyyy-MM-dd"),
            "shift_index": self.shift_box.currentIndex(),
            "comment": self.comment_edit.toPlainText(),
            "inputs": {key: field.text() for key, field in self.inputs.items()},
        }
        save_config(self.config)

    def load_draft(self):
        draft = self.config.get("draft") or {}
        if draft.get("date"):
            parsed = QDate.fromString(str(draft["date"]), "yyyy-MM-dd")
            if parsed.isValid():
                self.date_edit.setDate(parsed)

        shift_index = int(draft.get("shift_index") or 0)
        if 0 <= shift_index < self.shift_box.count():
            self.shift_box.setCurrentIndex(shift_index)

        inputs = draft.get("inputs") or {}
        for key, field in self.inputs.items():
            field.setText(str(inputs.get(key) or "0"))

        self.comment_edit.setPlainText(str(draft.get("comment") or ""))
        self.update_calculation()

    def setup_autosave(self):
        self.autosave_timer = QTimer(self)
        self.autosave_timer.timeout.connect(self.save_draft)
        self.autosave_timer.start(30000)

    def clear_form(self):
        for field in self.inputs.values():
            field.setText("0")
        self.comment_edit.clear()
        self.shift_box.setCurrentIndex(0)
        self.date_edit.setDate(QDate.currentDate())
        self.update_calculation()
        self.save_draft()


def main():
    app = QApplication(sys.argv)
    app.setApplicationName("Orda Control Point")
    window = PointMainWindow()
    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
