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

import theme
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
# UI COMPONENTS
# ──────────────────────────────────────────────

class StatusPill(QLabel):
    """Маленький pill-бейдж с цветом."""
    def __init__(self, text: str, color: str = theme.TEXT_MUTED):
        super().__init__(text)
        self._set_color(color)

    def _set_color(self, color: str):
        self.setStyleSheet(
            f"background: transparent;"
            f"color: {color};"
            f"border: 1.5px solid {color};"
            f"border-radius: 10px;"
            f"padding: 2px 10px;"
            f"font-size: 11px;"
            f"font-weight: 600;"
            f"letter-spacing: 0.5px;"
        )

    def set_variant(self, variant: str):
        colors = {
            "success": theme.SUCCESS,
            "warning": theme.WARNING,
            "error":   theme.ERROR,
            "accent":  theme.ACCENT,
            "default": theme.TEXT_MUTED,
        }
        self._set_color(colors.get(variant, theme.TEXT_MUTED))


# Keep compat aliases used by other tabs
ModernPill = StatusPill


class Card(QFrame):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setStyleSheet(theme.card_style())


GlassCard = Card


class _Divider(QFrame):
    def __init__(self, orientation=Qt.Orientation.Horizontal):
        super().__init__()
        if orientation == Qt.Orientation.Horizontal:
            self.setFrameShape(QFrame.Shape.HLine)
            self.setFixedHeight(1)
        else:
            self.setFrameShape(QFrame.Shape.VLine)
            self.setFixedWidth(1)
        self.setStyleSheet(f"border: none; background: {theme.DIVIDER};")


ModernDivider = _Divider


class EmptyTab(QWidget):
    def __init__(self, text: str, parent=None):
        super().__init__(parent)
        layout = QVBoxLayout(self)
        layout.setAlignment(Qt.AlignmentFlag.AlignCenter)

        label = QLabel(text)
        label.setWordWrap(True)
        label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        label.setStyleSheet(theme.muted_style(14))

        layout.addWidget(label)


# ──────────────────────────────────────────────
# MAIN WINDOW
# ──────────────────────────────────────────────
class PointMainWindow(QMainWindow):
    def __init__(self, app_version: str = "2.0.0"):
        super().__init__()
        self.app_version = app_version
        self.setWindowTitle("Orda Control Point")
        self.setMinimumSize(1200, 800)
        self.resize(1400, 900)

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

        self._header = self._build_header()
        root.addWidget(self._header)

        divider = _Divider()
        root.addWidget(divider)

        self._stack = QStackedWidget()
        root.addWidget(self._stack, 1)

        self._login_view = self._build_login_view()
        self._workspace_view = self._build_workspace_view()
        self._stack.addWidget(self._login_view)
        self._stack.addWidget(self._workspace_view)
        self._stack.setCurrentWidget(self._login_view)

    def _build_header(self) -> QWidget:
        bar = QWidget()
        bar.setFixedHeight(theme.HEADER_H)
        bar.setStyleSheet(f"background: {theme.BG};")

        layout = QHBoxLayout(bar)
        layout.setContentsMargins(theme.PADDING_OUTER, 0, theme.PADDING_OUTER, 0)
        layout.setSpacing(16)

        # Название компании
        logo = QLabel("Orda Control Point")
        logo.setStyleSheet(
            f"font-size: 18px; font-weight: 700; color: {theme.TEXT}; background: transparent;"
        )
        layout.addWidget(logo)

        layout.addStretch(1)

        # Оператор + точка (pill по центру)
        self._header_point_pill = StatusPill("Не подключено")
        layout.addWidget(self._header_point_pill)

        self._header_mode_pill = StatusPill("")
        self._header_mode_pill.hide()
        layout.addWidget(self._header_mode_pill)

        layout.addSpacing(16)

        # Кнопка выхода (серая, не акцентная)
        self._header_logout_btn = QPushButton("Выйти")
        self._header_logout_btn.setProperty("class", "ghost")
        self._header_logout_btn.setFixedHeight(36)
        self._header_logout_btn.clicked.connect(self.logout)
        self._header_logout_btn.hide()
        layout.addWidget(self._header_logout_btn)

        return bar

    def _build_login_view(self) -> QWidget:
        outer = QWidget()
        outer_layout = QVBoxLayout(outer)
        outer_layout.setAlignment(Qt.AlignmentFlag.AlignCenter)
        outer_layout.setContentsMargins(0, 0, 0, 0)

        # Карточка 380px
        card = QFrame()
        card.setFixedWidth(380)
        card.setStyleSheet(
            f"QFrame {{ background: {theme.CARD}; border: 1px solid {theme.DIVIDER};"
            f" border-radius: {theme.RADIUS_CARD}px; }}"
        )

        card_layout = QVBoxLayout(card)
        card_layout.setContentsMargins(theme.PADDING_CARD * 2, 32, theme.PADDING_CARD * 2, 32)
        card_layout.setSpacing(theme.GAP_SECTION)

        # Логотип + название
        title = QLabel("Orda Control Point")
        title.setStyleSheet(
            f"font-size: {theme.FONT_SCREEN_TITLE}px; font-weight: 500;"
            f" color: {theme.TEXT}; background: transparent;"
        )
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        card_layout.addWidget(title)

        subtitle = QLabel("Система учёта смен")
        subtitle.setStyleSheet(theme.muted_style(12))
        subtitle.setAlignment(Qt.AlignmentFlag.AlignCenter)
        card_layout.addWidget(subtitle)

        card_layout.addSpacing(8)

        # Статус терминала
        self._login_point_text = QLabel("Терминал не привязан")
        self._login_point_text.setStyleSheet(theme.muted_style(12))
        self._login_point_text.setAlignment(Qt.AlignmentFlag.AlignCenter)
        card_layout.addWidget(self._login_point_text)

        card_layout.addSpacing(8)

        # Переключатель режимов (Оператор / Super Admin)
        mode_row = QHBoxLayout()
        mode_row.setSpacing(0)

        self._op_tab_btn = self._make_mode_btn("Оператор", True)
        self._op_tab_btn.clicked.connect(lambda: self.set_auth_mode("operator"))

        self._admin_tab_btn = self._make_mode_btn("Super Admin", False)
        self._admin_tab_btn.clicked.connect(lambda: self.set_auth_mode("admin"))

        mode_row.addWidget(self._op_tab_btn)
        mode_row.addWidget(self._admin_tab_btn)
        card_layout.addLayout(mode_row)

        # Стек форм
        self._auth_form_stack = QStackedWidget()
        self._auth_form_stack.addWidget(self._build_operator_form())
        self._auth_form_stack.addWidget(self._build_admin_form())
        card_layout.addWidget(self._auth_form_stack)

        # Ошибка
        self._login_error_label = QLabel("")
        self._login_error_label.setStyleSheet(
            f"color: {theme.ERROR}; font-size: 12px; background: transparent;"
        )
        self._login_error_label.setWordWrap(True)
        self._login_error_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self._login_error_label.hide()
        card_layout.addWidget(self._login_error_label)

        # Подсказка
        hint = QLabel("Забыли пароль — обратитесь к администратору")
        hint.setStyleSheet(theme.muted_style(11))
        hint.setAlignment(Qt.AlignmentFlag.AlignCenter)
        card_layout.addWidget(hint)

        outer_layout.addWidget(card)

        self._refresh_auth_mode_ui()
        return outer

    def _make_mode_btn(self, text: str, active: bool) -> QPushButton:
        btn = QPushButton(text)
        btn.setCursor(Qt.CursorShape.PointingHandCursor)
        btn.setFixedHeight(36)
        self._apply_mode_btn_style(btn, active)
        return btn

    def _apply_mode_btn_style(self, btn: QPushButton, active: bool):
        if active:
            btn.setStyleSheet(
                f"QPushButton {{ background: {theme.ACCENT}; color: white;"
                f" border: none; border-radius: 0px; font-weight: 600; font-size: 13px; }}"
                f"QPushButton:hover {{ background: {theme.ACCENT_DIM}; }}"
            )
        else:
            btn.setStyleSheet(
                f"QPushButton {{ background: transparent; color: {theme.TEXT_MUTED};"
                f" border: 1.5px solid {theme.DIVIDER}; border-radius: 0px; font-size: 13px; }}"
                f"QPushButton:hover {{ color: {theme.TEXT}; border-color: {theme.TEXT_MUTED}; }}"
            )

    def _build_operator_form(self) -> QWidget:
        w = QWidget()
        w.setStyleSheet("background: transparent;")
        layout = QVBoxLayout(w)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(theme.GAP_FIELD)

        lbl_login = QLabel("ЛОГИН")
        lbl_login.setStyleSheet(theme.label_style())
        self._op_login_input = QLineEdit()
        self._op_login_input.setPlaceholderText("Логин оператора")
        self._op_login_input.setText(str(self.config.get("last_operator_username") or ""))

        lbl_pass = QLabel("ПАРОЛЬ")
        lbl_pass.setStyleSheet(theme.label_style())
        self._op_pass_input = QLineEdit()
        self._op_pass_input.setEchoMode(QLineEdit.EchoMode.Password)
        self._op_pass_input.setPlaceholderText("············")
        self._op_pass_input.returnPressed.connect(self._handle_operator_login)

        # Статус терминала (мелкий текст)
        self._op_state_label = QLabel("")
        self._op_state_label.setStyleSheet(theme.muted_style(11))
        self._op_state_label.setWordWrap(True)

        self._op_login_btn = QPushButton("Войти")
        self._op_login_btn.setProperty("class", "primary")
        self._op_login_btn.setFixedHeight(theme.BUTTON_H)
        self._op_login_btn.clicked.connect(self._handle_operator_login)
        self._op_login_btn.setSizePolicy(
            QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed
        )

        layout.addWidget(lbl_login)
        layout.addWidget(self._op_login_input)
        layout.addWidget(lbl_pass)
        layout.addWidget(self._op_pass_input)
        layout.addWidget(self._op_state_label)
        layout.addWidget(self._op_login_btn)
        return w

    def _build_admin_form(self) -> QWidget:
        w = QWidget()
        w.setStyleSheet("background: transparent;")
        layout = QVBoxLayout(w)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(theme.GAP_FIELD)

        lbl_email = QLabel("EMAIL")
        lbl_email.setStyleSheet(theme.label_style())
        self._admin_email_input = QLineEdit()
        self._admin_email_input.setPlaceholderText("admin@ordaops.kz")

        lbl_pass = QLabel("ПАРОЛЬ")
        lbl_pass.setStyleSheet(theme.label_style())
        self._admin_pass_input = QLineEdit()
        self._admin_pass_input.setEchoMode(QLineEdit.EchoMode.Password)
        self._admin_pass_input.setPlaceholderText("············")
        self._admin_pass_input.returnPressed.connect(self._handle_admin_login)

        hint = QLabel(
            "Режим для привязки терминала, настройки каталога и просмотра отчётов."
        )
        hint.setWordWrap(True)
        hint.setStyleSheet(theme.muted_style(11))

        self._admin_login_btn = QPushButton("Войти как Super Admin")
        self._admin_login_btn.setProperty("class", "primary")
        self._admin_login_btn.setFixedHeight(theme.BUTTON_H)
        self._admin_login_btn.clicked.connect(self._handle_admin_login)
        self._admin_login_btn.setSizePolicy(
            QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed
        )

        layout.addWidget(lbl_email)
        layout.addWidget(self._admin_email_input)
        layout.addWidget(lbl_pass)
        layout.addWidget(self._admin_pass_input)
        layout.addWidget(hint)
        layout.addWidget(self._admin_login_btn)
        return w

    def _build_workspace_view(self) -> QWidget:
        wrapper = QWidget()
        root = QVBoxLayout(wrapper)
        root.setContentsMargins(theme.PADDING_OUTER, theme.PADDING_CARD, theme.PADDING_OUTER, theme.PADDING_CARD)
        root.setSpacing(theme.GAP_SECTION)

        self._session_bar = self._build_session_bar()
        root.addWidget(self._session_bar)

        self.tabs = QTabWidget()
        self.tabs.setDocumentMode(True)
        self.tabs.setStyleSheet(f"""
            QTabWidget::pane {{
                border: none;
                background: {theme.BG};
            }}
            QTabBar::tab {{
                background: transparent;
                color: {theme.TEXT_MUTED};
                font-size: {theme.FONT_VALUE}px;
                font-weight: 600;
                padding: 10px 20px;
                border: none;
                border-bottom: 2px solid transparent;
                margin-right: 4px;
            }}
            QTabBar::tab:selected {{
                color: {theme.ACCENT};
                border-bottom: 2px solid {theme.ACCENT};
            }}
            QTabBar::tab:hover {{
                color: {theme.TEXT};
            }}
        """)
        root.addWidget(self.tabs, 1)

        return wrapper

    def _build_session_bar(self) -> QWidget:
        bar = QFrame()
        bar.setStyleSheet(
            f"QFrame {{ background: {theme.CARD}; border: 1px solid {theme.DIVIDER};"
            f" border-radius: {theme.RADIUS_CARD}px; }}"
        )

        layout = QHBoxLayout(bar)
        layout.setContentsMargins(theme.PADDING_CARD, 10, theme.PADDING_CARD, 10)
        layout.setSpacing(16)

        self._session_operator_lbl = QLabel("—")
        self._session_operator_lbl.setStyleSheet(
            f"font-size: 14px; font-weight: 600; color: {theme.TEXT}; background: transparent;"
        )
        layout.addWidget(self._session_operator_lbl)

        v_div = _Divider(Qt.Orientation.Vertical)
        v_div.setFixedHeight(20)
        layout.addWidget(v_div)

        self._session_company_lbl = QLabel("")
        self._session_company_lbl.setStyleSheet(theme.muted_style(13))
        layout.addWidget(self._session_company_lbl, 1)

        self._queue_pill = StatusPill("Синхронизировано", theme.SUCCESS)
        layout.addWidget(self._queue_pill)

        self._sync_btn = QPushButton("Синхронизировать")
        self._sync_btn.setProperty("class", "ghost")
        self._sync_btn.setFixedHeight(36)
        self._sync_btn.clicked.connect(self.flush_queues)
        layout.addWidget(self._sync_btn)

        return bar

    def _build_status_bar(self):
        sb = QStatusBar()
        sb.setSizeGripEnabled(False)
        self.setStatusBar(sb)

        self._sb_connection = QLabel()
        self._sb_connection.setStyleSheet(f"font-size: 12px; padding: 2px 8px;")
        sb.addWidget(self._sb_connection)

        self._sb_queue_count = QLabel("Очередь: 0")
        self._sb_queue_count.setStyleSheet(theme.muted_style(12))

        self._sb_version = QLabel(f"v{self.app_version}")
        self._sb_version.setStyleSheet(theme.muted_style(12))

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

        self._apply_mode_btn_style(self._op_tab_btn, not is_admin)
        self._apply_mode_btn_style(self._admin_tab_btn, is_admin)

        op_ready = self.bootstrap_data is not None
        self._op_login_btn.setEnabled(op_ready)
        self._op_login_input.setEnabled(op_ready)
        self._op_pass_input.setEnabled(op_ready)

        if op_ready:
            company = (self.bootstrap_data or {}).get("company") or {}
            device = (self.bootstrap_data or {}).get("device") or {}
            self._op_state_label.setText(
                f"Терминал: {company.get('name', '—')} — {device.get('name', '—')}"
            )
            self._op_state_label.setStyleSheet(
                f"font-size: 11px; color: {theme.SUCCESS}; background: transparent;"
            )
        else:
            self._op_state_label.setText(
                "Терминал не настроен. Войдите как Super Admin."
            )
            self._op_state_label.setStyleSheet(theme.muted_style(11))

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
            text = f"{company.get('name', '—')} — {device.get('name', '—')}"
            self._login_point_text.setText(text)
            self._login_point_text.setStyleSheet(
                f"font-size: 12px; color: {theme.SUCCESS}; background: transparent;"
            )
            self._header_point_pill.setText(company.get("name", "—"))
            self._header_point_pill.set_variant("success")
        elif token:
            self._login_point_text.setText("Нет связи с сервером")
            self._login_point_text.setStyleSheet(
                f"font-size: 12px; color: {theme.WARNING}; background: transparent;"
            )
            self._header_point_pill.setText("Офлайн")
            self._header_point_pill.set_variant("warning")
        else:
            self._login_point_text.setText("Терминал не привязан")
            self._login_point_text.setStyleSheet(theme.muted_style(12))
            self._header_point_pill.setText("Не подключено")
            self._header_point_pill.set_variant("default")

        self._refresh_auth_mode_ui()

    def _update_status_bar(self):
        if self.bootstrap_data:
            self._sb_connection.setText("Подключено")
            self._sb_connection.setStyleSheet(
                f"font-size: 12px; color: {theme.SUCCESS}; padding: 2px 8px;"
            )
        else:
            token = str(self.config.get("device_token") or "").strip()
            if token:
                self._sb_connection.setText("Офлайн")
                self._sb_connection.setStyleSheet(
                    f"font-size: 12px; color: {theme.WARNING}; padding: 2px 8px;"
                )
            else:
                self._sb_connection.setText("Нет токена")
                self._sb_connection.setStyleSheet(
                    f"font-size: 12px; color: {theme.ERROR}; padding: 2px 8px;"
                )

        total = self.queue.count_shifts() + self.queue.count_debt_actions()
        if total > 0:
            self._sb_queue_count.setText(f"В очереди: {total}")
            self._sb_queue_count.setStyleSheet(
                f"font-size: 12px; color: {theme.WARNING}; margin-right: 16px;"
            )
        else:
            self._sb_queue_count.setText("Очередь чиста")
            self._sb_queue_count.setStyleSheet(theme.muted_style(12))

    # ────────────────────────────────────────
    # LOGIN HANDLERS
    # ────────────────────────────────────────
    def set_login_error(self, message: str | None):
        text = (message or "").strip()
        self._login_error_label.setText(text)
        self._login_error_label.setVisible(bool(text))

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
        self._header_mode_pill.show()

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

        if self.current_admin:
            self.admin_tab = AdminTerminalTab(self)
            self.tabs.addTab(self.admin_tab, "Терминал")

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

        if self.current_admin:
            self.settings_tab = SettingsTab(self)
            self.tabs.addTab(self.settings_tab, "Настройки")

        if self.tabs.count() == 0:
            self.tabs.addTab(
                EmptyTab("Терминал не настроен. Войдите как super-admin и привяжите точку."),
                "Инфо",
            )

        # ── Session bar update ──
        company_name = company.get("name", "—")
        mode = device.get("point_mode", "—")

        if self.current_admin:
            self._session_operator_lbl.setText(
                f"Super Admin — {self.current_admin.get('email', '—')}"
            )
            self._session_company_lbl.setText(f"{company_name} — {mode}")
            self._header_mode_pill.setText("SUPER ADMIN")
            self._header_mode_pill.set_variant("accent")

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
            self._session_operator_lbl.setText(f"{name} — @{username}")
            self._session_company_lbl.setText(f"{company_name} — {mode}")
            self._header_mode_pill.setText(role.upper())
            self._header_mode_pill.set_variant("success")

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
            self._queue_pill.setText(f"В очереди: {total}")
            self._queue_pill._set_color(theme.WARNING)
        else:
            self._queue_pill.setText("Синхронизировано")
            self._queue_pill._set_color(theme.SUCCESS)

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
                self.statusBar().showMessage(f"Отправлено {total_sent} записей", 4000)
            else:
                QMessageBox.warning(
                    self,
                    "Синхронизация",
                    f"Отправлено: {total_sent}\nОшибок: {total_failed} (повтор при следующей синхронизации)",
                )

    def _auto_sync_queues(self):
        if self.api and (self.current_operator or self.current_admin):
            total = self.queue.count_shifts() + self.queue.count_debt_actions()
            if total > 0:
                self.flush_queues(silent=True)

    # ────────────────────────────────────────
    # STATE PERSISTENCE
    # ────────────────────────────────────────
    def build_workspace_for_role(self):
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
