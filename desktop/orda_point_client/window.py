from __future__ import annotations

from PyQt6.QtCore import QTimer
from PyQt6.QtWidgets import (
    QFrame,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QStackedWidget,
    QTabWidget,
    QVBoxLayout,
    QWidget,
)

from admin_tab import AdminTerminalTab
from api import PointApiClient
from config import load_config, save_config
from debt_tab import DebtTab
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
        self.current_admin: dict | None = None
        self.admin_credentials: dict | None = None
        self.shift_tab: ShiftReportTab | None = None
        self.debt_tab: DebtTab | None = None
        self.admin_tab: AdminTerminalTab | None = None

        api_url = (self.config.get("api_base_url") or "").strip()
        self.api = PointApiClient(api_url or "https://ordaops.kz", str(self.config.get("device_token") or ""))

        container = QWidget()
        self.setCentralWidget(container)
        root = QVBoxLayout(container)
        root.setContentsMargins(20, 20, 20, 20)
        root.setSpacing(16)

        header = QHBoxLayout()
        self.title_label = QLabel("Orda Control Point")
        self.title_label.setStyleSheet("font-size: 24px; font-weight: 700;")
        self.status_label = QLabel("Ожидание входа...")
        self.status_label.setStyleSheet("color: #94a3b8; font-size: 13px;")
        header.addWidget(self.title_label)
        header.addStretch(1)
        header.addWidget(self.status_label)
        root.addLayout(header)

        self.stack = QStackedWidget()
        root.addWidget(self.stack, 1)

        self.login_view = self.build_login_view()
        self.workspace_view = self.build_workspace_view()
        self.stack.addWidget(self.login_view)
        self.stack.addWidget(self.workspace_view)
        self.stack.setCurrentWidget(self.login_view)

        self.refresh_queue_label()
        self.show_login_mode()
        QTimer.singleShot(0, self.bootstrap_if_possible)
        self.setup_autosave()

    def build_login_view(self):
        wrapper = QWidget()
        layout = QVBoxLayout(wrapper)
        layout.addStretch(1)

        card = QFrame()
        card.setStyleSheet(
            "QFrame { background: #0f172a; border: 1px solid #1f2937; border-radius: 24px; }"
        )
        card_layout = QVBoxLayout(card)
        card_layout.setContentsMargins(28, 28, 28, 28)
        card_layout.setSpacing(16)

        title = QLabel("Вход в программу точки")
        title.setStyleSheet("font-size: 28px; font-weight: 700; color: #f8fafc;")
        subtitle = QLabel(
            "Оператор входит своим логином и паролем с сайта. Настройка терминала доступна только super-admin."
        )
        subtitle.setWordWrap(True)
        subtitle.setStyleSheet("font-size: 14px; color: #94a3b8;")
        card_layout.addWidget(title)
        card_layout.addWidget(subtitle)

        self.login_point_label = QLabel("Точка: терминал ещё не привязан")
        self.login_point_label.setStyleSheet(
            "font-size: 14px; color: #e2e8f0; background: #111827; border: 1px solid #1f2937; "
            "border-radius: 12px; padding: 10px 14px;"
        )
        card_layout.addWidget(self.login_point_label)

        self.login_error = QLabel("")
        self.login_error.setWordWrap(True)
        self.login_error.setStyleSheet("font-size: 13px; color: #fca5a5;")
        self.login_error.hide()
        card_layout.addWidget(self.login_error)

        self.login_input = QLineEdit()
        self.login_input.setPlaceholderText("Логин оператора или email super-admin")
        self.login_input.setText(str(self.config.get("last_operator_username") or ""))
        self.password_input = QLineEdit()
        self.password_input.setEchoMode(QLineEdit.EchoMode.Password)
        self.password_input.setPlaceholderText("Пароль")
        card_layout.addWidget(self.login_input)
        card_layout.addWidget(self.password_input)

        buttons = QHBoxLayout()
        self.operator_login_btn = QPushButton("Войти как оператор")
        self.operator_login_btn.clicked.connect(self.handle_operator_login)
        self.admin_login_btn = QPushButton("Super Admin")
        self.admin_login_btn.clicked.connect(self.handle_admin_login)
        buttons.addWidget(self.operator_login_btn)
        buttons.addWidget(self.admin_login_btn)
        card_layout.addLayout(buttons)

        layout.addWidget(card, 0)
        layout.addStretch(1)
        return wrapper

    def build_workspace_view(self):
        wrapper = QWidget()
        root = QVBoxLayout(wrapper)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(16)

        self.company_label = QLabel("Точка: —")
        self.company_label.setStyleSheet("font-size: 14px; color: #cbd5e1;")
        root.addWidget(self.company_label)

        toolbar = QHBoxLayout()
        self.retry_btn = QPushButton("Синхронизировать очереди")
        self.retry_btn.clicked.connect(self.flush_queues)
        self.logout_btn = QPushButton("Выйти")
        self.logout_btn.clicked.connect(self.logout)
        toolbar.addWidget(self.retry_btn)
        toolbar.addWidget(self.logout_btn)
        toolbar.addStretch(1)
        self.queue_label = QLabel("Смена: 0 • Долги: 0")
        self.queue_label.setStyleSheet("color: #cbd5e1; font-size: 13px;")
        toolbar.addWidget(self.queue_label)
        root.addLayout(toolbar)

        self.session_label = QLabel("Сессия не активна")
        self.session_label.setStyleSheet(
            "font-size: 14px; color: #e2e8f0; background: #111827; border: 1px solid #1f2937; "
            "border-radius: 12px; padding: 10px 14px;"
        )
        root.addWidget(self.session_label)

        self.tabs = QTabWidget()
        root.addWidget(self.tabs, 1)
        return wrapper

    def save_config(self):
        save_config(self.config)

    def update_login_point_label(self):
        company = (self.bootstrap_data or {}).get("company") or {}
        device = (self.bootstrap_data or {}).get("device") or {}
        token = str(self.config.get("device_token") or "").strip()
        if company:
            self.login_point_label.setText(
                f"Точка: {company.get('name', '—')} • {device.get('name', 'device')} • терминал привязан"
            )
        elif token:
            self.login_point_label.setText("Точка: token сохранён, пробую подключиться к серверу")
        else:
            self.login_point_label.setText("Точка: терминал ещё не привязан")

    def set_login_error(self, message: str | None):
        text = (message or "").strip()
        self.login_error.setText(text)
        self.login_error.setVisible(bool(text))

    def show_login_mode(self):
        self.stack.setCurrentWidget(self.login_view)
        self.status_label.setText("Ожидание входа...")
        self.title_label.setText("Orda Control Point")
        self.update_login_point_label()

    def show_workspace_mode(self):
        self.stack.setCurrentWidget(self.workspace_view)

    def bootstrap_if_possible(self, show_error: bool = False) -> bool:
        api_url = (self.config.get("api_base_url") or "").strip() or "https://ordaops.kz"
        device_token = (self.config.get("device_token") or "").strip()
        self.api = PointApiClient(api_url, device_token)
        if not device_token:
            self.bootstrap_data = None
            self.update_login_point_label()
            return False

        try:
            self.bootstrap_data = self.api.bootstrap()
            self.update_login_point_label()
            return True
        except Exception as error:
            self.bootstrap_data = None
            self.update_login_point_label()
            if show_error:
                self.set_login_error(str(error))
            return False

    def build_workspace_for_role(self):
        self.tabs.clear()
        self.shift_tab = None
        self.debt_tab = None
        self.admin_tab = None

        if self.current_admin:
            self.admin_tab = AdminTerminalTab(self)
            self.tabs.addTab(self.admin_tab, "Терминал")

        device = (self.bootstrap_data or {}).get("device") or {}
        company = (self.bootstrap_data or {}).get("company") or {}
        flags = (device.get("feature_flags") or {}) if isinstance(device, dict) else {}

        if self.bootstrap_data and flags.get("shift_report") is not False:
            self.shift_tab = ShiftReportTab(self)
            self.tabs.addTab(self.shift_tab, "Смена")

        if self.bootstrap_data and flags.get("debt_report") is True:
            self.debt_tab = DebtTab(self)
            self.tabs.addTab(self.debt_tab, "Долги")

        if self.tabs.count() == 0:
            self.tabs.addTab(EmptyTab("Терминал ещё не настроен. Войдите как super-admin и привяжите точку.", self), "Инфо")

        if self.current_admin:
            self.company_label.setText(
                f"Super Admin • текущая точка: {company.get('name', 'не выбрана')}"
            )
            self.session_label.setText(f"Super Admin: {self.current_admin.get('email', '—')}")
            if self.admin_tab:
                self.admin_tab.load_devices()
                self.tabs.setCurrentWidget(self.admin_tab)
        elif self.current_operator:
            name = self.current_operator.get("full_name") or self.current_operator.get("name") or "Оператор"
            role = self.current_operator.get("role_in_company") or "operator"
            username = self.current_operator.get("username") or "—"
            self.company_label.setText(
                f"Точка: {company.get('name', '—')}  |  Режим: {device.get('point_mode', '—')}"
            )
            self.session_label.setText(f"Оператор: {name} • {role} • @{username}")
            if self.shift_tab:
                self.tabs.setCurrentWidget(self.shift_tab)
            elif self.debt_tab:
                self.tabs.setCurrentWidget(self.debt_tab)

        self.show_workspace_mode()
        self.refresh_queue_label()

    def handle_operator_login(self):
        self.set_login_error(None)
        username = self.login_input.text().strip()
        password = self.password_input.text()
        if not username or not password:
            self.set_login_error("Введите логин и пароль оператора.")
            return

        if not self.bootstrap_if_possible(show_error=False):
            self.set_login_error("Терминал ещё не настроен. Войти может только super-admin.")
            return

        try:
            result = self.api.login_operator(username, password)
            self.current_operator = result.get("operator") or None
            self.current_admin = None
            self.admin_credentials = None
            self.config["last_operator_username"] = username
            self.save_config()
            self.status_label.setText("Оператор вошёл")
            self.password_input.clear()
            self.build_workspace_for_role()
        except Exception as error:
            self.set_login_error(str(error))

    def handle_admin_login(self):
        self.set_login_error(None)
        email = self.login_input.text().strip()
        password = self.password_input.text()
        if not email or not password:
            self.set_login_error("Введите email и пароль super-admin.")
            return

        api_url = (self.config.get("api_base_url") or "").strip() or "https://ordaops.kz"
        self.api = PointApiClient(api_url, str(self.config.get("device_token") or ""))

        try:
            result = self.api.login_super_admin(email, password)
            self.current_admin = result.get("admin") or {"email": email}
            self.current_operator = None
            self.admin_credentials = {"email": email, "password": password}
            self.bootstrap_if_possible(show_error=False)
            self.status_label.setText("Super Admin вошёл")
            self.build_workspace_for_role()
        except Exception as error:
            self.set_login_error(str(error))

    def logout(self):
        self.current_operator = None
        self.current_admin = None
        self.admin_credentials = None
        self.password_input.clear()
        self.show_login_mode()

    def flush_queues(self):
        if not self.api:
            QMessageBox.warning(self, "Очередь", "Сначала войдите в программу.")
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
            f"Смены: отправлено {shift_sent}, ошибок {shift_failed}\nДолги: отправлено {debt_sent}, ошибок {debt_failed}",
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
