"""
Orda Control Point v2.0
Main window: login screen + workspace with tabs
"""
from __future__ import annotations

from PyQt6.QtCore import Qt, QTimer
from PyQt6.QtWidgets import (
    QFrame,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QSizePolicy,
    QStackedWidget,
    QStatusBar,
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
from settings_tab import SettingsTab
from shift_tab import ShiftReportTab
from storage import OfflineQueue

SERVER_URL = "https://ordaops.kz"


# ──────────────────────────────────────────────
# HELPERS
# ──────────────────────────────────────────────
def _pill(text: str, bg: str, fg: str, border: str) -> QLabel:
    """Small colored badge label."""
    lbl = QLabel(text)
    lbl.setStyleSheet(
        f"background: {bg}; color: {fg}; border: 1px solid {border}; "
        f"border-radius: 8px; padding: 3px 10px; font-size: 12px; font-weight: 700;"
    )
    return lbl


class _Divider(QFrame):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setFrameShape(QFrame.Shape.HLine)
        self.setStyleSheet("border: none; border-top: 1px solid #0f2035; margin: 0;")
        self.setFixedHeight(1)


class EmptyTab(QWidget):
    def __init__(self, text: str, parent=None):
        super().__init__(parent)
        layout = QVBoxLayout(self)
        layout.setAlignment(Qt.AlignmentFlag.AlignCenter)
        icon = QLabel("⚙️")
        icon.setStyleSheet("font-size: 40px; background: transparent;")
        icon.setAlignment(Qt.AlignmentFlag.AlignCenter)
        label = QLabel(text)
        label.setWordWrap(True)
        label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        label.setStyleSheet("font-size: 15px; color: #4a6a85; padding: 12px 30px;")
        layout.addWidget(icon)
        layout.addSpacing(8)
        layout.addWidget(label)


# ──────────────────────────────────────────────
# MAIN WINDOW
# ──────────────────────────────────────────────
class PointMainWindow(QMainWindow):
    def __init__(self, app_version: str = "2.0.0"):
        super().__init__()
        self.app_version = app_version
        self.setWindowTitle("Orda Control Point")
        self.setMinimumSize(1100, 720)
        self.resize(1200, 820)

        # ── State ──
        self.config = load_config()
        self.queue = OfflineQueue()
        self.api: PointApiClient | None = None
        self.bootstrap_data: dict | None = None
        self.current_operator: dict | None = None
        self.current_admin: dict | None = None
        self.admin_credentials: dict | None = None
        self.auth_mode = "operator"

        # ── Tab refs ──
        self.shift_tab: ShiftReportTab | None = None
        self.debt_tab: DebtTab | None = None
        self.admin_tab: AdminTerminalTab | None = None
        self.scanner_tab: ScannerTab | None = None
        self.products_tab: ProductsTab | None = None
        self.reports_tab: ReportsTab | None = None
        self.settings_tab: SettingsTab | None = None

        # ── Init API ──
        api_url = (self.config.get("api_base_url") or SERVER_URL).rstrip("/")
        token = str(self.config.get("device_token") or "")
        self.api = PointApiClient(api_url, token)

        # ── Build UI ──
        self._build_central()
        self._build_status_bar()

        # ── Auto-save timer ──
        self._autosave_timer = QTimer(self)
        self._autosave_timer.timeout.connect(self.save_all_state)
        self._autosave_timer.start(30_000)

        # ── Queue sync timer ──
        self._sync_timer = QTimer(self)
        self._sync_timer.timeout.connect(self._auto_sync_queues)
        self._sync_timer.start(60_000)

        # ── Bootstrap ──
        QTimer.singleShot(0, self.bootstrap_if_possible)

    # ────────────────────────────────────────
    # UI BUILD
    # ────────────────────────────────────────
    def _build_central(self):
        container = QWidget()
        self.setCentralWidget(container)
        root = QVBoxLayout(container)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)

        # Top header bar
        self._header = self._build_header()
        root.addWidget(self._header)
        root.addWidget(_Divider())

        # Main stack: login | workspace
        self._stack = QStackedWidget()
        root.addWidget(self._stack, 1)

        self._login_view = self._build_login_view()
        self._workspace_view = self._build_workspace_view()
        self._stack.addWidget(self._login_view)
        self._stack.addWidget(self._workspace_view)
        self._stack.setCurrentWidget(self._login_view)

    def _build_header(self) -> QWidget:
        bar = QWidget()
        bar.setFixedHeight(56)
        bar.setStyleSheet("background: #050d17;")
        layout = QHBoxLayout(bar)
        layout.setContentsMargins(20, 0, 20, 0)
        layout.setSpacing(12)

        # Logo
        logo_mark = QLabel("◈")
        logo_mark.setStyleSheet("font-size: 20px; color: #2b7ff5; background: transparent;")
        logo_name = QLabel("Orda Control Point")
        logo_name.setStyleSheet(
            "font-size: 16px; font-weight: 800; color: #d0e8ff; "
            "letter-spacing: 0.5px; background: transparent;"
        )

        layout.addWidget(logo_mark)
        layout.addWidget(logo_name)
        layout.addSpacing(16)

        self._header_point_pill = _pill("Не подключено", "#0a1e35", "#3a6a90", "#0f2a45")
        layout.addWidget(self._header_point_pill)

        layout.addStretch(1)

        self._header_mode_pill = QLabel()
        self._header_mode_pill.hide()
        layout.addWidget(self._header_mode_pill)

        self._header_logout_btn = QPushButton("Выйти")
        self._header_logout_btn.setProperty("class", "ghost")
        self._header_logout_btn.setFixedHeight(32)
        self._header_logout_btn.clicked.connect(self.logout)
        self._header_logout_btn.hide()
        layout.addWidget(self._header_logout_btn)

        return bar

    def _build_login_view(self) -> QWidget:
        outer = QWidget()
        outer_layout = QVBoxLayout(outer)
        outer_layout.setAlignment(Qt.AlignmentFlag.AlignCenter)
        outer_layout.setContentsMargins(0, 0, 0, 0)

        # Center card
        card = QFrame()
        card.setFixedWidth(460)
        card.setStyleSheet(
            "QFrame {"
            "  background: #071929;"
            "  border: 1px solid #152d47;"
            "  border-radius: 20px;"
            "}"
        )
        card_layout = QVBoxLayout(card)
        card_layout.setContentsMargins(36, 32, 36, 32)
        card_layout.setSpacing(16)

        # Point info banner
        self._login_point_banner = QFrame()
        self._login_point_banner.setStyleSheet(
            "QFrame { background: #091c30; border: 1px solid #13304a; border-radius: 12px; }"
        )
        banner_layout = QHBoxLayout(self._login_point_banner)
        banner_layout.setContentsMargins(14, 10, 14, 10)
        self._login_point_icon = QLabel("🔴")
        self._login_point_icon.setStyleSheet("font-size: 14px; background: transparent;")
        self._login_point_text = QLabel("Терминал не привязан")
        self._login_point_text.setStyleSheet("font-size: 13px; color: #5a8aab; background: transparent;")
        banner_layout.addWidget(self._login_point_icon)
        banner_layout.addSpacing(8)
        banner_layout.addWidget(self._login_point_text, 1)
        card_layout.addWidget(self._login_point_banner)

        # Mode tabs
        mode_row = QHBoxLayout()
        mode_row.setSpacing(0)
        self._op_tab_btn = self._make_mode_tab("👤  Оператор", active=True)
        self._op_tab_btn.clicked.connect(lambda: self.set_auth_mode("operator"))
        self._admin_tab_btn = self._make_mode_tab("🔑  Super Admin", active=False)
        self._admin_tab_btn.clicked.connect(lambda: self.set_auth_mode("admin"))
        mode_row.addWidget(self._op_tab_btn, 1)
        mode_row.addWidget(self._admin_tab_btn, 1)
        card_layout.addLayout(mode_row)

        # Form stack
        self._auth_form_stack = QStackedWidget()
        self._auth_form_stack.addWidget(self._build_operator_form())
        self._auth_form_stack.addWidget(self._build_admin_form())
        card_layout.addWidget(self._auth_form_stack)

        # Error label
        self._login_error = QLabel("")
        self._login_error.setWordWrap(True)
        self._login_error.setStyleSheet(
            "font-size: 13px; color: #fca5a5; background: #1f0a0a; "
            "border: 1px solid #5c1a1a; border-radius: 10px; padding: 10px 14px;"
        )
        self._login_error.hide()
        card_layout.addWidget(self._login_error)

        outer_layout.addWidget(card)
        self._refresh_auth_mode_ui()
        return outer

    def _make_mode_tab(self, text: str, active: bool) -> QPushButton:
        btn = QPushButton(text)
        btn.setCheckable(False)
        self._apply_mode_tab_style(btn, active)
        return btn

    def _apply_mode_tab_style(self, btn: QPushButton, active: bool):
        if active:
            btn.setStyleSheet(
                "QPushButton { background: #102540; color: #d0e8ff; border: 1px solid #1e4470; "
                "border-radius: 10px; padding: 10px; font-weight: 700; font-size: 14px; }"
            )
        else:
            btn.setStyleSheet(
                "QPushButton { background: #050d17; color: #3a6080; border: 1px solid #0c2035; "
                "border-radius: 10px; padding: 10px; font-size: 14px; }"
                "QPushButton:hover { background: #0a1a28; color: #6a9ec0; }"
            )

    def _build_operator_form(self) -> QWidget:
        w = QWidget()
        layout = QVBoxLayout(w)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(12)

        login_lbl = QLabel("Логин")
        login_lbl.setStyleSheet("font-size: 13px; color: #5a8aab; font-weight: 600; background: transparent;")
        self._op_login_input = QLineEdit()
        self._op_login_input.setPlaceholderText("Логин оператора")
        self._op_login_input.setText(str(self.config.get("last_operator_username") or ""))

        pass_lbl = QLabel("Пароль")
        pass_lbl.setStyleSheet("font-size: 13px; color: #5a8aab; font-weight: 600; background: transparent;")
        self._op_pass_input = QLineEdit()
        self._op_pass_input.setEchoMode(QLineEdit.EchoMode.Password)
        self._op_pass_input.setPlaceholderText("Пароль от сайта ordaops.kz")
        self._op_pass_input.returnPressed.connect(self._handle_operator_login)

        self._op_state_label = QLabel("")
        self._op_state_label.setWordWrap(True)
        self._op_state_label.setStyleSheet("font-size: 12px; color: #3a6080; background: transparent;")

        self._op_login_btn = QPushButton("Войти в смену")
        self._op_login_btn.setProperty("class", "primary")
        self._op_login_btn.clicked.connect(self._handle_operator_login)

        layout.addWidget(login_lbl)
        layout.addWidget(self._op_login_input)
        layout.addWidget(pass_lbl)
        layout.addWidget(self._op_pass_input)
        layout.addWidget(self._op_state_label)
        layout.addWidget(self._op_login_btn)
        return w

    def _build_admin_form(self) -> QWidget:
        w = QWidget()
        layout = QVBoxLayout(w)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(12)

        email_lbl = QLabel("Email")
        email_lbl.setStyleSheet("font-size: 13px; color: #5a8aab; font-weight: 600; background: transparent;")
        self._admin_email_input = QLineEdit()
        self._admin_email_input.setPlaceholderText("admin@ordaops.kz")

        pass_lbl = QLabel("Пароль")
        pass_lbl.setStyleSheet("font-size: 13px; color: #5a8aab; font-weight: 600; background: transparent;")
        self._admin_pass_input = QLineEdit()
        self._admin_pass_input.setEchoMode(QLineEdit.EchoMode.Password)
        self._admin_pass_input.setPlaceholderText("Пароль super-admin")
        self._admin_pass_input.returnPressed.connect(self._handle_admin_login)

        hint = QLabel("Этот режим — для привязки терминала, настройки каталога и отчётов. Оператор этот экран не видит.")
        hint.setWordWrap(True)
        hint.setStyleSheet("font-size: 12px; color: #2a4f68; background: transparent;")

        self._admin_login_btn = QPushButton("Войти как Super Admin")
        self._admin_login_btn.setProperty("class", "primary")
        self._admin_login_btn.clicked.connect(self._handle_admin_login)

        layout.addWidget(email_lbl)
        layout.addWidget(self._admin_email_input)
        layout.addWidget(pass_lbl)
        layout.addWidget(self._admin_pass_input)
        layout.addWidget(hint)
        layout.addWidget(self._admin_login_btn)
        return w

    def _build_workspace_view(self) -> QWidget:
        wrapper = QWidget()
        root = QVBoxLayout(wrapper)
        root.setContentsMargins(16, 12, 16, 12)
        root.setSpacing(10)

        # Session info bar
        self._session_bar = QFrame()
        self._session_bar.setStyleSheet(
            "QFrame { background: #071525; border: 1px solid #0e2840; border-radius: 12px; }"
        )
        session_bar_layout = QHBoxLayout(self._session_bar)
        session_bar_layout.setContentsMargins(16, 8, 16, 8)
        session_bar_layout.setSpacing(10)

        self._session_operator_lbl = QLabel("—")
        self._session_operator_lbl.setStyleSheet(
            "font-size: 14px; font-weight: 700; color: #c0d8f0; background: transparent;"
        )
        self._session_company_lbl = QLabel("")
        self._session_company_lbl.setStyleSheet(
            "font-size: 13px; color: #4a7a9a; background: transparent;"
        )
        session_bar_layout.addWidget(self._session_operator_lbl)
        session_bar_layout.addWidget(_Divider())
        self._v_divider = QFrame()
        self._v_divider.setFrameShape(QFrame.Shape.VLine)
        self._v_divider.setStyleSheet("color: #0e2840;")
        session_bar_layout.addWidget(self._v_divider)
        session_bar_layout.addWidget(self._session_company_lbl)
        session_bar_layout.addStretch(1)

        # Queue indicator
        self._queue_pill = QLabel("Очередь: 0")
        self._queue_pill.setStyleSheet(
            "font-size: 12px; color: #3a6080; background: transparent;"
        )
        session_bar_layout.addWidget(self._queue_pill)

        self._sync_btn = QPushButton("⟳ Синхронизировать")
        self._sync_btn.setProperty("class", "ghost")
        self._sync_btn.setFixedHeight(28)
        self._sync_btn.clicked.connect(self.flush_queues)
        session_bar_layout.addWidget(self._sync_btn)

        root.addWidget(self._session_bar)

        # Tabs
        self.tabs = QTabWidget()
        self.tabs.setDocumentMode(True)
        root.addWidget(self.tabs, 1)

        return wrapper

    def _build_status_bar(self):
        sb = QStatusBar()
        sb.setSizeGripEnabled(False)
        self.setStatusBar(sb)

        self._sb_connection = QLabel("● Нет подключения")
        self._sb_connection.setStyleSheet("color: #4a3030;")
        self._sb_queue_count = QLabel("Очередь: 0")
        self._sb_version = QLabel(f"v{self.app_version}  •  ordaops.kz")
        self._sb_version.setStyleSheet("color: #1e3a50;")

        sb.addWidget(self._sb_connection)
        sb.addPermanentWidget(self._sb_queue_count)
        sb.addPermanentWidget(self._sb_version)

    # ────────────────────────────────────────
    # AUTH MODE
    # ────────────────────────────────────────
    def set_auth_mode(self, mode: str):
        self.auth_mode = "admin" if mode == "admin" else "operator"
        self._refresh_auth_mode_ui()

    def _refresh_auth_mode_ui(self):
        is_admin = self.auth_mode == "admin"
        self._auth_form_stack.setCurrentIndex(1 if is_admin else 0)
        self._apply_mode_tab_style(self._op_tab_btn, not is_admin)
        self._apply_mode_tab_style(self._admin_tab_btn, is_admin)

        op_ready = self.bootstrap_data is not None
        self._op_login_btn.setEnabled(op_ready)
        self._op_login_input.setEnabled(op_ready)
        self._op_pass_input.setEnabled(op_ready)

        if op_ready:
            company = (self.bootstrap_data or {}).get("company") or {}
            device = (self.bootstrap_data or {}).get("device") or {}
            self._op_state_label.setText(
                f"Терминал: {company.get('name', '—')} • {device.get('name', '—')}"
            )
        else:
            self._op_state_label.setText(
                "Терминал не настроен. Войдите как Super Admin и привяжите точку."
            )

    # ────────────────────────────────────────
    # BOOTSTRAP
    # ────────────────────────────────────────
    def bootstrap_if_possible(self, show_error: bool = False) -> bool:
        api_url = (self.config.get("api_base_url") or SERVER_URL).rstrip("/")
        token = str(self.config.get("device_token") or "").strip()
        self.api = PointApiClient(api_url, token)

        if not token:
            self.bootstrap_data = None
            self._update_login_banner()
            self._update_status_bar()
            return False

        try:
            self.bootstrap_data = self.api.bootstrap()
            self._update_login_banner()
            self._update_status_bar()
            return True
        except Exception as error:
            self.bootstrap_data = None
            self._update_login_banner()
            self._update_status_bar()
            if show_error:
                self.set_login_error(str(error))
            return False

    def _update_login_banner(self):
        company = (self.bootstrap_data or {}).get("company") or {}
        device = (self.bootstrap_data or {}).get("device") or {}
        token = str(self.config.get("device_token") or "").strip()

        if company:
            self._login_point_icon.setText("🟢")
            self._login_point_text.setText(
                f"{company.get('name', '—')}  •  {device.get('name', '—')}  •  привязан"
            )
            self._login_point_text.setStyleSheet(
                "font-size: 13px; color: #22c55e; background: transparent;"
            )
            self._header_point_pill.setText(company.get("name", "—"))
            self._header_point_pill.setStyleSheet(
                "background: #071a0e; color: #22c55e; border: 1px solid #1a4a28; "
                "border-radius: 8px; padding: 3px 10px; font-size: 12px; font-weight: 700;"
            )
        elif token:
            self._login_point_icon.setText("🟡")
            self._login_point_text.setText("Токен сохранён, нет связи с сервером")
            self._login_point_text.setStyleSheet(
                "font-size: 13px; color: #f59e0b; background: transparent;"
            )
            self._header_point_pill.setText("Офлайн")
            self._header_point_pill.setStyleSheet(
                "background: #1a1200; color: #f59e0b; border: 1px solid #4a3500; "
                "border-radius: 8px; padding: 3px 10px; font-size: 12px; font-weight: 700;"
            )
        else:
            self._login_point_icon.setText("🔴")
            self._login_point_text.setText("Терминал не привязан")
            self._login_point_text.setStyleSheet(
                "font-size: 13px; color: #5a8aab; background: transparent;"
            )
            self._header_point_pill.setText("Не подключено")
            self._header_point_pill.setStyleSheet(
                "background: #0a1e35; color: #3a6a90; border: 1px solid #0f2a45; "
                "border-radius: 8px; padding: 3px 10px; font-size: 12px; font-weight: 700;"
            )

        self._refresh_auth_mode_ui()

    def _update_status_bar(self):
        if self.bootstrap_data:
            self._sb_connection.setText("● Подключено")
            self._sb_connection.setStyleSheet("color: #22c55e;")
        else:
            token = str(self.config.get("device_token") or "").strip()
            if token:
                self._sb_connection.setText("● Офлайн")
                self._sb_connection.setStyleSheet("color: #f59e0b;")
            else:
                self._sb_connection.setText("● Нет токена")
                self._sb_connection.setStyleSheet("color: #4a3030;")

        total = self.queue.count_shifts() + self.queue.count_debt_actions()
        if total > 0:
            self._sb_queue_count.setText(f"В очереди: {total}")
            self._sb_queue_count.setStyleSheet("color: #f59e0b;")
        else:
            self._sb_queue_count.setText("Очередь чиста")
            self._sb_queue_count.setStyleSheet("color: #1e3a50;")

    # ────────────────────────────────────────
    # LOGIN HANDLERS
    # ────────────────────────────────────────
    def set_login_error(self, message: str | None):
        text = (message or "").strip()
        self._login_error.setText(text)
        self._login_error.setVisible(bool(text))

    def _handle_operator_login(self):
        self.set_login_error(None)
        username = self._op_login_input.text().strip()
        password = self._op_pass_input.text()

        if not username or not password:
            self.set_login_error("Введите логин и пароль.")
            return

        if not self.bootstrap_if_possible(show_error=False):
            self.set_login_error("Терминал не настроен. Войдите как Super Admin и привяжите точку.")
            return

        try:
            result = self.api.login_operator(username, password)
            self.current_operator = result.get("operator") or None
            self.current_admin = None
            self.admin_credentials = None
            self.config["last_operator_username"] = username
            self.save_config()
            self._op_pass_input.clear()
            self._open_workspace()
        except Exception as error:
            msg = str(error)
            if "invalid-credentials" in msg:
                self.set_login_error("Неверный логин или пароль.")
            elif "operator-not-assigned" in msg:
                self.set_login_error("Оператор не привязан к этой точке.")
            else:
                self.set_login_error(msg)

    def _handle_admin_login(self):
        self.set_login_error(None)
        email = self._admin_email_input.text().strip()
        password = self._admin_pass_input.text()

        if not email or not password:
            self.set_login_error("Введите email и пароль.")
            return

        api_url = (self.config.get("api_base_url") or SERVER_URL).rstrip("/")
        self.api = PointApiClient(api_url, str(self.config.get("device_token") or ""))

        try:
            result = self.api.login_super_admin(email, password)
            self.current_admin = result.get("admin") or {"email": email}
            self.current_operator = None
            self.admin_credentials = {"email": email, "password": password}
            self.bootstrap_if_possible(show_error=False)
            self._open_workspace()
        except Exception as error:
            msg = str(error)
            if "invalid-credentials" in msg:
                self.set_login_error("Неверный email или пароль super-admin.")
            elif "super-admin-only" in msg:
                self.set_login_error("Этот аккаунт не имеет прав super-admin.")
            else:
                self.set_login_error(msg)

    # ────────────────────────────────────────
    # WORKSPACE
    # ────────────────────────────────────────
    def _open_workspace(self):
        self._build_workspace_tabs()
        self._stack.setCurrentWidget(self._workspace_view)
        self._header_logout_btn.show()

    def _build_workspace_tabs(self):
        self.tabs.clear()
        self.shift_tab = None
        self.debt_tab = None
        self.admin_tab = None
        self.scanner_tab = None
        self.products_tab = None
        self.reports_tab = None
        self.settings_tab = None

        device = (self.bootstrap_data or {}).get("device") or {}
        company = (self.bootstrap_data or {}).get("company") or {}
        flags = device.get("feature_flags") or {} if isinstance(device, dict) else {}

        # ── Admin: terminal tab first ──
        if self.current_admin:
            self.admin_tab = AdminTerminalTab(self)
            self.tabs.addTab(self.admin_tab, "⚙️  Терминал")

        # ── Shift report ──
        if self.bootstrap_data and flags.get("shift_report") is not False:
            self.shift_tab = ShiftReportTab(self)
            self.tabs.addTab(self.shift_tab, "📋  Смена")

        # ── Debts / scanner (debt_report flag) ──
        if self.bootstrap_data and flags.get("debt_report") is True:
            self.scanner_tab = ScannerTab(self)
            self.tabs.addTab(self.scanner_tab, "🛒  Сканер")
            self.debt_tab = DebtTab(self)
            self.tabs.addTab(self.debt_tab, "📝  Долги")
            if self.current_admin:
                self.products_tab = ProductsTab(self)
                self.tabs.addTab(self.products_tab, "📦  Товары")

        # ── Reports (admin only) ──
        if self.bootstrap_data and self.current_admin:
            self.reports_tab = ReportsTab(self)
            self.tabs.addTab(self.reports_tab, "📊  Отчёты")

        # ── Settings (admin only) ──
        if self.current_admin:
            self.settings_tab = SettingsTab(self)
            self.tabs.addTab(self.settings_tab, "⚙️  Настройки")

        # ── Nothing available ──
        if self.tabs.count() == 0:
            self.tabs.addTab(
                EmptyTab("Терминал не настроен. Войдите как super-admin и привяжите точку."),
                "ℹ️  Инфо",
            )

        # ── Update session bar ──
        company_name = company.get("name", "—")
        mode = device.get("point_mode", "—")

        if self.current_admin:
            self._session_operator_lbl.setText(
                f"Super Admin  •  {self.current_admin.get('email', '—')}"
            )
            self._session_company_lbl.setText(f"Точка: {company_name}")
            self._header_mode_pill.setText("SUPER ADMIN")
            self._header_mode_pill.setStyleSheet(
                "background: #1a0e35; color: #a78bfa; border: 1px solid #3d2a70; "
                "border-radius: 8px; padding: 3px 10px; font-size: 11px; font-weight: 700;"
            )
            self._header_mode_pill.show()
            if self.admin_tab:
                self.admin_tab.load_devices()
                self.tabs.setCurrentWidget(self.admin_tab)

        elif self.current_operator:
            name = (
                self.current_operator.get("full_name")
                or self.current_operator.get("name")
                or "Оператор"
            )
            role = self.current_operator.get("role_in_company") or "operator"
            username = self.current_operator.get("username") or "—"
            self._session_operator_lbl.setText(f"{name}  •  @{username}")
            self._session_company_lbl.setText(f"Точка: {company_name}  •  {mode}")
            self._header_mode_pill.setText(role.upper())
            self._header_mode_pill.setStyleSheet(
                "background: #071a0e; color: #4ade80; border: 1px solid #1a4a28; "
                "border-radius: 8px; padding: 3px 10px; font-size: 11px; font-weight: 700;"
            )
            self._header_mode_pill.show()
            # Default tab: scanner → shift → debt
            if self.scanner_tab:
                self.tabs.setCurrentWidget(self.scanner_tab)
            elif self.shift_tab:
                self.tabs.setCurrentWidget(self.shift_tab)
            elif self.debt_tab:
                self.tabs.setCurrentWidget(self.debt_tab)

        self.refresh_queue_label()
        self._update_status_bar()

    # ────────────────────────────────────────
    # LOGOUT
    # ────────────────────────────────────────
    def logout(self):
        self.current_operator = None
        self.current_admin = None
        self.admin_credentials = None
        self._op_pass_input.clear()
        self._admin_pass_input.clear()
        self._header_logout_btn.hide()
        self._header_mode_pill.hide()
        self._stack.setCurrentWidget(self._login_view)
        self.set_login_error(None)
        self._update_login_banner()

    # ────────────────────────────────────────
    # QUEUE & SYNC
    # ────────────────────────────────────────
    def refresh_queue_label(self):
        shifts = self.queue.count_shifts()
        debts = self.queue.count_debt_actions()
        total = shifts + debts
        if total > 0:
            text = f"⏳ Очередь: {total}"
            self._queue_pill.setStyleSheet(
                "font-size: 12px; color: #f59e0b; background: transparent; font-weight: 700;"
            )
        else:
            text = "✓ Синхронизировано"
            self._queue_pill.setStyleSheet(
                "font-size: 12px; color: #22c55e; background: transparent;"
            )
        self._queue_pill.setText(text)
        self._update_status_bar()

    def flush_queues(self, silent: bool = False):
        if not self.api:
            if not silent:
                QMessageBox.warning(self, "Синхронизация", "Сначала войдите в программу.")
            return

        shift_sent = shift_failed = 0
        for item in self.queue.list_pending_shifts():
            try:
                self.api.send_shift_report(item["payload"])
                self.queue.remove_shift(item["id"])
                shift_sent += 1
            except Exception as error:
                self.queue.mark_failed_shift(item["id"], str(error))
                shift_failed += 1

        debt_sent = debt_failed = 0
        for item in self.queue.list_pending_debt_actions():
            try:
                if item["action"] == "createDebt":
                    self.api.create_debt(item["payload"])
                elif item["action"] == "deleteDebt":
                    item_id = str((item["payload"] or {}).get("item_id") or "")
                    self.api.delete_debt(item_id)
                self.queue.remove_debt_action(item["id"])
                debt_sent += 1
            except Exception as error:
                msg = str(error)
                if item["action"] == "deleteDebt" and (
                    "debt-item-not-found" in msg or "debt-item-already-deleted" in msg
                ):
                    self.queue.remove_debt_action(item["id"])
                    debt_sent += 1
                    continue
                self.queue.mark_failed_debt_action(item["id"], msg)
                debt_failed += 1

        self.refresh_queue_label()

        if self.debt_tab:
            self.debt_tab.load_debts()
        if self.scanner_tab:
            self.scanner_tab.load_debts()

        if not silent:
            total_sent = shift_sent + debt_sent
            total_failed = shift_failed + debt_failed
            if total_failed == 0 and total_sent == 0:
                self.statusBar().showMessage("Очередь пуста", 3000)
            elif total_failed == 0:
                self.statusBar().showMessage(f"✅ Отправлено {total_sent} записей", 4000)
            else:
                QMessageBox.warning(
                    self,
                    "Синхронизация",
                    f"Отправлено: {total_sent}\nОшибок: {total_failed} (повтор при следующей синхронизации)",
                )

    def _auto_sync_queues(self):
        """Background auto-sync every 60 seconds."""
        if self.api and (self.current_operator or self.current_admin):
            total = self.queue.count_shifts() + self.queue.count_debt_actions()
            if total > 0:
                self.flush_queues(silent=True)

    # ────────────────────────────────────────
    # STATE PERSISTENCE
    # ────────────────────────────────────────
    def build_workspace_for_role(self):
        """Rebuild workspace tabs after device binding change."""
        self._build_workspace_tabs()

    def save_config(self):
        save_config(self.config)

    def save_all_state(self):
        if self.shift_tab:
            self.shift_tab.save_draft()
        if self.debt_tab:
            self.debt_tab.save_draft()
        if self.scanner_tab:
            self.scanner_tab.save_draft()
