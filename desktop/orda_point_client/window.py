from __future__ import annotations

from PyQt6.QtCore import QTimer
from PyQt6.QtWidgets import (
    QDialog,
    QLabel,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QTabWidget,
    QVBoxLayout,
    QHBoxLayout,
    QWidget,
)

from api import PointApiClient
from config import load_config, save_config
from debt_tab import DebtTab
from dialogs import ActivationDialog, OperatorLoginDialog
from shift_tab import ShiftReportTab
from storage import OfflineQueue


class EmptyTab(QWidget):
    def __init__(self, text: str, parent=None):
        super().__init__(parent)
        layout = QVBoxLayout(self)
        label = QLabel(text)
        label.setWordWrap(True)
        label.setStyleSheet("font-size: 15px; color: #94a3b8; padding: 30px;")
        layout.addStretch(1)
        layout.addWidget(label)
        layout.addStretch(1)


class PointMainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Orda Control Point")
        self.resize(1040, 760)

        self.config = load_config()
        self.queue = OfflineQueue()
        self.api: PointApiClient | None = None
        self.bootstrap_data: dict | None = None
        self.current_operator: dict | None = None
        self.shift_tab: ShiftReportTab | None = None
        self.debt_tab: DebtTab | None = None

        container = QWidget()
        self.setCentralWidget(container)
        root = QVBoxLayout(container)
        root.setContentsMargins(20, 20, 20, 20)
        root.setSpacing(16)

        header = QHBoxLayout()
        self.title_label = QLabel("Orda Control Point")
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
        self.retry_btn = QPushButton("Синхронизировать очереди")
        self.retry_btn.clicked.connect(self.flush_queues)
        self.login_btn = QPushButton("Войти как оператор")
        self.login_btn.clicked.connect(lambda: self.login_operator(required=False))
        self.logout_btn = QPushButton("Сменить оператора")
        self.logout_btn.clicked.connect(self.logout_operator)
        toolbar.addWidget(self.connect_btn)
        toolbar.addWidget(self.retry_btn)
        toolbar.addWidget(self.login_btn)
        toolbar.addWidget(self.logout_btn)
        toolbar.addStretch(1)
        self.queue_label = QLabel("Смена: 0 • Долги: 0")
        self.queue_label.setStyleSheet("color: #cbd5e1; font-size: 13px;")
        toolbar.addWidget(self.queue_label)
        root.addLayout(toolbar)

        self.operator_label = QLabel("Оператор не вошёл")
        self.operator_label.setStyleSheet(
            "font-size: 14px; color: #e2e8f0; background: #111827; border: 1px solid #1f2937; "
            "border-radius: 12px; padding: 10px 14px;"
        )
        root.addWidget(self.operator_label)

        self.tabs = QTabWidget()
        root.addWidget(self.tabs, 1)

        self.refresh_queue_label()
        QTimer.singleShot(0, self.start_flow)
        self.setup_autosave()

    def save_config(self):
        save_config(self.config)

    def start_flow(self):
        if not self.bootstrap_if_possible(show_error=False):
            self.configure_connection(required=True)
        if self.bootstrap_data:
            self.login_operator(required=True)

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
            self.save_config()

            if self.bootstrap_if_possible(show_success=True):
                self.current_operator = None
                self.apply_operator_state()
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
        self.build_modules()

    def build_modules(self):
        self.tabs.clear()
        self.shift_tab = None
        self.debt_tab = None

        device = (self.bootstrap_data or {}).get("device") or {}
        flags = (device.get("feature_flags") or {}) if isinstance(device, dict) else {}
        if flags.get("shift_report") is not False:
            self.shift_tab = ShiftReportTab(self)
            self.tabs.addTab(self.shift_tab, "Смена")

        if flags.get("debt_report") is True:
            self.debt_tab = DebtTab(self)
            self.tabs.addTab(self.debt_tab, "Долги")

        if self.tabs.count() == 0:
            self.tabs.addTab(EmptyTab("Для этой точки пока не включены рабочие модули.", self), "Инфо")

        self.apply_operator_state()

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
                self.save_config()
                self.apply_operator_state()
                QMessageBox.information(self, "Вход оператора", "Оператор успешно вошёл в программу.")
                return
            except Exception as error:
                QMessageBox.critical(self, "Вход оператора", str(error))
                if not required:
                    return

    def apply_operator_state(self):
        if not self.current_operator:
            self.operator_label.setText("Оператор не вошёл")
            self.status_label.setText("Нужен вход оператора")
            if self.shift_tab:
                self.shift_tab.set_operator_enabled(False)
            if self.debt_tab:
                self.debt_tab.set_operator_enabled(False)
            return

        name = self.current_operator.get("full_name") or self.current_operator.get("name") or "Оператор"
        role = self.current_operator.get("role_in_company") or "operator"
        username = self.current_operator.get("username") or "—"
        self.operator_label.setText(f"Оператор: {name} • {role} • @{username}")
        self.status_label.setText(f"Вошёл оператор • {name}")
        if self.shift_tab:
            self.shift_tab.set_operator_enabled(True)
            self.tabs.setCurrentWidget(self.shift_tab)
        if self.debt_tab:
            self.debt_tab.update_operator_choices()
            self.debt_tab.set_current_operator(self.current_operator)
            self.debt_tab.set_operator_enabled(True)
            if self.shift_tab is None:
                self.tabs.setCurrentWidget(self.debt_tab)

    def logout_operator(self):
        self.current_operator = None
        self.apply_operator_state()
        self.login_operator(required=True)

    def flush_queues(self):
        if not self.api:
            QMessageBox.warning(self, "Очередь", "Сначала подключите точку.")
            return

        shift_sent = 0
        shift_failed = 0
        for item in self.queue.list_pending_shifts():
            try:
                self.api.send_shift_report(item["payload"])
                self.queue.remove_shift(item["id"])
                shift_sent += 1
            except Exception as error:
                self.queue.mark_failed_shift(item["id"], str(error))
                shift_failed += 1

        debt_sent = 0
        debt_failed = 0
        for item in self.queue.list_pending_debt_actions():
            try:
                if item["action"] == "createDebt":
                    self.api.create_debt(item["payload"])
                elif item["action"] == "deleteDebt":
                    self.api.delete_debt(str((item["payload"] or {}).get("item_id") or ""))
                self.queue.remove_debt_action(item["id"])
                debt_sent += 1
            except Exception as error:
                message = str(error)
                if item["action"] == "deleteDebt" and (
                    "debt-item-not-found" in message or "debt-item-already-deleted" in message
                ):
                    self.queue.remove_debt_action(item["id"])
                    debt_sent += 1
                    continue
                self.queue.mark_failed_debt_action(item["id"], message)
                debt_failed += 1

        self.refresh_queue_label()
        if self.debt_tab:
            self.debt_tab.load_debts()
        QMessageBox.information(
            self,
            "Очереди",
            (
                f"Смены: отправлено {shift_sent}, ошибок {shift_failed}\n"
                f"Долги: отправлено {debt_sent}, ошибок {debt_failed}"
            ),
        )

    def refresh_queue_label(self):
        self.queue_label.setText(
            f"Смена: {self.queue.count_shifts()} • Долги: {self.queue.count_debt_actions()}"
        )

    def save_all_state(self):
        if self.shift_tab:
            self.shift_tab.save_draft()
        if self.debt_tab:
            self.debt_tab.save_draft()

    def setup_autosave(self):
        self.autosave_timer = QTimer(self)
        self.autosave_timer.timeout.connect(self.save_all_state)
        self.autosave_timer.start(30000)
