"""
Orda Control Point v2.0
Main window: login screen + workspace with tabs
"""
from __future__ import annotations

from PyQt6.QtCore import Qt, QTimer
from PyQt6.QtGui import QColor
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
# UI COMPONENTS
# ──────────────────────────────────────────────

_PILL_STYLES = {
    "success": ("rgba(63,185,80,0.12)", "#3FB950", "rgba(63,185,80,0.35)"),
    "warning": ("rgba(210,153,34,0.12)", "#D29922", "rgba(210,153,34,0.35)"),
    "error":   ("rgba(248,81,73,0.12)",  "#F85149", "rgba(248,81,73,0.35)"),
    "info":    ("rgba(43,127,245,0.12)", "#2B7FF5", "rgba(43,127,245,0.35)"),
    "default": ("#21262D",              "#8B949E", "#30363D"),
}


def _pill(text: str, variant: str = "default") -> QLabel:
    lbl = QLabel(text)
    bg, fg, border = _PILL_STYLES.get(variant, _PILL_STYLES["default"])
    lbl.setStyleSheet(
        f"background: {bg}; color: {fg}; border: 1px solid {border}; "
        "border-radius: 10px; padding: 3px 10px; font-size: 12px; font-weight: 600;"
    )
    return lbl


class ModernPill(QLabel):
    def __init__(self, text: str, variant: str = "default"):
        super().__init__(text)
        bg, fg, border = _PILL_STYLES.get(variant, _PILL_STYLES["default"])
        self.setStyleSheet(
            f"background: {bg}; color: {fg}; border: 1px solid {border}; "
            "border-radius: 10px; padding: 3px 10px; font-size: 12px; font-weight: 600;"
        )

    def set_variant(self, variant: str):
        bg, fg, border = _PILL_STYLES.get(variant, _PILL_STYLES["default"])
        self.setStyleSheet(
            f"background: {bg}; color: {fg}; border: 1px solid {border}; "
            "border-radius: 10px; padding: 3px 10px; font-size: 12px; font-weight: 600;"
        )


class Card(QFrame):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setStyleSheet(
            "QFrame { background: #161B22; border: 1px solid #30363D; border-radius: 8px; }"
        )


# Keep alias for compatibility
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
        self.setStyleSheet("border: none; background: #30363D;")


ModernDivider = _Divider


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
        label.setStyleSheet("font-size: 14px; color: #8B949E; padding: 12px 30px;")

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
        
        # Главный контейнер с отступами
        root = QVBoxLayout(container)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)

        # Верхняя панель
        self._header = self._build_header()
        root.addWidget(self._header)
        root.addWidget(ModernDivider())

        # Основной стек: логин | рабочая область
        self._stack = QStackedWidget()
        root.addWidget(self._stack, 1)

        self._login_view = self._build_login_view()
        self._workspace_view = self._build_workspace_view()
        self._stack.addWidget(self._login_view)
        self._stack.addWidget(self._workspace_view)
        self._stack.setCurrentWidget(self._login_view)

    def _build_header(self) -> QWidget:
        """Современная шапка с логотипом и статусами"""
        bar = QWidget()
        bar.setFixedHeight(64)
        bar.setStyleSheet("""
            QWidget {
                background: rgba(11, 18, 30, 0.95);
                border-bottom: 1px solid #21262D;
            }
        """)
        
        layout = QHBoxLayout(bar)
        layout.setContentsMargins(24, 0, 24, 0)
        layout.setSpacing(16)

        # Логотип с градиентом
        logo_container = QHBoxLayout()
        logo_container.setSpacing(8)
        
        logo_mark = QLabel("◈")
        logo_mark.setStyleSheet("""
            font-size: 24px;
            color: #2B7FF5;
            font-weight: 300;
        """)
        
        logo_name = QLabel("Orda Control Point")
        logo_name.setStyleSheet("""
            font-size: 18px;
            font-weight: 700;
            color: #E6EDF3;
            letter-spacing: 0.3px;
        """)
        
        logo_container.addWidget(logo_mark)
        logo_container.addWidget(logo_name)
        layout.addLayout(logo_container)

        layout.addSpacing(24)

        # Статус точки
        self._header_point_pill = ModernPill("Не подключено", "default")
        layout.addWidget(self._header_point_pill)

        layout.addStretch(1)

        # Режим (оператор/admin)
        self._header_mode_pill = ModernPill("", "info")
        self._header_mode_pill.hide()
        layout.addWidget(self._header_mode_pill)

        layout.addSpacing(12)

        # Кнопка выхода
        self._header_logout_btn = QPushButton("Выйти")
        self._header_logout_btn.setProperty("class", "ghost")
        self._header_logout_btn.setFixedSize(90, 36)
        self._header_logout_btn.clicked.connect(self.logout)
        self._header_logout_btn.hide()
        layout.addWidget(self._header_logout_btn)

        return bar

    def _build_login_view(self) -> QWidget:
        """Красивый экран входа с центровкой"""
        outer = QWidget()
        outer_layout = QVBoxLayout(outer)
        outer_layout.setAlignment(Qt.AlignmentFlag.AlignCenter)
        outer_layout.setContentsMargins(0, 0, 0, 0)

        # Основная карточка
        card = GlassCard()
        card.setFixedWidth(480)
        
        card_layout = QVBoxLayout(card)
        card_layout.setContentsMargins(40, 36, 40, 36)
        card_layout.setSpacing(20)

        # Заголовок
        title = QLabel("Вход в систему")
        title.setStyleSheet("""
            font-size: 28px;
            font-weight: 700;
            color: #E6EDF3;
            letter-spacing: -0.3px;
        """)
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        card_layout.addWidget(title)

        # Статус точки
        self._login_point_card = QFrame()
        self._login_point_card.setStyleSheet("""
            QFrame {
                background: #161B22;
                border: 1px solid #30363D;
                border-radius: 16px;
            }
        """)
        
        point_layout = QHBoxLayout(self._login_point_card)
        point_layout.setContentsMargins(16, 12, 16, 12)
        
        self._login_point_icon = QLabel("●")
        self._login_point_icon.setStyleSheet("font-size: 14px; color: #F85149;")
        
        self._login_point_text = QLabel("Терминал не привязан")
        self._login_point_text.setProperty("class", "muted")
        self._login_point_text.setStyleSheet("font-size: 14px;")
        
        point_layout.addWidget(self._login_point_icon)
        point_layout.addWidget(self._login_point_text, 1)
        card_layout.addWidget(self._login_point_card)

        card_layout.addSpacing(8)

        # Переключатель режимов
        mode_selector = QFrame()
        mode_selector.setStyleSheet("""
            QFrame {
                background: #161B22;
                border: 1px solid #21262D;
                border-radius: 40px;
                padding: 4px;
            }
        """)
        
        mode_layout = QHBoxLayout(mode_selector)
        mode_layout.setContentsMargins(4, 4, 4, 4)
        mode_layout.setSpacing(4)

        self._op_tab_btn = self._create_mode_button("👤 Оператор", True)
        self._op_tab_btn.clicked.connect(lambda: self.set_auth_mode("operator"))
        
        self._admin_tab_btn = self._create_mode_button("🔑 Super Admin", False)
        self._admin_tab_btn.clicked.connect(lambda: self.set_auth_mode("admin"))

        mode_layout.addWidget(self._op_tab_btn)
        mode_layout.addWidget(self._admin_tab_btn)
        card_layout.addWidget(mode_selector)

        # Стек форм
        self._auth_form_stack = QStackedWidget()
        self._auth_form_stack.addWidget(self._build_operator_form())
        self._auth_form_stack.addWidget(self._build_admin_form())
        card_layout.addWidget(self._auth_form_stack)

        # Сообщение об ошибке
        self._login_error = QFrame()
        self._login_error.setStyleSheet("""
            QFrame {
                background: rgba(239, 68, 68, 0.1);
                border: 1px solid rgba(239, 68, 68, 0.3);
                border-radius: 12px;
                padding: 12px;
            }
        """)
        self._login_error.hide()
        
        error_layout = QHBoxLayout(self._login_error)
        error_layout.setContentsMargins(12, 8, 12, 8)
        
        error_icon = QLabel("⚠️")
        error_icon.setStyleSheet("font-size: 16px;")
        
        self._login_error_label = QLabel("")
        self._login_error_label.setStyleSheet("color: #F85149; font-size: 13px;")
        self._login_error_label.setWordWrap(True)
        
        error_layout.addWidget(error_icon)
        error_layout.addWidget(self._login_error_label, 1)
        
        card_layout.addWidget(self._login_error)

        outer_layout.addWidget(card)
        
        self._refresh_auth_mode_ui()
        return outer

    def _create_mode_button(self, text: str, active: bool) -> QPushButton:
        """Кнопка переключения режима"""
        btn = QPushButton(text)
        btn.setCursor(Qt.CursorShape.PointingHandCursor)
        btn.setFixedHeight(44)
        
        if active:
            btn.setStyleSheet("""
                QPushButton {
                    background: #2B7FF5;
                    color: white;
                    border: none;
                    border-radius: 40px;
                    font-weight: 600;
                    font-size: 14px;
                }
                QPushButton:hover {
                    background: #2563EB;
                }
            """)
        else:
            btn.setStyleSheet("""
                QPushButton {
                    background: transparent;
                    color: #8B949E;
                    border: none;
                    border-radius: 40px;
                    font-size: 14px;
                }
                QPushButton:hover {
                    color: #E6EDF3;
                    background: rgba(59, 130, 246, 0.1);
                }
            """)
        
        return btn

    def _build_operator_form(self) -> QWidget:
        """Форма входа оператора"""
        w = QWidget()
        layout = QVBoxLayout(w)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(16)

        # Поле логина
        login_container = QVBoxLayout()
        login_container.setSpacing(6)
        
        login_label = QLabel("Логин")
        login_label.setProperty("class", "accent")
        login_label.setStyleSheet("font-size: 13px; font-weight: 600;")
        
        self._op_login_input = QLineEdit()
        self._op_login_input.setPlaceholderText("Введите логин оператора")
        self._op_login_input.setText(str(self.config.get("last_operator_username") or ""))
        
        login_container.addWidget(login_label)
        login_container.addWidget(self._op_login_input)
        layout.addLayout(login_container)

        # Поле пароля
        pass_container = QVBoxLayout()
        pass_container.setSpacing(6)
        
        pass_label = QLabel("Пароль")
        pass_label.setProperty("class", "accent")
        pass_label.setStyleSheet("font-size: 13px; font-weight: 600;")
        
        self._op_pass_input = QLineEdit()
        self._op_pass_input.setEchoMode(QLineEdit.EchoMode.Password)
        self._op_pass_input.setPlaceholderText("············")
        self._op_pass_input.returnPressed.connect(self._handle_operator_login)
        
        pass_container.addWidget(pass_label)
        pass_container.addWidget(self._op_pass_input)
        layout.addLayout(pass_container)

        # Статус терминала
        self._op_state_container = QFrame()
        self._op_state_container.setStyleSheet("""
            QFrame {
                background: rgba(63,185,80,0.06);
                border: 1px solid rgba(63,185,80,0.25);
                border-radius: 10px;
                padding: 10px;
            }
        """)
        
        state_layout = QHBoxLayout(self._op_state_container)
        state_layout.setContentsMargins(12, 8, 12, 8)
        
        state_icon = QLabel("ℹ️")
        state_icon.setStyleSheet("font-size: 14px;")
        
        self._op_state_label = QLabel("")
        self._op_state_label.setWordWrap(True)
        self._op_state_label.setStyleSheet("color: #3FB950; font-size: 12px;")
        
        state_layout.addWidget(state_icon)
        state_layout.addWidget(self._op_state_label, 1)
        
        layout.addWidget(self._op_state_container)

        # Кнопка входа
        self._op_login_btn = QPushButton("Войти в смену")
        self._op_login_btn.setProperty("class", "primary")
        self._op_login_btn.setFixedHeight(48)
        self._op_login_btn.clicked.connect(self._handle_operator_login)
        layout.addWidget(self._op_login_btn)

        return w

    def _build_admin_form(self) -> QWidget:
        """Форма входа администратора"""
        w = QWidget()
        layout = QVBoxLayout(w)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(16)

        # Поле email
        email_container = QVBoxLayout()
        email_container.setSpacing(6)
        
        email_label = QLabel("Email")
        email_label.setProperty("class", "accent")
        email_label.setStyleSheet("font-size: 13px; font-weight: 600;")
        
        self._admin_email_input = QLineEdit()
        self._admin_email_input.setPlaceholderText("admin@ordaops.kz")
        
        email_container.addWidget(email_label)
        email_container.addWidget(self._admin_email_input)
        layout.addLayout(email_container)

        # Поле пароля
        pass_container = QVBoxLayout()
        pass_container.setSpacing(6)
        
        pass_label = QLabel("Пароль")
        pass_label.setProperty("class", "accent")
        pass_label.setStyleSheet("font-size: 13px; font-weight: 600;")
        
        self._admin_pass_input = QLineEdit()
        self._admin_pass_input.setEchoMode(QLineEdit.EchoMode.Password)
        self._admin_pass_input.setPlaceholderText("············")
        self._admin_pass_input.returnPressed.connect(self._handle_admin_login)
        
        pass_container.addWidget(pass_label)
        pass_container.addWidget(self._admin_pass_input)
        layout.addLayout(pass_container)

        # Подсказка
        hint = QFrame()
        hint.setStyleSheet("""
            QFrame {
                background: rgba(43,127,245,0.06);
                border: 1px solid rgba(43,127,245,0.25);
                border-radius: 10px;
                padding: 12px;
            }
        """)
        
        hint_layout = QHBoxLayout(hint)
        hint_layout.setContentsMargins(12, 8, 12, 8)
        
        hint_icon = QLabel("🔐")
        hint_icon.setStyleSheet("font-size: 16px;")
        
        hint_text = QLabel(
            "Режим для привязки терминала, настройки каталога "
            "и просмотра отчётов. Оператор этот экран не видит."
        )
        hint_text.setWordWrap(True)
        hint_text.setStyleSheet("color: #8B949E; font-size: 12px; line-height: 1.5;")
        
        hint_layout.addWidget(hint_icon)
        hint_layout.addWidget(hint_text, 1)
        
        layout.addWidget(hint)

        # Кнопка входа
        self._admin_login_btn = QPushButton("Войти как Super Admin")
        self._admin_login_btn.setProperty("class", "primary")
        self._admin_login_btn.setFixedHeight(48)
        self._admin_login_btn.clicked.connect(self._handle_admin_login)
        layout.addWidget(self._admin_login_btn)

        return w

    def _build_workspace_view(self) -> QWidget:
        """Рабочая область с табами"""
        wrapper = QWidget()
        root = QVBoxLayout(wrapper)
        root.setContentsMargins(20, 16, 20, 16)
        root.setSpacing(16)

        # Информационная панель сессии
        self._session_bar = self._build_session_bar()
        root.addWidget(self._session_bar)

        # Табы
        self.tabs = QTabWidget()
        self.tabs.setDocumentMode(True)
        self.tabs.setStyleSheet("""
            QTabWidget::tab-bar {
                alignment: left;
            }
        """)
        root.addWidget(self.tabs, 1)

        return wrapper

    def _build_session_bar(self) -> QWidget:
        """Красивая панель с информацией о сессии"""
        bar = QFrame()
        bar.setStyleSheet("""
            QFrame {
                background: #161B22;
                border: 1px solid #21262D;
                border-radius: 16px;
            }
        """)
        
        layout = QHBoxLayout(bar)
        layout.setContentsMargins(20, 12, 20, 12)
        layout.setSpacing(16)

        # Информация об операторе
        operator_container = QHBoxLayout()
        operator_container.setSpacing(8)
        
        operator_icon = QLabel("👤")
        operator_icon.setStyleSheet("font-size: 18px;")
        
        self._session_operator_lbl = QLabel("—")
        self._session_operator_lbl.setStyleSheet("""
            font-size: 15px;
            font-weight: 600;
            color: #E6EDF3;
        """)
        
        operator_container.addWidget(operator_icon)
        operator_container.addWidget(self._session_operator_lbl)
        layout.addLayout(operator_container)

        # Вертикальный разделитель
        v_divider = ModernDivider(Qt.Orientation.Vertical)
        layout.addWidget(v_divider)

        # Информация о компании
        company_container = QHBoxLayout()
        company_container.setSpacing(8)
        
        company_icon = QLabel("🏢")
        company_icon.setStyleSheet("font-size: 18px;")
        
        self._session_company_lbl = QLabel("")
        self._session_company_lbl.setProperty("class", "muted")
        self._session_company_lbl.setStyleSheet("font-size: 14px;")
        
        company_container.addWidget(company_icon)
        company_container.addWidget(self._session_company_lbl, 1)
        layout.addLayout(company_container)

        layout.addStretch(1)

        # Статус очереди
        self._queue_container = QHBoxLayout()
        self._queue_container.setSpacing(12)
        
        queue_icon = QLabel("📦")
        queue_icon.setStyleSheet("font-size: 16px;")
        
        self._queue_pill = ModernPill("Синхронизировано", "success")
        
        self._queue_container.addWidget(queue_icon)
        self._queue_container.addWidget(self._queue_pill)
        layout.addLayout(self._queue_container)

        # Кнопка синхронизации
        self._sync_btn = QPushButton("⟳ Синхронизировать")
        self._sync_btn.setProperty("class", "ghost")
        self._sync_btn.setFixedHeight(36)
        self._sync_btn.clicked.connect(self.flush_queues)
        layout.addWidget(self._sync_btn)

        return bar

    def _build_status_bar(self):
        """Нижняя статусная строка"""
        sb = QStatusBar()
        sb.setSizeGripEnabled(False)
        self.setStatusBar(sb)

        # Левый угол - статус подключения
        self._sb_connection = QLabel()
        self._sb_connection.setStyleSheet("""
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 12px;
        """)
        sb.addWidget(self._sb_connection)

        # Правый угол - очередь и версия
        self._sb_queue_count = QLabel("Очередь: 0")
        self._sb_queue_count.setProperty("class", "muted")
        self._sb_queue_count.setStyleSheet("font-size: 12px; margin-right: 16px;")
        
        self._sb_version = QLabel(f"v{self.app_version}")
        self._sb_version.setProperty("class", "muted")
        self._sb_version.setStyleSheet("font-size: 12px;")
        
        sb.addPermanentWidget(self._sb_queue_count)
        sb.addPermanentWidget(self._sb_version)

    # ────────────────────────────────────────
    # AUTH MODE
    # ────────────────────────────────────────
    def set_auth_mode(self, mode: str):
        """Переключение режима авторизации"""
        self.auth_mode = "admin" if mode == "admin" else "operator"
        self._refresh_auth_mode_ui()

    def _refresh_auth_mode_ui(self):
        """Обновление UI режима авторизации"""
        is_admin = self.auth_mode == "admin"
        self._auth_form_stack.setCurrentIndex(1 if is_admin else 0)
        
        # Обновление стилей кнопок
        for btn, active in [(self._op_tab_btn, not is_admin), 
                           (self._admin_tab_btn, is_admin)]:
            if active:
                btn.setStyleSheet("""
                    QPushButton {
                        background: #2B7FF5;
                        color: white;
                        border: none;
                        border-radius: 40px;
                        font-weight: 600;
                        font-size: 14px;
                    }
                    QPushButton:hover {
                        background: #2563EB;
                    }
                """)
            else:
                btn.setStyleSheet("""
                    QPushButton {
                        background: transparent;
                        color: #8B949E;
                        border: none;
                        border-radius: 40px;
                        font-size: 14px;
                    }
                    QPushButton:hover {
                        color: #E6EDF3;
                        background: rgba(59, 130, 246, 0.1);
                    }
                """)

        # Обновление состояния формы оператора
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
            self._op_state_container.setStyleSheet("""
                QFrame {
                    background: rgba(63,185,80,0.06);
                    border: 1px solid rgba(63,185,80,0.25);
                    border-radius: 10px;
                    padding: 10px;
                }
            """)
        else:
            self._op_state_label.setText(
                "Терминал не настроен. Войдите как Super Admin и привяжите точку."
            )
            self._op_state_container.setStyleSheet("""
                QFrame {
                    background: rgba(245, 158, 11, 0.05);
                    border: 1px solid rgba(245, 158, 11, 0.2);
                    border-radius: 10px;
                    padding: 10px;
                }
            """)

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
        """Обновление баннера на экране входа"""
        company = (self.bootstrap_data or {}).get("company") or {}
        device = (self.bootstrap_data or {}).get("device") or {}
        token = str(self.config.get("device_token") or "").strip()

        if company:
            self._login_point_icon.setStyleSheet("font-size: 14px; color: #3FB950;")
            self._login_point_text.setText(
                f"{company.get('name', '—')} • {device.get('name', '—')}"
            )
            self._login_point_text.setStyleSheet("color: #3FB950; font-size: 14px;")
            
            self._header_point_pill.setText(company.get('name', '—'))
            self._header_point_pill.setStyleSheet("""
                background: rgba(16, 185, 129, 0.1);
                color: #3FB950;
                border: 1px solid rgba(16, 185, 129, 0.3);
                border-radius: 20px;
                padding: 4px 14px;
                font-size: 12px;
                font-weight: 600;
            """)
            
        elif token:
            self._login_point_icon.setStyleSheet("font-size: 14px; color: #F59E0B;")
            self._login_point_text.setText("Токен сохранён, нет связи с сервером")
            self._login_point_text.setStyleSheet("color: #F59E0B; font-size: 14px;")
            
            self._header_point_pill.setText("Офлайн")
            self._header_point_pill.setStyleSheet("""
                background: rgba(245, 158, 11, 0.1);
                color: #F59E0B;
                border: 1px solid rgba(245, 158, 11, 0.3);
                border-radius: 20px;
                padding: 4px 14px;
                font-size: 12px;
                font-weight: 600;
            """)
        else:
            self._login_point_icon.setStyleSheet("font-size: 14px; color: #F85149;")
            self._login_point_text.setText("Терминал не привязан")
            self._login_point_text.setStyleSheet("color: #8B949E; font-size: 14px;")
            
            self._header_point_pill.setText("Не подключено")
            self._header_point_pill.setStyleSheet("""
                background: #21262D;
                color: #8B949E;
                border: 1px solid #30363D;
                border-radius: 20px;
                padding: 4px 14px;
                font-size: 12px;
                font-weight: 600;
            """)

        self._refresh_auth_mode_ui()

    def _update_status_bar(self):
        """Обновление статусной строки"""
        if self.bootstrap_data:
            self._sb_connection.setText("● Подключено")
            self._sb_connection.setStyleSheet("""
                background: rgba(16, 185, 129, 0.1);
                color: #3FB950;
                padding: 2px 8px;
                border-radius: 12px;
                font-size: 12px;
            """)
        else:
            token = str(self.config.get("device_token") or "").strip()
            if token:
                self._sb_connection.setText("● Офлайн")
                self._sb_connection.setStyleSheet("""
                    background: rgba(245, 158, 11, 0.1);
                    color: #F59E0B;
                    padding: 2px 8px;
                    border-radius: 12px;
                    font-size: 12px;
                """)
            else:
                self._sb_connection.setText("● Нет токена")
                self._sb_connection.setStyleSheet("""
                    background: rgba(239, 68, 68, 0.1);
                    color: #F85149;
                    padding: 2px 8px;
                    border-radius: 12px;
                    font-size: 12px;
                """)

        total = self.queue.count_shifts() + self.queue.count_debt_actions()
        if total > 0:
            self._sb_queue_count.setText(f"В очереди: {total}")
            self._sb_queue_count.setStyleSheet("color: #F59E0B; font-size: 12px;")
        else:
            self._sb_queue_count.setText("Очередь чиста")
            self._sb_queue_count.setStyleSheet("color: #6B7B93; font-size: 12px;")

    # ────────────────────────────────────────
    # LOGIN HANDLERS
    # ────────────────────────────────────────
    def set_login_error(self, message: str | None):
        """Отображение ошибки входа"""
        text = (message or "").strip()
        self._login_error_label.setText(text)
        self._login_error.setVisible(bool(text))

    def _handle_operator_login(self):
        """Обработка входа оператора"""
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
        """Обработка входа администратора"""
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
        """Открытие рабочей области"""
        self._build_workspace_tabs()
        self._stack.setCurrentWidget(self._workspace_view)
        self._header_logout_btn.show()
        self._header_mode_pill.show()

    def _build_workspace_tabs(self):
        """Построение табов рабочей области"""
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
            self.tabs.addTab(self.admin_tab, "⚙️ Терминал")

        # ── Shift report ──
        if self.bootstrap_data and flags.get("shift_report") is not False:
            self.shift_tab = ShiftReportTab(self)
            self.tabs.addTab(self.shift_tab, "📋 Смена")

        # ── Debts / scanner (debt_report flag) ──
        if self.bootstrap_data and flags.get("debt_report") is True:
            self.scanner_tab = ScannerTab(self)
            self.tabs.addTab(self.scanner_tab, "🛒 Сканер")
            self.debt_tab = DebtTab(self)
            self.tabs.addTab(self.debt_tab, "📝 Долги")
            if self.current_admin:
                self.products_tab = ProductsTab(self)
                self.tabs.addTab(self.products_tab, "📦 Товары")

        # ── Reports (admin only) ──
        if self.bootstrap_data and self.current_admin:
            self.reports_tab = ReportsTab(self)
            self.tabs.addTab(self.reports_tab, "📊 Отчёты")

        # ── Settings (admin only) ──
        if self.current_admin:
            self.settings_tab = SettingsTab(self)
            self.tabs.addTab(self.settings_tab, "⚙️ Настройки")

        # ── Nothing available ──
        if self.tabs.count() == 0:
            self.tabs.addTab(
                EmptyTab("Терминал не настроен. Войдите как super-admin и привяжите точку."),
                "ℹ️ Инфо",
            )

        # ── Update session bar ──
        company_name = company.get("name", "—")
        mode = device.get("point_mode", "—")

        if self.current_admin:
            self._session_operator_lbl.setText(
                f"Super Admin • {self.current_admin.get('email', '—')}"
            )
            self._session_company_lbl.setText(f"{company_name} • {mode}")
            self._header_mode_pill.setText("SUPER ADMIN")
            self._header_mode_pill.setStyleSheet("""
                background: rgba(139, 92, 246, 0.1);
                color: #8B5CF6;
                border: 1px solid rgba(139, 92, 246, 0.3);
                border-radius: 20px;
                padding: 4px 14px;
                font-size: 11px;
                font-weight: 700;
                letter-spacing: 0.5px;
            """)
            
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
            self._session_operator_lbl.setText(f"{name} • @{username}")
            self._session_company_lbl.setText(f"{company_name} • {mode}")
            self._header_mode_pill.setText(role.upper())
            self._header_mode_pill.setStyleSheet("""
                background: rgba(16, 185, 129, 0.1);
                color: #3FB950;
                border: 1px solid rgba(16, 185, 129, 0.3);
                border-radius: 20px;
                padding: 4px 14px;
                font-size: 11px;
                font-weight: 700;
                letter-spacing: 0.5px;
            """)
            
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
        """Выход из системы"""
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
        """Обновление индикатора очереди"""
        shifts = self.queue.count_shifts()
        debts = self.queue.count_debt_actions()
        total = shifts + debts
        
        if total > 0:
            self._queue_pill.setText(f"В очереди: {total}")
            self._queue_pill.setStyleSheet("""
                background: rgba(245, 158, 11, 0.1);
                color: #F59E0B;
                border: 1px solid rgba(245, 158, 11, 0.3);
                border-radius: 20px;
                padding: 4px 14px;
                font-size: 12px;
                font-weight: 600;
            """)
        else:
            self._queue_pill.setText("Синхронизировано")
            self._queue_pill.setStyleSheet("""
                background: rgba(16, 185, 129, 0.1);
                color: #3FB950;
                border: 1px solid rgba(16, 185, 129, 0.3);
                border-radius: 20px;
                padding: 4px 14px;
                font-size: 12px;
                font-weight: 600;
            """)
        
        self._update_status_bar()

    def flush_queues(self, silent: bool = False):
        """Синхронизация очередей"""
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
        """Автоматическая синхронизация в фоне"""
        if self.api and (self.current_operator or self.current_admin):
            total = self.queue.count_shifts() + self.queue.count_debt_actions()
            if total > 0:
                self.flush_queues(silent=True)

    # ────────────────────────────────────────
    # STATE PERSISTENCE
    # ────────────────────────────────────────
    def build_workspace_for_role(self):
        """Перестройка рабочей области после смены роли"""
        self._build_workspace_tabs()

    def save_config(self):
        """Сохранение конфигурации"""
        save_config(self.config)

    def save_all_state(self):
        """Сохранение всех черновиков"""
        if self.shift_tab:
            self.shift_tab.save_draft()
        if self.debt_tab:
            self.debt_tab.save_draft()
        if self.scanner_tab:
            self.scanner_tab.save_draft()