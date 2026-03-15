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
from products_tab import ProductsTab
from reports_tab import ReportsTab
from scanner_tab import ScannerTab
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
        self.resize(1180, 820)

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
        self.scanner_tab: ScannerTab | None = None
        self.products_tab: ProductsTab | None = None
        self.reports_tab: ReportsTab | None = None
        self.auth_mode = "operator"

        api_url = (self.config.get("api_base_url") or "").strip()
        self.api = PointApiClient(api_url or "https://ordaops.kz", str(self.config.get("device_token") or ""))

        container = QWidget()
        self.setCentralWidget(container)
        root = QVBoxLayout(container)
        root.setContentsMargins(20, 20, 20, 20)
        root.setSpacing(16)

        header = QHBoxLayout()
        self.title_label = QLabel("Orda Control Point")
        self.title_label.setStyleSheet("font-size: 26px; font-weight: 800; color: #f8fbff;")
        self.status_label = QLabel("Ожидание входа...")
        self.status_label.setStyleSheet("color: #8ba3bf; font-size: 13px;")
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
        layout.setSpacing(18)

        hero = QFrame()
        hero.setStyleSheet(
            "QFrame { background: #081423; border: 1px solid #17304a; border-radius: 26px; }"
        )
        hero_layout = QVBoxLayout(hero)
        hero_layout.setContentsMargins(26, 24, 26, 24)
        hero_layout.setSpacing(10)

        eyebrow = QLabel("Orda Control Point")
        eyebrow.setStyleSheet("font-size: 12px; letter-spacing: 1px; color: #7fb9ff; font-weight: 700;")
        hero_title = QLabel("Единая программа точки")
        hero_title.setStyleSheet("font-size: 30px; font-weight: 800; color: #f8fbff;")
        hero_subtitle = QLabel(
            "Терминал определяется централизованно, оператор входит своим логином от сайта, "
            "а рабочие модули открываются по точке и правам."
        )
        hero_subtitle.setWordWrap(True)
        hero_subtitle.setStyleSheet("font-size: 14px; color: #9cb0c7; line-height: 1.4;")
        hero_layout.addWidget(eyebrow)
        hero_layout.addWidget(hero_title)
        hero_layout.addWidget(hero_subtitle)
        layout.addWidget(hero)

        card = QFrame()
        card.setStyleSheet(
            "QFrame { background: #081423; border: 1px solid #17304a; border-radius: 26px; }"
        )
        card_layout = QVBoxLayout(card)
        card_layout.setContentsMargins(28, 28, 28, 28)
        card_layout.setSpacing(18)

        title = QLabel("Авторизация")
        title.setStyleSheet("font-size: 24px; font-weight: 800; color: #f8fbff;")
        subtitle = QLabel(
            "Оператор и super-admin входят в разные режимы. Настройка терминала скрыта от оператора."
        )
        subtitle.setWordWrap(True)
        subtitle.setStyleSheet("font-size: 14px; color: #94a3b8;")
        card_layout.addWidget(title)
        card_layout.addWidget(subtitle)

        self.login_point_label = QLabel("Точка: терминал ещё не привязан")
        self.login_point_label.setStyleSheet(
            "font-size: 14px; color: #e2e8f0; background: #0c1b2d; border: 1px solid #1b3550; "
            "border-radius: 14px; padding: 12px 14px;"
        )
        card_layout.addWidget(self.login_point_label)

        self.login_error = QLabel("")
        self.login_error.setWordWrap(True)
        self.login_error.setStyleSheet(
            "font-size: 13px; color: #fecaca; background: #3b1218; border: 1px solid #7f1d1d; "
            "border-radius: 12px; padding: 10px 12px;"
        )
        self.login_error.hide()
        card_layout.addWidget(self.login_error)

        mode_row = QHBoxLayout()
        mode_row.setSpacing(10)
        self.operator_mode_btn = QPushButton("Оператор")
        self.operator_mode_btn.clicked.connect(lambda: self.set_auth_mode("operator"))
        self.admin_mode_btn = QPushButton("Super Admin")
        self.admin_mode_btn.clicked.connect(lambda: self.set_auth_mode("admin"))
        mode_row.addWidget(self.operator_mode_btn)
        mode_row.addWidget(self.admin_mode_btn)
        card_layout.addLayout(mode_row)

        self.auth_hint = QLabel("")
        self.auth_hint.setWordWrap(True)
        self.auth_hint.setStyleSheet("font-size: 13px; color: #8ba3bf;")
        card_layout.addWidget(self.auth_hint)

        self.auth_form_stack = QStackedWidget()
        card_layout.addWidget(self.auth_form_stack)

        operator_form = QWidget()
        operator_layout = QVBoxLayout(operator_form)
        operator_layout.setContentsMargins(0, 0, 0, 0)
        operator_layout.setSpacing(12)
        self.operator_login_input = QLineEdit()
        self.operator_login_input.setPlaceholderText("Логин оператора")
        self.operator_login_input.setText(str(self.config.get("last_operator_username") or ""))
        self.operator_password_input = QLineEdit()
        self.operator_password_input.setEchoMode(QLineEdit.EchoMode.Password)
        self.operator_password_input.setPlaceholderText("Пароль оператора")
        self.operator_state_label = QLabel("")
        self.operator_state_label.setWordWrap(True)
        self.operator_state_label.setStyleSheet("font-size: 13px; color: #9cb0c7;")
        self.operator_login_btn = QPushButton("Войти в смену")
        self.operator_login_btn.clicked.connect(self.handle_operator_login)
        operator_layout.addWidget(self.operator_login_input)
        operator_layout.addWidget(self.operator_password_input)
        operator_layout.addWidget(self.operator_state_label)
        operator_layout.addWidget(self.operator_login_btn)

        admin_form = QWidget()
        admin_layout = QVBoxLayout(admin_form)
        admin_layout.setContentsMargins(0, 0, 0, 0)
        admin_layout.setSpacing(12)
        self.admin_email_input = QLineEdit()
        self.admin_email_input.setPlaceholderText("Email super-admin")
        self.admin_password_input = QLineEdit()
        self.admin_password_input.setEchoMode(QLineEdit.EchoMode.Password)
        self.admin_password_input.setPlaceholderText("Пароль super-admin")
        self.admin_state_label = QLabel(
            "Этот режим нужен только для привязки терминала, выбора точки и настройки каталога."
        )
        self.admin_state_label.setWordWrap(True)
        self.admin_state_label.setStyleSheet("font-size: 13px; color: #9cb0c7;")
        self.admin_login_btn = QPushButton("Открыть режим super-admin")
        self.admin_login_btn.clicked.connect(self.handle_admin_login)
        admin_layout.addWidget(self.admin_email_input)
        admin_layout.addWidget(self.admin_password_input)
        admin_layout.addWidget(self.admin_state_label)
        admin_layout.addWidget(self.admin_login_btn)

        self.auth_form_stack.addWidget(operator_form)
        self.auth_form_stack.addWidget(admin_form)

        layout.addWidget(card)
        layout.addStretch(1)
        self.refresh_auth_mode_ui()
        return wrapper

    def build_workspace_view(self):
        wrapper = QWidget()
        root = QVBoxLayout(wrapper)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(16)

        self.company_label = QLabel("Точка: —")
        self.company_label.setStyleSheet(
            "font-size: 15px; color: #e2e8f0; background: #0c1b2d; border: 1px solid #1b3550; "
            "border-radius: 14px; padding: 12px 14px;"
        )
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
            "font-size: 14px; color: #e2e8f0; background: #0c1b2d; border: 1px solid #1b3550; "
            "border-radius: 14px; padding: 12px 14px;"
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
        self.refresh_auth_mode_ui()

    def set_login_error(self, message: str | None):
        text = (message or "").strip()
        self.login_error.setText(text)
        self.login_error.setVisible(bool(text))

    def show_login_mode(self):
        self.stack.setCurrentWidget(self.login_view)
        self.status_label.setText("Ожидание входа...")
        self.title_label.setText("Orda Control Point")
        self.update_login_point_label()
        self.refresh_auth_mode_ui()

    def show_workspace_mode(self):
        self.stack.setCurrentWidget(self.workspace_view)

    def set_auth_mode(self, mode: str):
        self.auth_mode = "admin" if mode == "admin" else "operator"
        self.refresh_auth_mode_ui()

    def refresh_auth_mode_ui(self):
        operator_ready = self.bootstrap_data is not None
        if self.auth_mode == "admin":
            self.auth_form_stack.setCurrentIndex(1)
            self.operator_mode_btn.setStyleSheet("")
            self.admin_mode_btn.setStyleSheet("background: #4ea4ff; color: #03111f; border: none;")
            self.auth_hint.setText(
                "Super-admin использует этот режим для привязки точки, смены терминала и сервисных настроек."
            )
        else:
            self.auth_form_stack.setCurrentIndex(0)
            self.operator_mode_btn.setStyleSheet("background: #4ea4ff; color: #03111f; border: none;")
            self.admin_mode_btn.setStyleSheet("")
            self.auth_hint.setText(
                "Оператор видит только рабочие модули своей точки. Настройки терминала в этот режим не попадают."
            )

        self.operator_login_btn.setEnabled(operator_ready)
        self.operator_login_input.setEnabled(operator_ready)
        self.operator_password_input.setEnabled(operator_ready)
        if operator_ready:
            company = (self.bootstrap_data or {}).get("company") or {}
            device = (self.bootstrap_data or {}).get("device") or {}
            self.operator_state_label.setText(
                f"Терминал готов: {company.get('name', 'Точка')} • {device.get('name', 'device')}"
            )
        else:
            self.operator_state_label.setText(
                "Терминал ещё не привязан. Сначала войдите как super-admin и выберите устройство точки."
            )

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
        self.scanner_tab = None
        self.products_tab = None
        self.reports_tab = None

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
            self.scanner_tab = ScannerTab(self)
            self.tabs.addTab(self.scanner_tab, "Сканер")
            self.debt_tab = DebtTab(self)
            self.tabs.addTab(self.debt_tab, "Долги")
            if self.current_admin:
                self.products_tab = ProductsTab(self)
                self.tabs.addTab(self.products_tab, "Товары")

        if self.bootstrap_data and self.current_admin:
            self.reports_tab = ReportsTab(self)
            self.tabs.addTab(self.reports_tab, "Отчёты")

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
            if self.scanner_tab:
                self.tabs.setCurrentWidget(self.scanner_tab)
            elif self.shift_tab:
                self.tabs.setCurrentWidget(self.shift_tab)
            elif self.debt_tab:
                self.tabs.setCurrentWidget(self.debt_tab)

        self.show_workspace_mode()
        self.refresh_queue_label()

    def handle_operator_login(self):
        self.set_login_error(None)
        username = self.operator_login_input.text().strip()
        password = self.operator_password_input.text()
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
            self.operator_password_input.clear()
            self.build_workspace_for_role()
        except Exception as error:
            self.set_login_error(str(error))

    def handle_admin_login(self):
        self.set_login_error(None)
        email = self.admin_email_input.text().strip()
        password = self.admin_password_input.text()
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
        self.operator_password_input.clear()
        self.admin_password_input.clear()
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
        if self.scanner_tab:
            self.scanner_tab.load_debts()
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
        if self.scanner_tab:
            self.scanner_tab.save_draft()

    def setup_autosave(self):
        self.autosave_timer = QTimer(self)
        self.autosave_timer.timeout.connect(self.save_all_state)
        self.autosave_timer.start(30000)
