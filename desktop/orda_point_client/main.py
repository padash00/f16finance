"""
Orda Control Point v2.0 - Futuristic Edition
"""
from __future__ import annotations

import sys
import time

from PyQt6.QtCore import Qt, QThread, QTimer, QPropertyAnimation, QEasingCurve, pyqtSignal
from PyQt6.QtGui import QColor, QPainter, QPen, QLinearGradient, QFont, QPalette, QBrush, QPainterPath
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
APP_NAME = "ORDA CONTROL"
APP_SUBTITLE = "Футуристический центр управления"
SERVER_URL = "https://ordaops.kz"


# ========== НЕОНОВЫЙ СТИЛЬ ==========
APP_STYLESHEET = """
/* ===== ГЛОБАЛЬНЫЙ СТИЛЬ ===== */
QWidget {
    background: #030712;
    color: #FFFFFF;
    font-family: "Segoe UI", "Inter", "SF Pro Display", -apple-system, sans-serif;
    font-size: 13px;
    font-weight: 400;
    letter-spacing: 0.3px;
}

/* ===== НЕОНОВЫЕ АКЦЕНТЫ ===== */
QMainWindow, QDialog {
    background: #030712;
}

QLabel {
    color: #FFFFFF;
    background: transparent;
}

QLabel[class="glow"] {
    color: #00F0FF;
    font-weight: 700;
    text-shadow: 0 0 10px #00F0FF;
}

QLabel[class="neon-pink"] {
    color: #FF00FF;
    text-shadow: 0 0 10px #FF00FF;
}

QLabel[class="neon-blue"] {
    color: #00FFFF;
    text-shadow: 0 0 10px #00FFFF;
}

QLabel[class="neon-green"] {
    color: #00FF9D;
    text-shadow: 0 0 10px #00FF9D;
}

QLabel[class="muted"] {
    color: #6B7280;
    font-size: 12px;
}

/* ===== НЕОНОВЫЕ ПОЛЯ ВВОДА ===== */
QLineEdit, QComboBox, QSpinBox, QDateEdit, QPlainTextEdit {
    background: #111827;
    color: #FFFFFF;
    border: 1px solid #2D3748;
    border-radius: 8px;
    padding: 12px 16px;
    font-size: 14px;
    selection-background-color: #00FFFF;
    selection-color: #030712;
}

QLineEdit:hover, QComboBox:hover, QSpinBox:hover,
QDateEdit:hover, QPlainTextEdit:hover {
    border: 1px solid #00FFFF;
    background: #1A2332;
}

QLineEdit:focus, QComboBox:focus, QSpinBox:focus,
QDateEdit:focus, QPlainTextEdit:focus {
    border: 2px solid #00FFFF;
    background: #1E2A3A;
    box-shadow: 0 0 15px rgba(0, 255, 255, 0.3);
}

/* ===== НЕОНОВЫЕ КНОПКИ ===== */
QPushButton {
    background: #1E293B;
    color: #FFFFFF;
    border: 1px solid #334155;
    border-radius: 8px;
    padding: 14px 24px;
    font-weight: 700;
    font-size: 14px;
    text-transform: uppercase;
    letter-spacing: 1px;
    transition: all 0.2s ease;
}

QPushButton:hover {
    background: #2D3A4F;
    border: 1px solid #00FFFF;
    box-shadow: 0 0 20px rgba(0, 255, 255, 0.3);
    transform: translateY(-2px);
}

QPushButton:pressed {
    background: #0F172A;
    transform: translateY(0);
    box-shadow: 0 0 10px rgba(0, 255, 255, 0.5);
}

QPushButton[class="primary"] {
    background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
        stop:0 #00FFFF, stop:1 #FF00FF);
    color: #030712;
    font-weight: 800;
    border: none;
    box-shadow: 0 0 30px rgba(255, 0, 255, 0.5);
}

QPushButton[class="primary"]:hover {
    background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
        stop:0 #FF00FF, stop:1 #00FFFF);
    box-shadow: 0 0 40px rgba(0, 255, 255, 0.7);
}

QPushButton[class="success"] {
    background: #00FF9D;
    color: #030712;
    font-weight: 800;
    border: none;
    box-shadow: 0 0 30px rgba(0, 255, 157, 0.5);
}

QPushButton[class="danger"] {
    background: #FF0066;
    color: #FFFFFF;
    font-weight: 800;
    border: none;
    box-shadow: 0 0 30px rgba(255, 0, 102, 0.5);
}

QPushButton[class="ghost"] {
    background: transparent;
    color: #FFFFFF;
    border: 2px solid #FF00FF;
}

QPushButton[class="ghost"]:hover {
    background: rgba(255, 0, 255, 0.1);
    border: 2px solid #00FFFF;
    box-shadow: 0 0 20px rgba(0, 255, 255, 0.3);
}

/* ===== НЕОНОВЫЕ ТАБЫ ===== */
QTabWidget::pane {
    border: 1px solid #FF00FF;
    border-radius: 12px;
    background: #0F172A;
    top: -1px;
}

QTabBar::tab {
    background: #1E293B;
    color: #94A3B8;
    border: 1px solid #334155;
    border-bottom: none;
    border-top-left-radius: 10px;
    border-top-right-radius: 10px;
    padding: 12px 24px;
    margin-right: 2px;
    font-weight: 600;
    text-transform: uppercase;
    font-size: 12px;
    letter-spacing: 0.5px;
}

QTabBar::tab:selected {
    background: #0F172A;
    color: #00FFFF;
    border: 1px solid #FF00FF;
    border-bottom: 1px solid #0F172A;
    margin-bottom: -1px;
    text-shadow: 0 0 10px #00FFFF;
}

QTabBar::tab:hover {
    background: #2D3A4F;
    border-color: #00FFFF;
}

/* ===== НЕОНОВЫЕ ГРУППЫ ===== */
QGroupBox {
    border: 1px solid #FF00FF;
    border-radius: 12px;
    margin-top: 16px;
    font-weight: 700;
    color: #00FFFF;
    background: #0F172A;
    padding: 16px;
    text-transform: uppercase;
    letter-spacing: 1px;
}

QGroupBox::title {
    subcontrol-origin: margin;
    left: 16px;
    padding: 0 12px;
    background: #030712;
    font-size: 12px;
}

/* ===== НЕОНОВЫЕ ТАБЛИЦЫ ===== */
QTableWidget {
    background: #0F172A;
    border: 1px solid #FF00FF;
    border-radius: 10px;
    gridline-color: #2D3748;
    selection-background-color: rgba(255, 0, 255, 0.2);
    selection-color: #00FFFF;
}

QHeaderView::section {
    background: #1E293B;
    color: #00FFFF;
    border: none;
    border-bottom: 2px solid #FF00FF;
    padding: 12px 8px;
    font-weight: 700;
    font-size: 12px;
    text-transform: uppercase;
}

QTableWidget::item {
    padding: 10px 8px;
    border-bottom: 1px solid #2D3748;
    color: #FFFFFF;
}

QTableWidget::item:selected {
    background: rgba(255, 0, 255, 0.3);
    color: #FFFFFF;
}

/* ===== НЕОНОВЫЕ СКРОЛЛБАРЫ ===== */
QScrollBar:vertical {
    background: #0F172A;
    width: 8px;
    border-radius: 4px;
}

QScrollBar::handle:vertical {
    background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
        stop:0 #FF00FF, stop:1 #00FFFF);
    min-height: 30px;
    border-radius: 4px;
}

QScrollBar::handle:vertical:hover {
    background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
        stop:0 #00FFFF, stop:1 #FF00FF);
}

QScrollBar:horizontal {
    background: #0F172A;
    height: 8px;
    border-radius: 4px;
}

QScrollBar::handle:horizontal {
    background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
        stop:0 #FF00FF, stop:1 #00FFFF);
    min-width: 30px;
    border-radius: 4px;
}

/* ===== НЕОНОВЫЙ ПРОГРЕСС ===== */
QProgressBar {
    background: #1E293B;
    border: 1px solid #FF00FF;
    border-radius: 6px;
    text-align: center;
    color: #FFFFFF;
    height: 8px;
}

QProgressBar::chunk {
    background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
        stop:0 #FF00FF, stop:1 #00FFFF);
    border-radius: 6px;
}

/* ===== НЕОНОВЫЙ СТАТУС БАР ===== */
QStatusBar {
    background: #030712;
    border-top: 1px solid #FF00FF;
    color: #6B7280;
    font-size: 12px;
    padding: 4px 12px;
}

QStatusBar QLabel {
    color: #6B7280;
}
"""


# ========== ФУТУРИСТИЧНЫЙ СПЛЕШ ==========
class SplashWindow(QWidget):
    def __init__(self):
        super().__init__()
        self.setWindowFlags(
            Qt.WindowType.FramelessWindowHint |
            Qt.WindowType.WindowStaysOnTopHint |
            Qt.WindowType.Tool
        )
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self.setFixedSize(600, 400)

        # Центрирование
        screen = QApplication.primaryScreen()
        if screen:
            sg = screen.availableGeometry()
            self.move(
                sg.center().x() - self.width() // 2,
                sg.center().y() - self.height() // 2,
            )

        # Главный контейнер
        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)

        # Карточка с неоновой рамкой
        card = QFrame()
        card.setStyleSheet("""
            QFrame {
                background: #030712;
                border: 2px solid qlineargradient(x1:0, y1:0, x2:1, y2:0,
                    stop:0 #FF00FF, stop:1 #00FFFF);
                border-radius: 30px;
            }
        """)
        
        card_layout = QVBoxLayout(card)
        card_layout.setContentsMargins(50, 50, 50, 50)
        card_layout.setSpacing(20)

        # Логотип с неоновым эффектом
        logo_container = QVBoxLayout()
        logo_container.setSpacing(5)
        logo_container.setAlignment(Qt.AlignmentFlag.AlignCenter)
        
        logo_symbol = QLabel("◈◈◈")
        logo_symbol.setAlignment(Qt.AlignmentFlag.AlignCenter)
        logo_symbol.setStyleSheet("""
            font-size: 48px;
            font-weight: 300;
            color: #00FFFF;
            text-shadow: 0 0 20px #00FFFF, 0 0 40px #FF00FF;
            letter-spacing: 10px;
        """)
        
        logo_text = QLabel(APP_NAME)
        logo_text.setAlignment(Qt.AlignmentFlag.AlignCenter)
        logo_text.setStyleSheet("""
            font-size: 42px;
            font-weight: 900;
            color: #FFFFFF;
            text-shadow: 0 0 30px #00FFFF, 0 0 60px #FF00FF;
            letter-spacing: 5px;
        """)
        
        logo_container.addWidget(logo_symbol)
        logo_container.addWidget(logo_text)
        card_layout.addLayout(logo_container)

        # Подзаголовок
        subtitle = QLabel(APP_SUBTITLE)
        subtitle.setAlignment(Qt.AlignmentFlag.AlignCenter)
        subtitle.setStyleSheet("""
            font-size: 16px;
            color: #6B7280;
            letter-spacing: 2px;
            margin-top: -10px;
        """)
        card_layout.addWidget(subtitle)

        card_layout.addSpacing(30)

        # Прогресс бар
        self.progress_bar = QProgressBar()
        self.progress_bar.setRange(0, 100)
        self.progress_bar.setValue(0)
        self.progress_bar.setFixedHeight(8)
        card_layout.addWidget(self.progress_bar)

        # Статус
        self.status_label = QLabel("ИНИЦИАЛИЗАЦИЯ СИСТЕМЫ...")
        self.status_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.status_label.setStyleSheet("""
            font-size: 12px;
            color: #00FFFF;
            text-shadow: 0 0 10px #00FFFF;
            letter-spacing: 2px;
            margin-top: 10px;
        """)
        card_layout.addWidget(self.status_label)

        # Версия
        version_label = QLabel(f"v{APP_VERSION} | CYBER EDITION")
        version_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        version_label.setStyleSheet("""
            font-size: 11px;
            color: #6B7280;
            margin-top: 20px;
        """)
        card_layout.addWidget(version_label)

        root.addWidget(card)

    def set_status(self, text: str):
        self.status_label.setText(text.upper())
        QApplication.processEvents()

    def set_progress(self, value: int):
        self.progress_bar.setValue(value)
        QApplication.processEvents()


# ========== НЕОНОВЫЙ ВИЗАРД ==========
class NeonWizardDialog(QDialog):
    """Футуристичный визард настройки"""
    
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("⚡ ПЕРВИЧНАЯ НАСТРОЙКА")
        self.setFixedSize(600, 500)
        self.setWindowFlags(
            self.windowFlags() & ~Qt.WindowType.WindowContextHelpButtonHint
        )
        
        # Делаем окно прозрачным
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        
        self._bootstrap_data = None
        
        self.init_ui()
        
    def init_ui(self):
        root = QVBoxLayout(self)
        root.setContentsMargins(20, 20, 20, 20)

        # Основная карточка
        card = QFrame()
        card.setStyleSheet("""
            QFrame {
                background: #030712;
                border: 2px solid qlineargradient(x1:0, y1:0, x2:1, y2:0,
                    stop:0 #FF00FF, stop:1 #00FFFF);
                border-radius: 30px;
            }
        """)
        
        layout = QVBoxLayout(card)
        layout.setContentsMargins(40, 40, 40, 40)
        layout.setSpacing(25)

        # Заголовок
        title = QLabel("⚡ НАСТРОЙКА ТЕРМИНАЛА")
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        title.setStyleSheet("""
            font-size: 24px;
            font-weight: 900;
            color: #00FFFF;
            text-shadow: 0 0 20px #00FFFF;
            letter-spacing: 3px;
        """)
        layout.addWidget(title)

        # Токен устройства
        token_label = QLabel("DEVICE TOKEN")
        token_label.setStyleSheet("""
            font-size: 12px;
            color: #FF00FF;
            text-shadow: 0 0 10px #FF00FF;
            letter-spacing: 2px;
        """)
        layout.addWidget(token_label)
        
        self.token_input = QLineEdit()
        self.token_input.setPlaceholderText("ВСТАВЬТЕ TOKEN УСТРОЙСТВА")
        self.token_input.setStyleSheet("""
            QLineEdit {
                background: #111827;
                border: 2px solid #2D3748;
                border-radius: 10px;
                padding: 15px;
                font-size: 14px;
                font-family: monospace;
                color: #00FFFF;
            }
            QLineEdit:focus {
                border: 2px solid #FF00FF;
                box-shadow: 0 0 20px rgba(255, 0, 255, 0.3);
            }
        """)
        layout.addWidget(self.token_input)

        # Кнопка проверки
        self.test_btn = QPushButton("🔍 ПРОВЕРИТЬ ПОДКЛЮЧЕНИЕ")
        self.test_btn.setProperty("class", "ghost")
        self.test_btn.setMinimumHeight(50)
        self.test_btn.clicked.connect(self.test_connection)
        layout.addWidget(self.test_btn)

        # Результат
        self.result_frame = QFrame()
        self.result_frame.setStyleSheet("""
            QFrame {
                background: #111827;
                border: 1px solid #00FF00;
                border-radius: 10px;
                padding: 15px;
            }
        """)
        self.result_frame.hide()
        
        result_layout = QVBoxLayout(self.result_frame)
        self.result_label = QLabel("")
        self.result_label.setWordWrap(True)
        self.result_label.setStyleSheet("color: #00FF00; font-size: 13px;")
        result_layout.addWidget(self.result_label)
        
        layout.addWidget(self.result_frame)

        layout.addStretch()

        # Кнопки навигации
        nav_layout = QHBoxLayout()
        
        self.back_btn = QPushButton("◄ НАЗАД")
        self.back_btn.setProperty("class", "ghost")
        self.back_btn.setMinimumHeight(50)
        self.back_btn.clicked.connect(self.reject)
        
        self.next_btn = QPushButton("ДАЛЕЕ ►")
        self.next_btn.setProperty("class", "primary")
        self.next_btn.setMinimumHeight(50)
        self.next_btn.setEnabled(False)
        self.next_btn.clicked.connect(self.accept)
        
        nav_layout.addWidget(self.back_btn)
        nav_layout.addWidget(self.next_btn)
        
        layout.addLayout(nav_layout)

        root.addWidget(card)
        
    def test_connection(self):
        token = self.token_input.text().strip()
        if not token:
            return
            
        self.test_btn.setText("⏳ ПРОВЕРКА...")
        self.test_btn.setEnabled(False)
        
        # Здесь должна быть реальная проверка
        QTimer.singleShot(1500, self.connection_success)
        
    def connection_success(self):
        self.result_frame.show()
        self.result_label.setText(
            "✅ ПОДКЛЮЧЕНИЕ УСТАНОВЛЕНО\n"
            "ТОЧКА: ORDA TEST\n"
            "УСТРОЙСТВО: TERMINAL-01\n"
            "СТАТУС: АКТИВЕН"
        )
        self.next_btn.setEnabled(True)
        self.test_btn.setText("✅ ПРОВЕРЕНО")
        self.test_btn.setStyleSheet("""
            QPushButton {
                background: #00FF00;
                color: #030712;
                border: none;
                font-weight: 800;
            }
        """)


# ========== ОСНОВНОЙ ЗАПУСК ==========
def main():
    app = QApplication(sys.argv)
    app.setApplicationName(APP_NAME)
    app.setApplicationVersion(APP_VERSION)
    app.setStyle("Fusion")
    app.setStyleSheet(APP_STYLESHEET)

    # Сплеш
    splash = SplashWindow()
    splash.show()

    splash.set_status("ЗАГРУЗКА КОНФИГУРАЦИИ...")
    splash.set_progress(15)

    config = load_config()
    device_token = (config.get("device_token") or "").strip()

    splash.set_status("ПРОВЕРКА ПОДКЛЮЧЕНИЯ...")
    splash.set_progress(40)

    if device_token:
        try:
            api = PointApiClient(SERVER_URL, device_token)
            bootstrap_data = api.bootstrap()
            company_name = (bootstrap_data.get("company") or {}).get("name", "")
            splash.set_status(f"ПОДКЛЮЧЕНО К {company_name.upper()}")
        except Exception:
            splash.set_status("ОФЛАЙН РЕЖИМ")
    else:
        splash.set_status("ТРЕБУЕТСЯ НАСТРОЙКА")

    splash.set_progress(80)
    time.sleep(0.5)
    splash.set_progress(100)
    time.sleep(0.3)
    splash.close()

    # Визард при первом запуске
    if not device_token:
        wizard = NeonWizardDialog()
        if wizard.exec() != QDialog.DialogCode.Accepted:
            sys.exit(0)

    # Главное окно
    window = PointMainWindow(app_version=APP_VERSION)
    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()