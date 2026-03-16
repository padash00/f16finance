"""
Orda Control Point v2.0
Entry point: splash → setup wizard (first run) → main window
"""
from __future__ import annotations

import sys
import time

from PyQt6.QtCore import Qt, QThread, QTimer, pyqtSignal
from PyQt6.QtGui import QColor, QPainter, QPen
from PyQt6.QtWidgets import (
    QApplication,
    QDialog,
    QFrame,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMessageBox,
    QProgressBar,
    QPushButton,
    QSizePolicy,
    QSpacerItem,
    QStackedWidget,
    QVBoxLayout,
    QWidget,
)

from api import PointApiClient
from config import load_config, save_config
from window import PointMainWindow

APP_VERSION = "2.0.0"
APP_NAME = "Orda Control Point"
APP_SUBTITLE = "Централизованная программа управления точкой"
SERVER_URL = "https://ordaops.kz"


# ──────────────────────────────────────────────
# GLOBAL STYLESHEET
# ──────────────────────────────────────────────
APP_STYLESHEET = """
QWidget {
    background: #07111f;
    color: #e5edf7;
    font-family: "Segoe UI", "Inter", sans-serif;
    font-size: 14px;
}

QMainWindow, QDialog {
    background: #07111f;
}

QLabel {
    color: #e5edf7;
    background: transparent;
}

/* ── Inputs ── */
QLineEdit, QComboBox, QSpinBox, QDateEdit, QPlainTextEdit {
    background: #0d1a2b;
    color: #f8fbff;
    border: 1px solid #1d324b;
    border-radius: 10px;
    padding: 9px 12px;
    selection-background-color: #1a5fa8;
    min-height: 20px;
}

QLineEdit:focus, QComboBox:focus, QSpinBox:focus,
QDateEdit:focus, QPlainTextEdit:focus {
    border: 1.5px solid #4ea4ff;
    background: #0f2133;
}

QLineEdit:disabled, QComboBox:disabled {
    color: #4a6070;
    background: #090f18;
    border-color: #0f1f30;
}

QComboBox::drop-down {
    border: none;
    width: 28px;
}

QComboBox QAbstractItemView {
    background: #0d1a2b;
    border: 1px solid #1d324b;
    border-radius: 8px;
    selection-background-color: #163b5e;
}

/* ── Buttons base ── */
QPushButton {
    background: #0f2338;
    color: #c8ddf0;
    border: 1px solid #1d3a56;
    border-radius: 10px;
    padding: 10px 18px;
    font-weight: 600;
    min-height: 20px;
}

QPushButton:hover {
    background: #163553;
    border-color: #2d6090;
    color: #e8f4ff;
}

QPushButton:pressed {
    background: #0a1e32;
}

QPushButton:disabled {
    color: #4a6070;
    background: #080f1a;
    border-color: #0f1e2e;
}

/* ── Primary button (class="primary") ── */
QPushButton[class="primary"] {
    background: qlineargradient(x1:0, y1:0, x2:0, y2:1,
        stop:0 #2b7ff5, stop:1 #1a5cc2);
    color: #ffffff;
    border: none;
    font-size: 15px;
    font-weight: 700;
    padding: 12px 24px;
}

QPushButton[class="primary"]:hover {
    background: qlineargradient(x1:0, y1:0, x2:0, y2:1,
        stop:0 #4a93ff, stop:1 #2a72e0);
}

QPushButton[class="primary"]:pressed {
    background: #1453b0;
}

QPushButton[class="primary"]:disabled {
    background: #0e2040;
    color: #3d5a7a;
}

/* ── Success button ── */
QPushButton[class="success"] {
    background: qlineargradient(x1:0, y1:0, x2:0, y2:1,
        stop:0 #22c55e, stop:1 #16a34a);
    color: #ffffff;
    border: none;
    font-weight: 700;
}

QPushButton[class="success"]:hover {
    background: qlineargradient(x1:0, y1:0, x2:0, y2:1,
        stop:0 #34d774, stop:1 #22c55e);
}

/* ── Danger button ── */
QPushButton[class="danger"] {
    background: qlineargradient(x1:0, y1:0, x2:0, y2:1,
        stop:0 #ef4444, stop:1 #dc2626);
    color: #ffffff;
    border: none;
    font-weight: 700;
}

QPushButton[class="danger"]:hover {
    background: qlineargradient(x1:0, y1:0, x2:0, y2:1,
        stop:0 #f87171, stop:1 #ef4444);
}

/* ── Ghost button ── */
QPushButton[class="ghost"] {
    background: transparent;
    color: #7a9fc0;
    border: 1px solid #1a3550;
}

QPushButton[class="ghost"]:hover {
    background: #0e2035;
    color: #c0d8f0;
    border-color: #2a567e;
}

/* ── Tabs ── */
QTabWidget::pane {
    border: 1px solid #16304a;
    border-radius: 14px;
    background: #081421;
    top: -1px;
}

QTabBar::tab {
    background: #0b1929;
    color: #8fa6bf;
    border: 1px solid #16304a;
    border-bottom: none;
    border-top-left-radius: 10px;
    border-top-right-radius: 10px;
    padding: 10px 20px;
    margin-right: 3px;
    font-weight: 600;
}

QTabBar::tab:selected {
    background: #102540;
    color: #d8eeff;
    border-color: #2a6090;
}

QTabBar::tab:hover:!selected {
    background: #0d1f32;
    color: #c0d8f0;
}

/* ── GroupBox ── */
QGroupBox {
    border: 1px solid #16304a;
    border-radius: 14px;
    margin-top: 18px;
    font-weight: 700;
    color: #7eb8ff;
    background: #081421;
    padding: 8px;
}

QGroupBox::title {
    subcontrol-origin: margin;
    left: 14px;
    padding: 0 8px;
    background: #07111f;
    font-size: 13px;
}

/* ── Table ── */
QTableWidget {
    background: #081421;
    border: 1px solid #16304a;
    border-radius: 12px;
    gridline-color: #112234;
    selection-background-color: #143355;
}

QHeaderView::section {
    background: #0b1e32;
    color: #7eb8ff;
    border: none;
    border-bottom: 1px solid #16304a;
    padding: 9px 10px;
    font-weight: 700;
    font-size: 13px;
}

QTableWidget::item {
    padding: 6px 8px;
}

QTableWidget::item:selected {
    background: #143355;
    color: #e8f4ff;
}

/* ── Scrollbars ── */
QScrollBar:vertical {
    background: #081421;
    width: 10px;
    border-radius: 5px;
    margin: 0;
}

QScrollBar::handle:vertical {
    background: #1d3c5e;
    min-height: 30px;
    border-radius: 5px;
}

QScrollBar::handle:vertical:hover {
    background: #2a5580;
}

QScrollBar::add-line:vertical,
QScrollBar::sub-line:vertical {
    height: 0;
}

QScrollBar:horizontal {
    background: #081421;
    height: 10px;
    border-radius: 5px;
}

QScrollBar::handle:horizontal {
    background: #1d3c5e;
    min-width: 30px;
    border-radius: 5px;
}

/* ── Progress bar ── */
QProgressBar {
    background: #0d1a2b;
    border: none;
    border-radius: 6px;
    text-align: center;
    color: transparent;
    height: 6px;
}

QProgressBar::chunk {
    background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
        stop:0 #2b7ff5, stop:1 #4ea4ff);
    border-radius: 6px;
}

/* ── Status bar ── */
QStatusBar {
    background: #050d17;
    border-top: 1px solid #0f2035;
    color: #5a7a96;
    font-size: 12px;
    padding: 0 12px;
}

QStatusBar QLabel {
    color: #5a7a96;
    font-size: 12px;
    background: transparent;
}

/* ── Spin box ── */
QSpinBox::up-button, QSpinBox::down-button {
    background: #102238;
    border: none;
    width: 20px;
}

QSpinBox::up-arrow {
    image: none;
    width: 0; height: 0;
    border-left: 4px solid transparent;
    border-right: 4px solid transparent;
    border-bottom: 4px solid #4ea4ff;
}

QSpinBox::down-arrow {
    image: none;
    width: 0; height: 0;
    border-left: 4px solid transparent;
    border-right: 4px solid transparent;
    border-top: 4px solid #4ea4ff;
}

/* ── Date edit ── */
QDateEdit::drop-down {
    border: none;
    width: 28px;
}

QCalendarWidget QAbstractItemView {
    background: #0d1a2b;
    color: #e5edf7;
    selection-background-color: #1a5fa8;
}
"""


# ──────────────────────────────────────────────
# WORKER: Test connection in background
# ──────────────────────────────────────────────
class TestConnectionWorker(QThread):
    success = pyqtSignal(dict)
    failed = pyqtSignal(str)

    def __init__(self, token: str):
        super().__init__()
        self.token = token.strip()

    def run(self):
        try:
            api = PointApiClient(SERVER_URL, self.token)
            data = api.bootstrap()
            self.success.emit(data)
        except Exception as exc:
            self.failed.emit(str(exc))


# ──────────────────────────────────────────────
# SPLASH SCREEN
# ──────────────────────────────────────────────
class SplashWindow(QWidget):
    def __init__(self):
        super().__init__()
        self.setWindowFlags(
            Qt.WindowType.FramelessWindowHint |
            Qt.WindowType.WindowStaysOnTopHint |
            Qt.WindowType.Tool
        )
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self.setFixedSize(480, 300)

        # Center on screen
        screen = QApplication.primaryScreen()
        if screen:
            sg = screen.availableGeometry()
            self.move(
                sg.center().x() - self.width() // 2,
                sg.center().y() - self.height() // 2,
            )

        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)

        card = QFrame()
        card.setStyleSheet(
            "QFrame {"
            "  background: #071929;"
            "  border: 1px solid #1a3a58;"
            "  border-radius: 24px;"
            "}"
        )
        card_layout = QVBoxLayout(card)
        card_layout.setContentsMargins(48, 40, 48, 36)
        card_layout.setSpacing(10)

        # Logo mark
        logo_row = QHBoxLayout()
        logo_mark = QLabel("◈")
        logo_mark.setStyleSheet(
            "font-size: 32px; color: #4ea4ff; background: transparent;"
        )
        logo_text = QLabel(APP_NAME)
        logo_text.setStyleSheet(
            "font-size: 26px; font-weight: 800; color: #f0f8ff; background: transparent; letter-spacing: 1px;"
        )
        logo_row.addWidget(logo_mark)
        logo_row.addSpacing(10)
        logo_row.addWidget(logo_text)
        logo_row.addStretch()
        card_layout.addLayout(logo_row)

        subtitle = QLabel(APP_SUBTITLE)
        subtitle.setStyleSheet(
            "font-size: 13px; color: #5a8aab; background: transparent;"
        )
        card_layout.addWidget(subtitle)

        card_layout.addSpacerItem(QSpacerItem(0, 20))

        self.progress_bar = QProgressBar()
        self.progress_bar.setRange(0, 100)
        self.progress_bar.setValue(0)
        self.progress_bar.setFixedHeight(6)
        card_layout.addWidget(self.progress_bar)

        self.status_label = QLabel("Инициализация...")
        self.status_label.setStyleSheet(
            "font-size: 12px; color: #3d6480; background: transparent; margin-top: 6px;"
        )
        card_layout.addWidget(self.status_label)

        card_layout.addSpacerItem(QSpacerItem(0, 12))

        version_label = QLabel(f"v{APP_VERSION}")
        version_label.setStyleSheet(
            "font-size: 11px; color: #2a4560; background: transparent;"
        )
        card_layout.addWidget(version_label)

        root.addWidget(card)

    def set_status(self, text: str):
        self.status_label.setText(text)
        QApplication.processEvents()

    def set_progress(self, value: int):
        self.progress_bar.setValue(value)
        QApplication.processEvents()


# ──────────────────────────────────────────────
# SETUP WIZARD (first run)
# ──────────────────────────────────────────────
class SetupWizardDialog(QDialog):
    """
    Shown on first launch when device_token is empty.
    Step 1 → Welcome
    Step 2 → Enter token + test connection
    Step 3 → Success
    """

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle(f"{APP_NAME} — Первый запуск")
        self.setFixedSize(520, 460)
        self.setWindowFlags(
            self.windowFlags() & ~Qt.WindowType.WindowContextHelpButtonHint
        )

        self._bootstrap_data: dict | None = None
        self._worker: TestConnectionWorker | None = None

        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)

        # Header accent bar
        accent = QFrame()
        accent.setFixedHeight(4)
        accent.setStyleSheet(
            "background: qlineargradient(x1:0, y1:0, x2:1, y2:0,"
            " stop:0 #2b7ff5, stop:1 #4ea4ff);"
            "border: none;"
        )
        root.addWidget(accent)

        body = QWidget()
        body_layout = QVBoxLayout(body)
        body_layout.setContentsMargins(40, 32, 40, 32)
        body_layout.setSpacing(0)
        root.addWidget(body, 1)

        # Eyebrow
        eyebrow = QLabel("НАСТРОЙКА ТЕРМИНАЛА")
        eyebrow.setStyleSheet(
            "font-size: 11px; font-weight: 700; color: #2b7ff5; "
            "letter-spacing: 2px; background: transparent;"
        )
        body_layout.addWidget(eyebrow)
        body_layout.addSpacing(6)

        self.title_label = QLabel("Добро пожаловать")
        self.title_label.setStyleSheet(
            "font-size: 26px; font-weight: 800; color: #f0f8ff; background: transparent;"
        )
        body_layout.addWidget(self.title_label)
        body_layout.addSpacing(8)

        self.desc_label = QLabel(
            "Orda Control Point — единая программа для управления точкой продаж. "
            "Давайте настроим подключение к серверу."
        )
        self.desc_label.setWordWrap(True)
        self.desc_label.setStyleSheet(
            "font-size: 14px; color: #6a8fa8; background: transparent; line-height: 1.5;"
        )
        body_layout.addWidget(self.desc_label)
        body_layout.addSpacing(28)

        # Pages
        self.pages = QStackedWidget()
        body_layout.addWidget(self.pages, 1)

        self.pages.addWidget(self._build_step1())
        self.pages.addWidget(self._build_step2())
        self.pages.addWidget(self._build_step3())

        body_layout.addSpacing(20)

        # Nav buttons
        nav = QHBoxLayout()
        self.back_btn = QPushButton("← Назад")
        self.back_btn.setProperty("class", "ghost")
        self.back_btn.clicked.connect(self._go_back)
        self.back_btn.hide()

        self.next_btn = QPushButton("Начать →")
        self.next_btn.setProperty("class", "primary")
        self.next_btn.clicked.connect(self._go_next)

        nav.addWidget(self.back_btn)
        nav.addStretch()
        nav.addWidget(self.next_btn)
        body_layout.addLayout(nav)

        self._current_step = 0
        self._update_nav()

    def _build_step1(self) -> QWidget:
        w = QWidget()
        layout = QVBoxLayout(w)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(12)

        info_card = QFrame()
        info_card.setStyleSheet(
            "QFrame { background: #0a1e35; border: 1px solid #16304a; border-radius: 12px; }"
        )
        card_layout = QVBoxLayout(info_card)
        card_layout.setContentsMargins(20, 16, 20, 16)
        card_layout.setSpacing(10)

        for icon, text in [
            ("🔐", "Авторизация через токен устройства — ключи не хранятся в коде"),
            ("🏢", "Данные точки загружаются с сервера централизованно"),
            ("📶", "Офлайн-режим: смены и долги сохраняются локально и синхронизируются"),
            ("🎛", "Рабочие модули автоматически активируются по настройкам точки"),
        ]:
            row = QHBoxLayout()
            icon_lbl = QLabel(icon)
            icon_lbl.setStyleSheet("font-size: 18px; background: transparent;")
            icon_lbl.setFixedWidth(30)
            text_lbl = QLabel(text)
            text_lbl.setWordWrap(True)
            text_lbl.setStyleSheet("font-size: 13px; color: #8ab5d0; background: transparent;")
            row.addWidget(icon_lbl)
            row.addWidget(text_lbl, 1)
            card_layout.addLayout(row)

        layout.addWidget(info_card)
        layout.addStretch()
        return w

    def _build_step2(self) -> QWidget:
        w = QWidget()
        layout = QVBoxLayout(w)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(14)

        server_lbl = QLabel("Сервер")
        server_lbl.setStyleSheet("font-size: 13px; color: #5a8aab; background: transparent; font-weight: 600;")
        layout.addWidget(server_lbl)

        server_field = QLineEdit(SERVER_URL)
        server_field.setReadOnly(True)
        server_field.setStyleSheet(
            "background: #050d17; color: #3a6080; border: 1px solid #0f2035; "
            "border-radius: 10px; padding: 9px 12px;"
        )
        layout.addWidget(server_field)

        token_lbl = QLabel("Токен устройства")
        token_lbl.setStyleSheet("font-size: 13px; color: #5a8aab; background: transparent; font-weight: 600;")
        layout.addWidget(token_lbl)

        self.token_input = QLineEdit()
        self.token_input.setPlaceholderText("Вставьте токен со страницы /point-devices на сайте")
        self.token_input.textChanged.connect(self._on_token_changed)
        layout.addWidget(self.token_input)

        self.test_btn = QPushButton("Проверить подключение")
        self.test_btn.setProperty("class", "ghost")
        self.test_btn.setEnabled(False)
        self.test_btn.clicked.connect(self._test_connection)
        layout.addWidget(self.test_btn)

        self.test_result = QLabel("")
        self.test_result.setWordWrap(True)
        self.test_result.setStyleSheet("font-size: 13px; background: transparent;")
        self.test_result.hide()
        layout.addWidget(self.test_result)

        layout.addStretch()
        return w

    def _build_step3(self) -> QWidget:
        w = QWidget()
        layout = QVBoxLayout(w)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(16)

        success_frame = QFrame()
        success_frame.setStyleSheet(
            "QFrame { background: #071a0e; border: 1px solid #1a4a28; border-radius: 12px; }"
        )
        sf_layout = QVBoxLayout(success_frame)
        sf_layout.setContentsMargins(20, 16, 20, 16)
        sf_layout.setSpacing(6)

        ok_icon = QLabel("✅")
        ok_icon.setStyleSheet("font-size: 32px; background: transparent;")
        ok_icon.setAlignment(Qt.AlignmentFlag.AlignCenter)
        sf_layout.addWidget(ok_icon)

        self.success_title = QLabel("Подключение установлено")
        self.success_title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.success_title.setStyleSheet(
            "font-size: 17px; font-weight: 700; color: #22c55e; background: transparent;"
        )
        sf_layout.addWidget(self.success_title)

        self.success_detail = QLabel("")
        self.success_detail.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.success_detail.setWordWrap(True)
        self.success_detail.setStyleSheet("font-size: 13px; color: #5ab87a; background: transparent;")
        sf_layout.addWidget(self.success_detail)

        layout.addWidget(success_frame)
        layout.addStretch()
        return w

    def _on_token_changed(self, text: str):
        self.test_btn.setEnabled(bool(text.strip()))
        self.test_result.hide()
        self._bootstrap_data = None
        self._update_nav()

    def _test_connection(self):
        token = self.token_input.text().strip()
        if not token:
            return

        self.test_btn.setEnabled(False)
        self.test_btn.setText("Проверяю...")
        self.test_result.hide()
        self._bootstrap_data = None
        self._update_nav()

        self._worker = TestConnectionWorker(token)
        self._worker.success.connect(self._on_connection_success)
        self._worker.failed.connect(self._on_connection_failed)
        self._worker.start()

    def _on_connection_success(self, data: dict):
        self._bootstrap_data = data
        company = (data.get("company") or {}).get("name", "—")
        device = (data.get("device") or {}).get("name", "—")
        flags = (data.get("device") or {}).get("feature_flags") or {}
        modules = []
        if flags.get("shift_report") is not False:
            modules.append("Смены")
        if flags.get("debt_report"):
            modules.append("Долги")

        self.test_result.setText(
            f"✅  Точка: {company}\n"
            f"📟  Устройство: {device}\n"
            f"🎛  Модули: {', '.join(modules) or 'нет'}"
        )
        self.test_result.setStyleSheet(
            "font-size: 13px; color: #22c55e; background: #071a0e; "
            "border: 1px solid #1a4a28; border-radius: 10px; "
            "padding: 10px 14px;"
        )
        self.test_result.show()
        self.test_btn.setText("Проверить подключение")
        self.test_btn.setEnabled(True)
        self._update_nav()

    def _on_connection_failed(self, error: str):
        self._bootstrap_data = None
        self.test_result.setText(f"❌  Ошибка: {error}")
        self.test_result.setStyleSheet(
            "font-size: 13px; color: #f87171; background: #1a0808; "
            "border: 1px solid #4a1515; border-radius: 10px; "
            "padding: 10px 14px;"
        )
        self.test_result.show()
        self.test_btn.setText("Проверить подключение")
        self.test_btn.setEnabled(True)
        self._update_nav()

    def _go_next(self):
        if self._current_step == 0:
            self._current_step = 1
            self.title_label.setText("Введите токен устройства")
            self.desc_label.setText(
                "Скопируйте токен со страницы /point-devices на сайте ordaops.kz "
                "и вставьте в поле ниже."
            )
            self.pages.setCurrentIndex(1)

        elif self._current_step == 1:
            # Save token and proceed
            token = self.token_input.text().strip()
            config = load_config()
            config["device_token"] = token
            save_config(config)

            # Fill step 3 details
            if self._bootstrap_data:
                company = (self._bootstrap_data.get("company") or {}).get("name", "—")
                device_name = (self._bootstrap_data.get("device") or {}).get("name", "—")
                self.success_detail.setText(f"Точка: {company}\nУстройство: {device_name}")
            else:
                self.success_detail.setText("Токен сохранён. Подключение будет проверено при входе.")

            self._current_step = 2
            self.title_label.setText("Готово!")
            self.desc_label.setText("Токен устройства сохранён. Теперь можете войти как оператор.")
            self.pages.setCurrentIndex(2)

        elif self._current_step == 2:
            self.accept()

        self._update_nav()

    def _go_back(self):
        if self._current_step > 0:
            self._current_step -= 1
            self.pages.setCurrentIndex(self._current_step)
            if self._current_step == 0:
                self.title_label.setText("Добро пожаловать")
                self.desc_label.setText(
                    "Orda Control Point — единая программа для управления точкой продаж. "
                    "Давайте настроим подключение к серверу."
                )
            elif self._current_step == 1:
                self.title_label.setText("Введите токен устройства")
                self.desc_label.setText(
                    "Скопируйте токен со страницы /point-devices на сайте ordaops.kz "
                    "и вставьте в поле ниже."
                )
            self._update_nav()

    def _update_nav(self):
        self.back_btn.setVisible(self._current_step > 0)

        if self._current_step == 0:
            self.next_btn.setText("Начать →")
            self.next_btn.setEnabled(True)
        elif self._current_step == 1:
            can_proceed = bool(
                self.token_input.text().strip() and self._bootstrap_data is not None
            )
            self.next_btn.setText("Сохранить и продолжить →")
            self.next_btn.setEnabled(can_proceed)
        elif self._current_step == 2:
            self.next_btn.setText("Открыть программу →")
            self.next_btn.setEnabled(True)


# ──────────────────────────────────────────────
# MAIN
# ──────────────────────────────────────────────
def main():
    app = QApplication(sys.argv)
    app.setApplicationName(APP_NAME)
    app.setApplicationVersion(APP_VERSION)
    app.setStyle("Fusion")
    app.setStyleSheet(APP_STYLESHEET)

    # ── Splash ──
    splash = SplashWindow()
    splash.show()

    splash.set_status("Загрузка конфигурации...")
    splash.set_progress(15)

    config = load_config()
    device_token = (config.get("device_token") or "").strip()

    splash.set_status("Проверка подключения к серверу...")
    splash.set_progress(40)

    bootstrap_data: dict | None = None
    if device_token:
        try:
            api = PointApiClient(SERVER_URL, device_token)
            bootstrap_data = api.bootstrap()
            company_name = (bootstrap_data.get("company") or {}).get("name", "")
            splash.set_status(
                f"Подключено: {company_name}" if company_name else "Подключено"
            )
        except Exception:
            splash.set_status("Нет связи — работаю в офлайн-режиме")

    splash.set_progress(80)
    time.sleep(0.25)
    splash.set_progress(100)
    time.sleep(0.15)
    splash.close()

    # ── Setup wizard on first run ──
    if not device_token:
        wizard = SetupWizardDialog()
        if wizard.exec() != QDialog.DialogCode.Accepted:
            sys.exit(0)

    # ── Main window ──
    window = PointMainWindow(app_version=APP_VERSION)
    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
