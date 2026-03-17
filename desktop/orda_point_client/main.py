"""
Orda Control Point v2.0
Entry point: splash → setup wizard (first run) → main window
"""
from __future__ import annotations

import sys
import time

from PyQt6.QtCore import Qt, QTimer
from PyQt6.QtWidgets import (
    QApplication,
    QDialog,
    QFrame,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QProgressBar,
    QPushButton,
    QVBoxLayout,
    QWidget,
)

from api import PointApiClient
from config import load_config, save_config
from theme import (
    STYLESHEET,
    BG, SURFACE, SURFACE_2, BORDER,
    TEXT, TEXT_MUTED, TEXT_DIM,
    ACCENT, SUCCESS, DANGER,
)
from window import PointMainWindow

APP_VERSION = "2.0.0"
APP_NAME    = "Orda Control Point"
APP_SUBTITLE = "Программа управления точкой"
SERVER_URL  = "https://ordaops.kz"


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
        self.setFixedSize(480, 260)
        self.setStyleSheet(f"QWidget {{ background: {SURFACE}; border: 1px solid {BORDER}; border-radius: 8px; }}")

        screen = QApplication.primaryScreen()
        if screen:
            sg = screen.availableGeometry()
            self.move(
                sg.center().x() - self.width() // 2,
                sg.center().y() - self.height() // 2,
            )

        root = QVBoxLayout(self)
        root.setContentsMargins(48, 40, 48, 36)
        root.setSpacing(0)

        # Logo
        logo_row = QHBoxLayout()
        logo_row.setSpacing(10)
        logo_row.setAlignment(Qt.AlignmentFlag.AlignCenter)

        mark = QLabel("◈")
        mark.setStyleSheet(f"font-size: 26px; color: {ACCENT}; font-weight: 300;")
        name = QLabel(APP_NAME)
        name.setStyleSheet(f"font-size: 21px; font-weight: 700; color: {TEXT};")
        logo_row.addWidget(mark)
        logo_row.addWidget(name)
        root.addLayout(logo_row)

        root.addSpacing(4)
        subtitle = QLabel(APP_SUBTITLE)
        subtitle.setAlignment(Qt.AlignmentFlag.AlignCenter)
        subtitle.setStyleSheet(f"font-size: 12px; color: {TEXT_DIM};")
        root.addWidget(subtitle)

        root.addSpacing(28)

        self.progress_bar = QProgressBar()
        self.progress_bar.setRange(0, 100)
        self.progress_bar.setValue(0)
        self.progress_bar.setTextVisible(False)
        self.progress_bar.setFixedHeight(3)
        self.progress_bar.setStyleSheet(f"""
            QProgressBar {{
                background: {SURFACE_2};
                border: none; border-radius: 2px;
            }}
            QProgressBar::chunk {{
                background: {ACCENT}; border-radius: 2px;
            }}
        """)
        root.addWidget(self.progress_bar)

        root.addSpacing(10)
        self.status_label = QLabel("Загрузка...")
        self.status_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.status_label.setStyleSheet(f"font-size: 12px; color: {TEXT_DIM};")
        root.addWidget(self.status_label)

        root.addStretch()
        version_label = QLabel(f"v{APP_VERSION}")
        version_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        version_label.setStyleSheet(f"font-size: 11px; color: {TEXT_DIM};")
        root.addWidget(version_label)

    def set_status(self, text: str):
        self.status_label.setText(text)
        QApplication.processEvents()

    def set_progress(self, value: int):
        self.progress_bar.setValue(value)
        QApplication.processEvents()


# ──────────────────────────────────────────────
# SETUP WIZARD  (first run)
# ──────────────────────────────────────────────
class SetupWizardDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Настройка — Orda Control Point")
        self.setFixedSize(520, 320)
        self.setWindowFlags(
            self.windowFlags() & ~Qt.WindowType.WindowContextHelpButtonHint
        )
        self._init_ui()

    def _init_ui(self):
        root = QVBoxLayout(self)
        root.setContentsMargins(36, 32, 36, 32)
        root.setSpacing(18)

        title = QLabel("Первичная настройка терминала")
        title.setStyleSheet(f"font-size: 17px; font-weight: 700; color: {TEXT};")
        root.addWidget(title)

        hint = QLabel(
            "Введите Device Token, выданный в разделе «Точки и устройства» на ordaops.kz."
        )
        hint.setWordWrap(True)
        hint.setStyleSheet(f"font-size: 13px; color: {TEXT_MUTED}; line-height: 1.5;")
        root.addWidget(hint)

        token_lbl = QLabel("Device Token")
        token_lbl.setStyleSheet(f"font-size: 12px; font-weight: 600; color: {TEXT_MUTED};")
        root.addWidget(token_lbl)

        self.token_input = QLineEdit()
        self.token_input.setPlaceholderText("xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx")
        self.token_input.setStyleSheet(
            f"font-family: 'Consolas', monospace; font-size: 13px; padding: 10px 12px;"
        )
        self.token_input.textChanged.connect(self._on_token_changed)
        root.addWidget(self.token_input)

        self.status_lbl = QLabel("")
        self.status_lbl.setStyleSheet(f"font-size: 12px; color: {TEXT_MUTED};")
        root.addWidget(self.status_lbl)

        root.addStretch()

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

    def _test_connection(self):
        token = self.token_input.text().strip()
        if not token:
            return

        self.test_btn.setText("Проверка...")
        self.test_btn.setEnabled(False)
        QApplication.processEvents()

        try:
            api = PointApiClient(SERVER_URL, token)
            data = api.bootstrap()
            company = (data.get("company") or {}).get("name", "—")
            device  = (data.get("device") or {}).get("name", "—")
            self.status_lbl.setStyleSheet(f"font-size: 12px; color: {SUCCESS};")
            self.status_lbl.setText(f"✓ Подключено: {company} • {device}")
            self.save_btn.setEnabled(True)
        except Exception as e:
            self.status_lbl.setStyleSheet(f"font-size: 12px; color: {DANGER};")
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
    app.setStyleSheet(STYLESHEET)   # ← всё из theme.py

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

    if not device_token:
        wizard = SetupWizardDialog()
        if wizard.exec() != QDialog.DialogCode.Accepted:
            sys.exit(0)
        config["device_token"] = wizard.token
        save_config(config)

    window = PointMainWindow(app_version=APP_VERSION)
    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
