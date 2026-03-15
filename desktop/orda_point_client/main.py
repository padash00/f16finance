from __future__ import annotations

import sys

from PyQt6.QtCore import QDate, Qt, QTimer
from PyQt6.QtGui import QIntValidator
from PyQt6.QtWidgets import (
    QApplication,
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
            "После подключения программа запросит вход оператора."
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


class OperatorLoginDialog(QDialog):
    def __init__(self, remembered_username: str | None = None, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Вход оператора")
        self.setModal(True)
        self.resize(420, 220)

        layout = QVBoxLayout(self)

        intro = QLabel(
            "Войдите под логином и паролем оператора.\n"
            "Используются те же данные, что и для операторского кабинета на сайте."
        )
        intro.setWordWrap(True)
        intro.setStyleSheet("color: #94a3b8; font-size: 13px;")
        layout.addWidget(intro)

        form = QFormLayout()
        self.username = QLineEdit(remembered_username or "")
        self.password = QLineEdit()
        self.password.setEchoMode(QLineEdit.EchoMode.Password)
        form.addRow("Логин", self.username)
        form.addRow("Пароль", self.password)
        layout.addLayout(form)

        buttons = QHBoxLayout()
        buttons.addStretch(1)
        login_btn = QPushButton("Войти")
        login_btn.clicked.connect(self.accept)
        buttons.addWidget(login_btn)
        layout.addLayout(buttons)

    def payload(self) -> dict:
        return {
            "username": self.username.text().strip(),
            "password": self.password.text(),
        }


class PointMainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Orda Control Point • Калькулятор смены")
        self.resize(900, 660)

        self.config = load_config()
        self.queue = OfflineQueue()
        self.api: PointApiClient | None = None
        self.bootstrap_data: dict | None = None
        self.current_operator: dict | None = None
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
        self.login_btn = QPushButton("Войти как оператор")
        self.login_btn.clicked.connect(lambda: self.login_operator(required=False))
        self.logout_btn = QPushButton("Сменить оператора")
        self.logout_btn.clicked.connect(self.logout_operator)
        toolbar.addWidget(self.connect_btn)
        toolbar.addWidget(self.retry_btn)
        toolbar.addWidget(self.login_btn)
        toolbar.addWidget(self.logout_btn)
        toolbar.addStretch(1)
        self.queue_label = QLabel("Очередь: 0")
        self.queue_label.setStyleSheet("color: #cbd5e1; font-size: 13px;")
        toolbar.addWidget(self.queue_label)
        root.addLayout(toolbar)

        self.operator_label = QLabel("Оператор не вошёл")
        self.operator_label.setStyleSheet(
            "font-size: 14px; color: #e2e8f0; background: #111827; border: 1px solid #1f2937; border-radius: 12px; padding: 10px 14px;"
        )
        root.addWidget(self.operator_label)

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
        self.shift_label = QLabel("Смена")
        self.shift_label.setStyleSheet("font-size: 14px; color: #e2e8f0;")
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
        self.selected_shift: str | None = None

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

        self.refresh_queue_label()
        self.update_calculation()
        self.setup_autosave()
        self.set_workflow_enabled(False)
        QTimer.singleShot(0, self.start_flow)

    def make_input(self, label_text: str, grid: QGridLayout, row: int) -> QLineEdit:
        grid.addWidget(QLabel(label_text), row, 0)
        line = QLineEdit("0")
        line.setAlignment(Qt.AlignmentFlag.AlignRight)
        line.setValidator(QIntValidator(0, 9_999_999))
        line.textChanged.connect(self.update_calculation)
        grid.addWidget(line, row, 1)
        return line

    def start_flow(self):
        if not self.bootstrap_if_possible(show_error=False):
            self.configure_connection(required=True)
        if self.bootstrap_data:
            self.login_operator(required=True)

    def set_workflow_enabled(self, enabled: bool):
        for group in [self.fact_group, self.sys_group, self.meta_group]:
            group.setEnabled(enabled)
        self.send_btn.setEnabled(enabled)
        self.clear_btn.setEnabled(enabled)
        self.logout_btn.setEnabled(enabled)

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
                self.login_operator(required=True)
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
        device = (self.bootstrap_data or {}).get("device") or {}
        self.company_label.setText(
            f"Точка: {company.get('name', '—')}  |  Режим: {device.get('point_mode', '—')}"
        )
        self.status_label.setText(f"Подключено • {device.get('name', 'device')}")
        self.setWindowTitle(f"Orda Control Point • {company.get('name', 'Точка')}")
        self.load_draft()

    def login_operator(self, required: bool):
        if not self.api:
            QMessageBox.warning(self, "Вход оператора", "Сначала подключите точку.")
            return

        remembered = self.config.get("last_operator_username") or ""
        while True:
            dialog = OperatorLoginDialog(remembered_username=str(remembered), parent=self)
            if dialog.exec() != QDialog.DialogCode.Accepted:
                if required and not self.current_operator:
                    self.close()
                return

            payload = dialog.payload()
            if not payload["username"] or not payload["password"]:
                QMessageBox.warning(self, "Вход оператора", "Нужны логин и пароль.")
                if required:
                    continue
                return

            try:
                result = self.api.login_operator(payload["username"], payload["password"])
                self.current_operator = result.get("operator") or None
                self.config["last_operator_username"] = payload["username"]
                save_config(self.config)
                self.hydrate_operator()
                QMessageBox.information(self, "Вход оператора", "Оператор успешно вошёл в программу.")
                return
            except Exception as error:
                QMessageBox.critical(self, "Вход оператора", str(error))
                if not required:
                    return

    def hydrate_operator(self):
        if not self.current_operator:
            self.operator_label.setText("Оператор не вошёл")
            self.status_label.setText("Нужен вход оператора")
            self.set_workflow_enabled(False)
            return

        name = self.current_operator.get("full_name") or self.current_operator.get("name") or "Оператор"
        role = self.current_operator.get("role_in_company") or "operator"
        username = self.current_operator.get("username") or "—"
        self.operator_label.setText(f"Оператор: {name} • {role} • @{username}")
        self.status_label.setText(f"Вошёл оператор • {name}")
        self.set_workflow_enabled(True)
        self.inputs["cash"].setFocus()

    def logout_operator(self):
        self.current_operator = None
        self.hydrate_operator()
        self.login_operator(required=True)

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
        if shift == "day":
          self.shift_value.setText("Дневная смена")
        else:
          self.shift_value.setText("Ночная смена")

    def validate_form(self) -> bool:
        if not self.current_operator:
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

    def current_payload(self) -> tuple[dict, dict[str, int]] | tuple[None, None]:
        if not self.current_operator:
            return None, None

        calc = self.calculation()
        payload = {
            "date": self.date_edit.date().toString("yyyy-MM-dd"),
            "operator_id": self.current_operator["operator_id"],
            "shift": self.selected_shift,
            "cash_amount": calc["cash"],
            "kaspi_amount": calc["kaspi_pos"],
            "online_amount": calc["kaspi_online"],
            "card_amount": 0,
            "comment": self.comment_edit.toPlainText().strip() or None,
            "source": "orda-point-client-arena",
            "local_ref": (
                f"{self.current_operator['operator_id']}:"
                f"{self.date_edit.date().toString('yyyy-MM-dd')}:"
                f"{self.selected_shift}"
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
            "selected_shift": self.selected_shift,
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

    def setup_autosave(self):
        self.autosave_timer = QTimer(self)
        self.autosave_timer.timeout.connect(self.save_draft)
        self.autosave_timer.start(30000)

    def clear_form(self):
        for field in self.inputs.values():
            field.setText("0")
        self.comment_edit.clear()
        self.selected_shift = None
        self.shift_value.setText("Выберите: день или ночь")
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
