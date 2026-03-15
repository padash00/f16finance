from __future__ import annotations

import sys

from PyQt6.QtCore import QDate, Qt, QTimer
from PyQt6.QtWidgets import (
    QApplication,
    QComboBox,
    QDateEdit,
    QDialog,
    QFormLayout,
    QGridLayout,
    QGroupBox,
    QHBoxLayout,
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
        self.resize(760, 560)

        self.config = load_config()
        self.queue = OfflineQueue()
        self.api: PointApiClient | None = None
        self.bootstrap_data: dict | None = None

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

        self.total_label = QLabel("0 ₸")
        self.total_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.total_label.setStyleSheet(
            "font-size: 28px; font-weight: 700; color: #f8fafc; "
            "background: #0f172a; border: 1px solid #1e293b; border-radius: 16px; "
            "padding: 16px 20px;"
        )
        root.addWidget(self.total_label)

        group = QGroupBox("Сменный отчёт")
        group_layout = QGridLayout(group)

        self.operator_box = QComboBox()
        self.date_edit = QDateEdit()
        self.date_edit.setCalendarPopup(True)
        self.date_edit.setDate(QDate.currentDate())
        self.shift_box = QComboBox()
        self.shift_box.addItem("День", "day")
        self.shift_box.addItem("Ночь", "night")

        self.cash_edit = QLineEdit("0")
        self.kaspi_edit = QLineEdit("0")
        self.online_edit = QLineEdit("0")
        self.card_edit = QLineEdit("0")
        self.comment_edit = QPlainTextEdit()
        self.comment_edit.setPlaceholderText("Комментарий к смене")
        self.comment_edit.setFixedHeight(96)

        for money_input in [self.cash_edit, self.kaspi_edit, self.online_edit, self.card_edit]:
            money_input.textChanged.connect(self.update_total)

        group_layout.addWidget(QLabel("Оператор"), 0, 0)
        group_layout.addWidget(self.operator_box, 0, 1)
        group_layout.addWidget(QLabel("Дата"), 0, 2)
        group_layout.addWidget(self.date_edit, 0, 3)
        group_layout.addWidget(QLabel("Смена"), 1, 0)
        group_layout.addWidget(self.shift_box, 1, 1)
        group_layout.addWidget(QLabel("Наличные"), 2, 0)
        group_layout.addWidget(self.cash_edit, 2, 1)
        group_layout.addWidget(QLabel("Kaspi"), 2, 2)
        group_layout.addWidget(self.kaspi_edit, 2, 3)
        group_layout.addWidget(QLabel("Онлайн"), 3, 0)
        group_layout.addWidget(self.online_edit, 3, 1)
        group_layout.addWidget(QLabel("Карта"), 3, 2)
        group_layout.addWidget(self.card_edit, 3, 3)
        group_layout.addWidget(QLabel("Комментарий"), 4, 0, Qt.AlignmentFlag.AlignTop)
        group_layout.addWidget(self.comment_edit, 4, 1, 1, 3)

        root.addWidget(group)

        action_row = QHBoxLayout()
        self.send_btn = QPushButton("Сохранить смену")
        self.send_btn.clicked.connect(self.submit_shift_report)
        action_row.addStretch(1)
        action_row.addWidget(self.send_btn)
        root.addLayout(action_row)

        self.refresh_queue_label()
        self.update_total()
        QTimer.singleShot(0, self.ensure_connected)

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
        for operator in operators:
            label = operator.get("full_name") or operator.get("name") or "Оператор"
            role = operator.get("role_in_company") or "operator"
            self.operator_box.addItem(f"{label} · {role}", operator)

        if self.operator_box.count() > 0:
            self.operator_box.setCurrentIndex(0)
        self.cash_edit.setFocus()

    def current_payload(self) -> dict | None:
        operator = self.operator_box.currentData()
        if not operator:
            QMessageBox.warning(self, "Сменный отчёт", "Выберите оператора.")
            return None

        payload = {
            "date": self.date_edit.date().toString("yyyy-MM-dd"),
            "operator_id": operator["id"],
            "shift": self.shift_box.currentData(),
            "cash_amount": parse_money(self.cash_edit.text()),
            "kaspi_amount": parse_money(self.kaspi_edit.text()),
            "online_amount": parse_money(self.online_edit.text()),
            "card_amount": parse_money(self.card_edit.text()),
            "comment": self.comment_edit.toPlainText().strip() or None,
            "source": "orda-point-client",
            "local_ref": (
                f"{operator['id']}:"
                f"{self.date_edit.date().toString('yyyy-MM-dd')}:"
                f"{self.shift_box.currentData()}"
            ),
        }

        total_amount = (
            payload["cash_amount"]
            + payload["kaspi_amount"]
            + payload["online_amount"]
            + payload["card_amount"]
        )
        if total_amount <= 0:
            QMessageBox.warning(self, "Сменный отчёт", "Укажите сумму по смене.")
            return None

        return payload

    def submit_shift_report(self):
        payload = self.current_payload()
        if not payload:
            return

        if not self.api:
            QMessageBox.warning(self, "Сменный отчёт", "Сначала подключите точку.")
            return

        try:
            self.api.send_shift_report(payload)
            QMessageBox.information(self, "Сменный отчёт", "Смена отправлена в Orda Control.")
            self.cash_edit.setText("0")
            self.kaspi_edit.setText("0")
            self.online_edit.setText("0")
            self.card_edit.setText("0")
            self.comment_edit.clear()
            self.update_total()
        except Exception as error:
            self.queue.enqueue(payload)
            self.refresh_queue_label()
            QMessageBox.warning(
                self,
                "Оффлайн-очередь",
                f"Нет связи с сервером или ошибка API.\nОтчёт сохранён локально.\n\n{error}",
            )

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

    def update_total(self):
        total_amount = (
            parse_money(self.cash_edit.text())
            + parse_money(self.kaspi_edit.text())
            + parse_money(self.online_edit.text())
            + parse_money(self.card_edit.text())
        )
        self.total_label.setText(f"{total_amount:,}".replace(",", " ") + " ₸")


def main():
    app = QApplication(sys.argv)
    app.setApplicationName("Orda Control Point")
    window = PointMainWindow()
    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
