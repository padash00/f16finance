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
APP_SUBTITLE = "Программа управления точкой"
SERVER_URL = "https://ordaops.kz"


# ──────────────────────────────────────────────
# GLOBAL STYLESHEET  (clean dark, GitHub-inspired)
# ──────────────────────────────────────────────
APP_STYLESHEET = """
/* ─── BASE ─── */
QWidget {
    background: #0D1117;
    color: #E6EDF3;
    font-family: "Segoe UI", "Inter", sans-serif;
    font-size: 13px;
    font-weight: 400;
}

QMainWindow, QDialog {
    background: #0D1117;
}

QLabel {
    color: #E6EDF3;
    background: transparent;
}

QLabel[class="muted"] {
    color: #8B949E;
    font-size: 12px;
}

QLabel[class="accent"] {
    color: #2B7FF5;
    font-weight: 600;
}

QLabel[class="success"] { color: #3FB950; }
QLabel[class="warning"] { color: #D29922; }
QLabel[class="danger"]  { color: #F85149; }

/* ─── INPUTS ─── */
QLineEdit, QComboBox, QSpinBox, QDateEdit, QPlainTextEdit, QTextEdit {
    background: #161B22;
    color: #E6EDF3;
    border: 1px solid #30363D;
    border-radius: 6px;
    padding: 8px 12px;
    font-size: 13px;
    selection-background-color: #2B7FF5;
    selection-color: #ffffff;
}

QLineEdit:hover, QComboBox:hover, QSpinBox:hover,
QDateEdit:hover, QPlainTextEdit:hover, QTextEdit:hover {
    border-color: #484F58;
}

QLineEdit:focus, QComboBox:focus, QSpinBox:focus,
QDateEdit:focus, QPlainTextEdit:focus, QTextEdit:focus {
    border-color: #2B7FF5;
    outline: none;
}

QComboBox::drop-down {
    border: none;
    width: 28px;
}

QComboBox::down-arrow {
    width: 12px;
    height: 12px;
}

QComboBox QAbstractItemView {
    background: #161B22;
    border: 1px solid #30363D;
    border-radius: 6px;
    selection-background-color: #21262D;
    color: #E6EDF3;
    padding: 4px;
}

/* ─── BUTTONS ─── */
QPushButton {
    background: #21262D;
    color: #E6EDF3;
    border: 1px solid #30363D;
    border-radius: 6px;
    padding: 7px 16px;
    font-weight: 500;
    font-size: 13px;
    min-height: 28px;
}

QPushButton:hover {
    background: #30363D;
    border-color: #484F58;
}

QPushButton:pressed {
    background: #161B22;
}

QPushButton:disabled {
    background: #161B22;
    color: #484F58;
    border-color: #21262D;
}

QPushButton[class="primary"] {
    background: #238636;
    color: #ffffff;
    border-color: #2EA043;
    font-weight: 600;
}

QPushButton[class="primary"]:hover {
    background: #2EA043;
    border-color: #3FB950;
}

QPushButton[class="primary"]:pressed {
    background: #1A7431;
}

QPushButton[class="blue"] {
    background: #1F4B8E;
    color: #ffffff;
    border-color: #2B7FF5;
    font-weight: 600;
}

QPushButton[class="blue"]:hover {
    background: #2B7FF5;
    border-color: #388BFD;
}

QPushButton[class="danger"] {
    background: #6E1A1A;
    color: #F85149;
    border-color: #F85149;
}

QPushButton[class="danger"]:hover {
    background: #8A2020;
}

QPushButton[class="ghost"] {
    background: transparent;
    color: #8B949E;
    border-color: #30363D;
}

QPushButton[class="ghost"]:hover {
    background: #21262D;
    color: #E6EDF3;
    border-color: #484F58;
}

/* ─── TABS ─── */
QTabWidget::pane {
    border: 1px solid #30363D;
    border-radius: 6px;
    background: #0D1117;
    top: -1px;
}

QTabBar::tab {
    background: transparent;
    color: #8B949E;
    border: 1px solid transparent;
    border-bottom: none;
    border-top-left-radius: 6px;
    border-top-right-radius: 6px;
    padding: 8px 18px;
    margin-right: 2px;
    font-weight: 500;
    font-size: 13px;
}

QTabBar::tab:selected {
    background: #0D1117;
    color: #E6EDF3;
    border-color: #30363D;
    border-bottom: 1px solid #0D1117;
    margin-bottom: -1px;
    font-weight: 600;
}

QTabBar::tab:hover:!selected {
    background: #161B22;
    color: #C9D1D9;
}

/* ─── GROUP BOX ─── */
QGroupBox {
    border: 1px solid #30363D;
    border-radius: 8px;
    margin-top: 14px;
    font-weight: 600;
    color: #8B949E;
    background: transparent;
    padding-top: 8px;
    font-size: 12px;
}

QGroupBox::title {
    subcontrol-origin: margin;
    left: 12px;
    padding: 0 6px;
    background: #0D1117;
}

/* ─── TABLES ─── */
QTableWidget {
    background: #0D1117;
    border: 1px solid #30363D;
    border-radius: 6px;
    gridline-color: #21262D;
    selection-background-color: #1C2128;
    selection-color: #E6EDF3;
    alternate-background-color: #161B22;
}

QTableWidget::item {
    padding: 8px 10px;
    border-bottom: 1px solid #21262D;
    color: #E6EDF3;
}

QTableWidget::item:selected {
    background: #1C2128;
    color: #E6EDF3;
}

QHeaderView::section {
    background: #161B22;
    color: #8B949E;
    border: none;
    border-bottom: 1px solid #30363D;
    border-right: 1px solid #21262D;
    padding: 8px 10px;
    font-weight: 600;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

/* ─── SCROLLBARS ─── */
QScrollBar:vertical {
    background: transparent;
    width: 6px;
    margin: 0;
}

QScrollBar::handle:vertical {
    background: #30363D;
    min-height: 32px;
    border-radius: 3px;
}

QScrollBar::handle:vertical:hover {
    background: #484F58;
}

QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {
    height: 0;
}

QScrollBar:horizontal {
    background: transparent;
    height: 6px;
    margin: 0;
}

QScrollBar::handle:horizontal {
    background: #30363D;
    min-width: 32px;
    border-radius: 3px;
}

QScrollBar::handle:horizontal:hover {
    background: #484F58;
}

QScrollBar::add-line:horizontal, QScrollBar::sub-line:horizontal {
    width: 0;
}

/* ─── PROGRESS BAR ─── */
QProgressBar {
    background: #21262D;
    border: 1px solid #30363D;
    border-radius: 4px;
    text-align: center;
    color: #8B949E;
    font-size: 11px;
    height: 6px;
}

QProgressBar::chunk {
    background: #2B7FF5;
    border-radius: 4px;
}

/* ─── STATUS BAR ─── */
QStatusBar {
    background: #161B22;
    border-top: 1px solid #30363D;
    color: #8B949E;
    font-size: 12px;
    padding: 2px 12px;
}

QStatusBar QLabel {
    color: #8B949E;
}

/* ─── SPLITTER ─── */
QSplitter::handle {
    background: #30363D;
}

QSplitter::handle:horizontal {
    width: 1px;
}

QSplitter::handle:vertical {
    height: 1px;
}

/* ─── MESSAGE BOX ─── */
QMessageBox {
    background: #161B22;
}

QMessageBox QLabel {
    color: #E6EDF3;
    font-size: 13px;
}
"""


# ──────────────────────────────────────────────
# SPLASH SCREEN  (minimal & clean)
# ──────────────────────────────────────────────
class SplashWindow(QWidget):
    def __init__(self):
        super().__init__()
        self.setWindowFlags(
            Qt.WindowType.FramelessWindowHint |
            Qt.WindowType.WindowStaysOnTopHint |
            Qt.WindowType.Tool
        )
        self.setFixedSize(480, 280)
        self.setStyleSheet("QWidget { background: #161B22; }")

        # Centre on screen
        screen = QApplication.primaryScreen()
        if screen:
            sg = screen.availableGeometry()
            self.move(
                sg.center().x() - self.width() // 2,
                sg.center().y() - self.height() // 2,
            )

        root = QVBoxLayout(self)
        root.setContentsMargins(48, 40, 48, 40)
        root.setSpacing(0)

        # Logo mark + name
        logo_row = QHBoxLayout()
        logo_row.setSpacing(10)
        logo_row.setAlignment(Qt.AlignmentFlag.AlignCenter)

        mark = QLabel("◈")
        mark.setStyleSheet("font-size: 28px; color: #2B7FF5; font-weight: 300;")

        name = QLabel(APP_NAME)
        name.setStyleSheet(
            "font-size: 22px; font-weight: 700; color: #E6EDF3; letter-spacing: -0.3px;"
        )

        logo_row.addWidget(mark)
        logo_row.addWidget(name)
        root.addLayout(logo_row)

        root.addSpacing(6)

        subtitle = QLabel(APP_SUBTITLE)
        subtitle.setAlignment(Qt.AlignmentFlag.AlignCenter)
        subtitle.setStyleSheet("font-size: 13px; color: #6E7681;")
        root.addWidget(subtitle)

        root.addSpacing(32)

        self.progress_bar = QProgressBar()
        self.progress_bar.setRange(0, 100)
        self.progress_bar.setValue(0)
        self.progress_bar.setTextVisible(False)
        self.progress_bar.setFixedHeight(3)
        self.progress_bar.setStyleSheet("""
            QProgressBar {
                background: #21262D;
                border: none;
                border-radius: 2px;
            }
            QProgressBar::chunk {
                background: #2B7FF5;
                border-radius: 2px;
            }
        """)
        root.addWidget(self.progress_bar)

        root.addSpacing(12)

        self.status_label = QLabel("Загрузка...")
        self.status_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.status_label.setStyleSheet("font-size: 12px; color: #6E7681;")
        root.addWidget(self.status_label)

        root.addStretch()

        version_label = QLabel(f"v{APP_VERSION}")
        version_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        version_label.setStyleSheet("font-size: 11px; color: #484F58;")
        root.addWidget(version_label)

    def set_status(self, text: str):
        self.status_label.setText(text)
        QApplication.processEvents()

    def set_progress(self, value: int):
        self.progress_bar.setValue(value)
        QApplication.processEvents()


# ──────────────────────────────────────────────
# SETUP WIZARD  (first run — enter device token)
# ──────────────────────────────────────────────
class SetupWizardDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Настройка — Orda Control Point")
        self.setFixedSize(520, 340)
        self.setWindowFlags(
            self.windowFlags() & ~Qt.WindowType.WindowContextHelpButtonHint
        )
        self._bootstrap_data = None
        self._init_ui()

    def _init_ui(self):
        root = QVBoxLayout(self)
        root.setContentsMargins(36, 32, 36, 32)
        root.setSpacing(20)

        # Header
        title = QLabel("Первичная настройка терминала")
        title.setStyleSheet(
            "font-size: 18px; font-weight: 700; color: #E6EDF3;"
        )
        root.addWidget(title)

        hint = QLabel(
            "Введите Device Token, выданный в разделе «Точки и устройства» на ordaops.kz."
        )
        hint.setWordWrap(True)
        hint.setStyleSheet("font-size: 13px; color: #8B949E; line-height: 1.5;")
        root.addWidget(hint)

        # Token field
        token_lbl = QLabel("Device Token")
        token_lbl.setStyleSheet("font-size: 12px; font-weight: 600; color: #8B949E;")
        root.addWidget(token_lbl)

        self.token_input = QLineEdit()
        self.token_input.setPlaceholderText("xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx")
        self.token_input.setStyleSheet(
            "font-family: 'Consolas', monospace; font-size: 13px; padding: 10px 12px;"
        )
        self.token_input.textChanged.connect(self._on_token_changed)
        root.addWidget(self.token_input)

        # Status
        self.status_lbl = QLabel("")
        self.status_lbl.setStyleSheet("font-size: 12px; color: #8B949E;")
        root.addWidget(self.status_lbl)

        root.addStretch()

        # Buttons
        btn_row = QHBoxLayout()
        btn_row.setSpacing(8)

        self.test_btn = QPushButton("Проверить подключение")
        self.test_btn.setProperty("class", "ghost")
        self.test_btn.clicked.connect(self._test_connection)

        self.save_btn = QPushButton("Сохранить и продолжить")
        self.save_btn.setProperty("class", "primary")
        self.save_btn.setEnabled(False)
        self.save_btn.clicked.connect(self.accept)

        btn_row.addWidget(self.test_btn)
        btn_row.addStretch()
        btn_row.addWidget(self.save_btn)
        root.addLayout(btn_row)

    def _on_token_changed(self):
        token = self.token_input.text().strip()
        has_token = len(token) >= 10
        self.save_btn.setEnabled(has_token)
        self.test_btn.setEnabled(has_token)
        if self.status_lbl.text() not in ("", "Введите токен"):
            self.status_lbl.setText("")

    def _test_connection(self):
        token = self.token_input.text().strip()
        if not token:
            self.status_lbl.setText("Введите токен")
            return

        self.test_btn.setText("Проверка...")
        self.test_btn.setEnabled(False)
        QApplication.processEvents()

        try:
            api = PointApiClient(SERVER_URL, token)
            data = api.bootstrap()
            company = (data.get("company") or {}).get("name", "—")
            device = (data.get("device") or {}).get("name", "—")
            self._bootstrap_data = data
            self.status_lbl.setStyleSheet("font-size: 12px; color: #3FB950;")
            self.status_lbl.setText(f"✓ Подключено: {company} • {device}")
            self.save_btn.setEnabled(True)
        except Exception as e:
            self.status_lbl.setStyleSheet("font-size: 12px; color: #F85149;")
            self.status_lbl.setText(f"Ошибка: {e}")

        self.test_btn.setText("Проверить подключение")
        self.test_btn.setEnabled(True)

    @property
    def token(self) -> str:
        return self.token_input.text().strip()


# ──────────────────────────────────────────────
# ENTRY POINT
# ──────────────────────────────────────────────
def main():
    app = QApplication(sys.argv)
    app.setApplicationName(APP_NAME)
    app.setApplicationVersion(APP_VERSION)
    app.setStyle("Fusion")
    app.setStyleSheet(APP_STYLESHEET)

    # Splash
    splash = SplashWindow()
    splash.show()

    splash.set_status("Загрузка конфигурации...")
    splash.set_progress(15)

    config = load_config()
    device_token = (config.get("device_token") or "").strip()

    splash.set_status("Проверка подключения...")
    splash.set_progress(40)

    if device_token:
        try:
            api = PointApiClient(SERVER_URL, device_token)
            bootstrap_data = api.bootstrap()
            company_name = (bootstrap_data.get("company") or {}).get("name", "")
            splash.set_status(f"Подключено: {company_name}")
        except Exception:
            splash.set_status("Офлайн режим")
    else:
        splash.set_status("Требуется настройка")

    splash.set_progress(80)
    time.sleep(0.4)
    splash.set_progress(100)
    time.sleep(0.2)
    splash.close()

    # First-run wizard
    if not device_token:
        wizard = SetupWizardDialog()
        if wizard.exec() != QDialog.DialogCode.Accepted:
            sys.exit(0)
        config["device_token"] = wizard.token
        save_config(config)

    # Main window
    window = PointMainWindow(app_version=APP_VERSION)
    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
