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

import theme
from api import PointApiClient
from config import load_config, save_config
from window import PointMainWindow

APP_VERSION = "2.0.0"
APP_NAME = "Orda Control Point"
APP_SUBTITLE = "Программа управления точкой"
SERVER_URL = "https://ordaops.kz"


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
        self.setStyleSheet(f"QWidget {{ background: {theme.CARD}; }}")

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
        mark.setStyleSheet(f"font-size: 28px; color: {theme.ACCENT}; font-weight: 300;")

        name = QLabel(APP_NAME)
        name.setStyleSheet(
            f"font-size: 22px; font-weight: 700; color: {theme.TEXT}; letter-spacing: -0.3px;"
        )

        logo_row.addWidget(mark)
        logo_row.addWidget(name)
        root.addLayout(logo_row)

        root.addSpacing(6)

        subtitle = QLabel(APP_SUBTITLE)
        subtitle.setAlignment(Qt.AlignmentFlag.AlignCenter)
        subtitle.setStyleSheet(theme.muted_style(13))
        root.addWidget(subtitle)

        root.addSpacing(32)

        self.progress_bar = QProgressBar()
        self.progress_bar.setRange(0, 100)
        self.progress_bar.setValue(0)
        self.progress_bar.setTextVisible(False)
        self.progress_bar.setFixedHeight(3)
        self.progress_bar.setStyleSheet(f"""
            QProgressBar {{
                background: {theme.DIVIDER};
                border: none;
                border-radius: 2px;
            }}
            QProgressBar::chunk {{
                background: {theme.ACCENT};
                border-radius: 2px;
            }}
        """)
        root.addWidget(self.progress_bar)

        root.addSpacing(12)

        self.status_label = QLabel("Загрузка...")
        self.status_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.status_label.setStyleSheet(theme.muted_style(12))
        root.addWidget(self.status_label)

        root.addStretch()

        version_label = QLabel(f"v{APP_VERSION}")
        version_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        version_label.setStyleSheet(theme.muted_style(11))
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
            f"font-size: 18px; font-weight: 700; color: {theme.TEXT};"
        )
        root.addWidget(title)

        hint = QLabel(
            "Введите Device Token, выданный в разделе «Точки и устройства» на ordaops.kz."
        )
        hint.setWordWrap(True)
        hint.setStyleSheet(theme.muted_style(13))
        root.addWidget(hint)

        # Token field
        token_lbl = QLabel("DEVICE TOKEN")
        token_lbl.setStyleSheet(theme.label_style())
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
        self.status_lbl.setStyleSheet(theme.muted_style(12))
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
            self.status_lbl.setStyleSheet(f"font-size: 12px; color: {theme.SUCCESS};")
            self.status_lbl.setText(f"Подключено: {company} — {device}")
            self.save_btn.setEnabled(True)
        except Exception as e:
            self.status_lbl.setStyleSheet(f"font-size: 12px; color: {theme.ERROR};")
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
    app.setStyleSheet(theme.APP_STYLE)

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
