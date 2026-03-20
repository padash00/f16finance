"""
Modern dialogs for Orda Control Point
"""
from __future__ import annotations

from typing import Optional, Dict, Any
import theme
from PyQt6.QtCore import Qt, QTimer, pyqtSignal, QPropertyAnimation, QEasingCurve
from PyQt6.QtGui import QIcon, QFont, QColor, QPalette, QPixmap, QPainter, QBrush, QLinearGradient
from PyQt6.QtWidgets import (
    QDialog, QFormLayout, QHBoxLayout, QVBoxLayout, QLabel,
    QLineEdit, QPushButton, QFrame,
    QProgressBar, QWidget, QCheckBox
)


# ==================== Базовые компоненты ====================

class ModernDialog(QDialog):
    """
    Базовый класс для всех современных диалогов
    
    Особенности:
    - Единый стиль
    - Анимация появления
    - Тень и градиент
    - Центрирование на родителе
    """
    
    def __init__(self, parent=None, title: str = "", width: int = 480):
        super().__init__(parent)
        self.setWindowTitle(title)
        self.setModal(True)
        self.setFixedWidth(width)
        
        # Убираем стандартный заголовок окна
        self.setWindowFlags(Qt.WindowType.FramelessWindowHint | Qt.WindowType.Dialog)
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        
        # Основной контейнер
        self.container = QFrame(self)
        self.container.setObjectName("dialogContainer")

        # Стиль контейнера
        self.container.setStyleSheet(f"""
            QFrame#dialogContainer {{
                background: {theme.CARD};
                border: 1px solid {theme.DIVIDER};
                border-radius: 24px;
            }}
        """)
        
        # Основной layout контейнера
        self.container_layout = QVBoxLayout(self.container)
        self.container_layout.setContentsMargins(32, 28, 32, 28)
        self.container_layout.setSpacing(20)
        
        # Заголовок
        if title:
            self.title_label = QLabel(title)
            self.title_label.setStyleSheet(f"""
                font-size: 22px;
                font-weight: 700;
                color: {theme.TEXT};
                background: transparent;
                letter-spacing: -0.3px;
            """)
            self.title_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
            self.container_layout.addWidget(self.title_label)
            
            # Разделитель
            separator = QFrame()
            separator.setFrameShape(QFrame.Shape.HLine)
            separator.setStyleSheet(f"""
                border: none;
                background: {theme.DIVIDER};
                max-height: 1px;
            """)
            self.container_layout.addWidget(separator)
        
        # Анимация появления
        self.animation = QPropertyAnimation(self, b"windowOpacity")
        self.animation.setDuration(300)
        self.animation.setStartValue(0)
        self.animation.setEndValue(1)
        self.animation.setEasingCurve(QEasingCurve.Type.OutCubic)
        
    def showEvent(self, event):
        """Анимация при показе"""
        super().showEvent(event)
        self.animation.start()
        
    def resizeEvent(self, event):
        """Обновление позиции контейнера при изменении размера"""
        super().resizeEvent(event)
        self.container.resize(self.width() - 40, self.height() - 40)
        self.container.move(20, 20)
        
    def add_content(self, widget: QWidget):
        """Добавление контента в диалог"""
        self.container_layout.addWidget(widget)
        
    def add_buttons(self, buttons: list[tuple[str, str, callable]]):
        """
        Добавление кнопок
        
        Args:
            buttons: Список кортежей (текст, стиль, callback)
        """
        button_layout = QHBoxLayout()
        button_layout.setSpacing(12)
        
        for text, style, callback in buttons:
            btn = QPushButton(text)
            btn.setProperty("class", style)
            btn.setMinimumHeight(44)
            btn.clicked.connect(callback)
            button_layout.addWidget(btn)
            
        self.container_layout.addLayout(button_layout)


class GlassFrame(QFrame):
    """Стеклянная панель для выделения важной информации"""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setStyleSheet(f"""
            GlassFrame {{
                background: rgba(124, 58, 237, 0.05);
                border: 1px solid rgba(124, 58, 237, 0.2);
                border-radius: 16px;
                padding: 16px;
            }}
        """)


class IconLabel(QLabel):
    """Лейбл с иконкой и текстом"""

    def __init__(self, icon: str, text: str, parent=None):
        super().__init__(parent)
        self.setText(f"{icon}  {text}")
        self.setStyleSheet(f"""
            font-size: 14px;
            color: {theme.TEXT_MUTED};
            background: transparent;
            padding: 4px 0;
        """)


# ==================== Основные диалоги ====================

class ActivationDialog(ModernDialog):
    """
    Современный диалог активации точки
    
    Особенности:
    - Визуальная обратная связь
    - Валидация в реальном времени
    - Подсказки
    """
    
    def __init__(self, config: dict, parent=None):
        super().__init__(parent, "Подключение точки", 520)
        
        self.config = config
        
        # Добавляем контент
        self.setup_ui()
        
    def setup_ui(self):
        """Настройка интерфейса"""
        
        # Информационная иконка
        icon_label = QLabel("[+]")
        icon_label.setStyleSheet(f"""
            font-size: 32px;
            font-weight: 700;
            color: {theme.ACCENT};
            background: transparent;
            qproperty-alignment: AlignCenter;
        """)
        icon_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.add_content(icon_label)
        
        # Описание
        intro = QLabel(
            "Укажите адрес сервера Orda Control и токен устройства.\n"
            "Токен можно получить на странице управления устройствами."
        )
        intro.setWordWrap(True)
        intro.setAlignment(Qt.AlignmentFlag.AlignCenter)
        intro.setStyleSheet(f"""
            font-size: 13px;
            color: {theme.TEXT_MUTED};
            background: transparent;
            line-height: 1.5;
            padding: 8px 0;
        """)
        self.add_content(intro)

        # Форма
        form_container = QFrame()
        form_container.setStyleSheet(f"""
            QFrame {{
                background: {theme.BG};
                border: 1px solid {theme.DIVIDER};
                border-radius: 16px;
                padding: 20px;
            }}
        """)

        form_layout = QFormLayout(form_container)
        form_layout.setVerticalSpacing(16)
        form_layout.setLabelAlignment(Qt.AlignmentFlag.AlignRight)

        # API URL
        api_label = QLabel("API URL")
        api_label.setStyleSheet(f"font-size: 14px; font-weight: 600; color: {theme.ACCENT};")

        self.api_url = QLineEdit(self.config.get("api_base_url") or "https://ordaops.kz")
        self.api_url.setPlaceholderText("https://ordaops.kz")
        self.api_url.setMinimumHeight(44)
        self.api_url.textChanged.connect(self.validate_input)

        # Device Token
        token_label = QLabel("Device Token")
        token_label.setStyleSheet(f"font-size: 14px; font-weight: 600; color: {theme.ACCENT};")
        
        token_container = QWidget()
        token_layout = QHBoxLayout(token_container)
        token_layout.setContentsMargins(0, 0, 0, 0)
        token_layout.setSpacing(8)
        
        self.device_token = QLineEdit(self.config.get("device_token") or "")
        self.device_token.setPlaceholderText("Вставьте токен устройства")
        self.device_token.setMinimumHeight(44)
        self.device_token.setEchoMode(QLineEdit.EchoMode.Password)
        self.device_token.textChanged.connect(self.validate_input)

        self.toggle_token_btn = QPushButton("*")
        self.toggle_token_btn.setFixedSize(44, 44)
        self.toggle_token_btn.setCheckable(True)
        self.toggle_token_btn.setStyleSheet(f"""
            QPushButton {{
                background: {theme.CARD};
                border: 1px solid {theme.DIVIDER};
                border-radius: 10px;
                font-size: 16px;
                color: {theme.TEXT_MUTED};
            }}
            QPushButton:hover {{
                background: {theme.DIVIDER};
            }}
            QPushButton:checked {{
                background: {theme.ACCENT};
                color: {theme.TEXT};
            }}
        """)
        self.toggle_token_btn.toggled.connect(self.toggle_token_visibility)
        
        token_layout.addWidget(self.device_token, 1)
        token_layout.addWidget(self.toggle_token_btn)
        
        form_layout.addRow(api_label, self.api_url)
        form_layout.addRow(token_label, token_container)
        
        self.add_content(form_container)
        
        # Индикатор валидации
        self.validation_label = QLabel("")
        self.validation_label.setWordWrap(True)
        self.validation_label.setStyleSheet(f"""
            font-size: 12px;
            color: {theme.WARNING};
            background: transparent;
            padding: 4px 8px;
        """)
        self.validation_label.hide()
        self.add_content(self.validation_label)

        # Подсказка
        hint_frame = GlassFrame()
        hint_layout = QHBoxLayout(hint_frame)
        hint_layout.setContentsMargins(16, 12, 16, 12)

        hint_icon = QLabel("i")
        hint_icon.setStyleSheet(f"font-size: 16px; font-weight: 700; color: {theme.ACCENT}; background: transparent;")

        hint_text = QLabel(
            "Токен устройства можно найти в личном кабинете "
            "в разделе управления точками."
        )
        hint_text.setWordWrap(True)
        hint_text.setStyleSheet(f"font-size: 12px; color: {theme.TEXT_MUTED}; background: transparent;")
        
        hint_layout.addWidget(hint_icon)
        hint_layout.addWidget(hint_text, 1)
        
        self.add_content(hint_frame)
        
        # Кнопки
        self.add_buttons([
            ("Отмена", "ghost", self.reject),
            ("Подключить", "primary", self.accept)
        ])
        
        # Первоначальная валидация
        self.validate_input()
        
    def toggle_token_visibility(self, checked: bool):
        """Переключение видимости токена"""
        mode = QLineEdit.EchoMode.Normal if checked else QLineEdit.EchoMode.Password
        self.device_token.setEchoMode(mode)
        
    def validate_input(self):
        """Валидация введённых данных"""
        api_url = self.api_url.text().strip()
        token = self.device_token.text().strip()
        
        messages = []
        
        if not api_url:
            messages.append("• Укажите API URL")
        elif not api_url.startswith(("http://", "https://")):
            messages.append("• API URL должен начинаться с http:// или https://")
            
        if not token:
            messages.append("• Введите device token")
        elif len(token) < 10:
            messages.append("• Device token слишком короткий")
            
        if messages:
            self.validation_label.setText("\n".join(messages))
            self.validation_label.show()
            
            # Ищем кнопку подключения и делаем её неактивной
            for btn in self.findChildren(QPushButton):
                if btn.text() == "Подключить":
                    btn.setEnabled(False)
                    break
        else:
            self.validation_label.hide()
            for btn in self.findChildren(QPushButton):
                if btn.text() == "Подключить":
                    btn.setEnabled(True)
                    break
                    
    def payload(self) -> dict:
        """Получение данных для сохранения"""
        return {
            "api_base_url": self.api_url.text().strip().rstrip("/"),
            "device_token": self.device_token.text().strip(),
        }


class OperatorLoginDialog(ModernDialog):
    """
    Современный диалог входа оператора
    
    Особенности:
    - Запоминание последнего логина
    - Валидация в реальном времени
    - Кнопка показа пароля
    - Визуальная обратная связь
    """
    
    def __init__(self, remembered_username: str | None = None, parent=None):
        super().__init__(parent, "Вход оператора", 460)
        
        self.remembered_username = remembered_username or ""
        self.setup_ui()
        
    def setup_ui(self):
        """Настройка интерфейса"""
        
        # Иконка
        icon_label = QLabel("[>]")
        icon_label.setStyleSheet(f"""
            font-size: 32px;
            font-weight: 700;
            color: {theme.ACCENT};
            background: transparent;
            qproperty-alignment: AlignCenter;
        """)
        icon_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.add_content(icon_label)
        
        # Описание
        intro = QLabel(
            "Войдите под своим логином и паролем.\n"
            "Используются те же данные, что и на сайте."
        )
        intro.setWordWrap(True)
        intro.setAlignment(Qt.AlignmentFlag.AlignCenter)
        intro.setStyleSheet(f"""
            font-size: 13px;
            color: {theme.TEXT_MUTED};
            background: transparent;
            line-height: 1.5;
            padding: 8px 0;
        """)
        self.add_content(intro)

        # Форма
        form_container = QFrame()
        form_container.setStyleSheet(f"""
            QFrame {{
                background: {theme.BG};
                border: 1px solid {theme.DIVIDER};
                border-radius: 16px;
                padding: 20px;
            }}
        """)

        form_layout = QFormLayout(form_container)
        form_layout.setVerticalSpacing(16)
        form_layout.setLabelAlignment(Qt.AlignmentFlag.AlignRight)

        # Логин
        username_label = QLabel("Логин")
        username_label.setStyleSheet(f"font-size: 14px; font-weight: 600; color: {theme.ACCENT};")

        self.username = QLineEdit(self.remembered_username)
        self.username.setPlaceholderText("Введите логин")
        self.username.setMinimumHeight(44)
        self.username.textChanged.connect(self.validate_input)

        # Пароль
        password_label = QLabel("Пароль")
        password_label.setStyleSheet(f"font-size: 14px; font-weight: 600; color: {theme.ACCENT};")
        
        password_container = QWidget()
        password_layout = QHBoxLayout(password_container)
        password_layout.setContentsMargins(0, 0, 0, 0)
        password_layout.setSpacing(8)
        
        self.password = QLineEdit()
        self.password.setPlaceholderText("············")
        self.password.setMinimumHeight(44)
        self.password.setEchoMode(QLineEdit.EchoMode.Password)
        self.password.textChanged.connect(self.validate_input)
        self.password.returnPressed.connect(self.try_accept)

        self.toggle_password_btn = QPushButton("*")
        self.toggle_password_btn.setFixedSize(44, 44)
        self.toggle_password_btn.setCheckable(True)
        self.toggle_password_btn.setStyleSheet(f"""
            QPushButton {{
                background: {theme.CARD};
                border: 1px solid {theme.DIVIDER};
                border-radius: 10px;
                font-size: 16px;
                color: {theme.TEXT_MUTED};
            }}
            QPushButton:hover {{
                background: {theme.DIVIDER};
            }}
            QPushButton:checked {{
                background: {theme.ACCENT};
                color: {theme.TEXT};
            }}
        """)
        self.toggle_password_btn.toggled.connect(self.toggle_password_visibility)

        password_layout.addWidget(self.password, 1)
        password_layout.addWidget(self.toggle_password_btn)

        # Запомнить меня
        remember_container = QHBoxLayout()
        self.remember_check = QCheckBox("Запомнить логин")
        self.remember_check.setChecked(True)
        self.remember_check.setStyleSheet(f"""
            QCheckBox {{
                color: {theme.TEXT_MUTED};
                font-size: 13px;
                spacing: 8px;
            }}
            QCheckBox::indicator {{
                width: 18px;
                height: 18px;
                border: 1px solid {theme.DIVIDER};
                border-radius: 4px;
                background: {theme.CARD};
            }}
            QCheckBox::indicator:checked {{
                background: {theme.ACCENT};
                border-color: {theme.ACCENT};
            }}
        """)
        
        remember_container.addWidget(self.remember_check)
        remember_container.addStretch()
        
        form_layout.addRow(username_label, self.username)
        form_layout.addRow(password_label, password_container)
        form_layout.addRow("", remember_container)
        
        self.add_content(form_container)
        
        # Индикатор валидации
        self.validation_label = QLabel("")
        self.validation_label.setWordWrap(True)
        self.validation_label.setStyleSheet(f"""
            font-size: 12px;
            color: {theme.WARNING};
            background: transparent;
            padding: 4px 8px;
        """)
        self.validation_label.hide()
        self.add_content(self.validation_label)

        # Кнопки
        self.add_buttons([
            ("Отмена", "ghost", self.reject),
            ("Войти", "primary", self.accept)
        ])
        
        # Первоначальная валидация
        self.validate_input()
        
    def toggle_password_visibility(self, checked: bool):
        """Переключение видимости пароля"""
        mode = QLineEdit.EchoMode.Normal if checked else QLineEdit.EchoMode.Password
        self.password.setEchoMode(mode)
        
    def validate_input(self):
        """Валидация введённых данных"""
        username = self.username.text().strip()
        password = self.password.text()
        
        messages = []
        
        if not username:
            messages.append("• Введите логин")
            
        if not password:
            messages.append("• Введите пароль")
        elif len(password) < 3:
            messages.append("• Пароль слишком короткий")
            
        if messages:
            self.validation_label.setText("\n".join(messages))
            self.validation_label.show()
            
            # Делаем кнопку входа неактивной
            for btn in self.findChildren(QPushButton):
                if btn.text() == "Войти":
                    btn.setEnabled(False)
                    break
        else:
            self.validation_label.hide()
            for btn in self.findChildren(QPushButton):
                if btn.text() == "Войти":
                    btn.setEnabled(True)
                    break
                    
    def try_accept(self):
        """Попытка принять диалог при нажатии Enter"""
        if self.findChild(QPushButton, "").isEnabled():
            self.accept()
                    
    def payload(self) -> dict:
        """Получение данных для входа"""
        return {
            "username": self.username.text().strip(),
            "password": self.password.text(),
        }
        
    def should_remember(self) -> bool:
        """Нужно ли запоминать логин"""
        return self.remember_check.isChecked()


class SuperAdminLoginDialog(ModernDialog):
    """
    Диалог входа Super Admin
    
    Особенности:
    - Специальный дизайн для администратора
    - Дополнительные подсказки
    """
    
    def __init__(self, parent=None):
        super().__init__(parent, "Super Admin", 460)
        
        self.setup_ui()
        
    def setup_ui(self):
        """Настройка интерфейса"""
        
        # Иконка
        icon_label = QLabel("[A]")
        icon_label.setStyleSheet(f"""
            font-size: 32px;
            font-weight: 700;
            color: {theme.ACCENT};
            background: transparent;
            qproperty-alignment: AlignCenter;
        """)
        icon_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.add_content(icon_label)
        
        # Описание
        intro = QLabel(
            "Вход в режим администратора.\n"
            "Используйте email и пароль от личного кабинета."
        )
        intro.setWordWrap(True)
        intro.setAlignment(Qt.AlignmentFlag.AlignCenter)
        intro.setStyleSheet(f"""
            font-size: 13px;
            color: {theme.ACCENT};
            background: transparent;
            line-height: 1.5;
            padding: 8px 0;
        """)
        self.add_content(intro)

        # Форма
        form_container = QFrame()
        form_container.setStyleSheet(f"""
            QFrame {{
                background: {theme.BG};
                border: 1px solid {theme.DIVIDER};
                border-radius: 16px;
                padding: 20px;
            }}
        """)

        form_layout = QFormLayout(form_container)
        form_layout.setVerticalSpacing(16)
        form_layout.setLabelAlignment(Qt.AlignmentFlag.AlignRight)

        # Email
        email_label = QLabel("Email")
        email_label.setStyleSheet(f"font-size: 14px; font-weight: 600; color: {theme.ACCENT};")

        self.email = QLineEdit()
        self.email.setPlaceholderText("admin@ordaops.kz")
        self.email.setMinimumHeight(44)
        self.email.textChanged.connect(self.validate_input)

        # Пароль
        pass_label = QLabel("Пароль")
        pass_label.setStyleSheet(f"font-size: 14px; font-weight: 600; color: {theme.ACCENT};")
        
        password_container = QWidget()
        password_layout = QHBoxLayout(password_container)
        password_layout.setContentsMargins(0, 0, 0, 0)
        password_layout.setSpacing(8)
        
        self.password = QLineEdit()
        self.password.setPlaceholderText("············")
        self.password.setMinimumHeight(44)
        self.password.setEchoMode(QLineEdit.EchoMode.Password)
        self.password.textChanged.connect(self.validate_input)
        self.password.returnPressed.connect(self.try_accept)

        self.toggle_password_btn = QPushButton("*")
        self.toggle_password_btn.setFixedSize(44, 44)
        self.toggle_password_btn.setCheckable(True)
        self.toggle_password_btn.setStyleSheet(f"""
            QPushButton {{
                background: {theme.CARD};
                border: 1px solid {theme.DIVIDER};
                border-radius: 10px;
                font-size: 16px;
                color: {theme.TEXT_MUTED};
            }}
            QPushButton:hover {{
                background: {theme.DIVIDER};
            }}
            QPushButton:checked {{
                background: {theme.ACCENT};
                color: {theme.TEXT};
            }}
        """)
        self.toggle_password_btn.toggled.connect(self.toggle_password_visibility)
        
        password_layout.addWidget(self.password, 1)
        password_layout.addWidget(self.toggle_password_btn)
        
        form_layout.addRow(email_label, self.email)
        form_layout.addRow(pass_label, password_container)
        
        self.add_content(form_container)
        
        # Предупреждение
        warning_frame = QFrame()
        warning_frame.setStyleSheet(f"""
            QFrame {{
                background: rgba(248, 113, 113, 0.05);
                border: 1px solid rgba(248, 113, 113, 0.2);
                border-radius: 12px;
                padding: 12px;
            }}
        """)

        warning_layout = QHBoxLayout(warning_frame)
        warning_layout.setContentsMargins(12, 8, 12, 8)

        warning_icon = QLabel("!")
        warning_icon.setStyleSheet(f"font-size: 16px; font-weight: 700; color: {theme.ERROR}; background: transparent;")

        warning_text = QLabel(
            "Этот режим даёт полный доступ к управлению "
            "терминалом и настройкам точки."
        )
        warning_text.setWordWrap(True)
        warning_text.setStyleSheet(f"font-size: 12px; color: {theme.ERROR}; background: transparent;")
        
        warning_layout.addWidget(warning_icon)
        warning_layout.addWidget(warning_text, 1)
        
        self.add_content(warning_frame)
        
        # Индикатор валидации
        self.validation_label = QLabel("")
        self.validation_label.setWordWrap(True)
        self.validation_label.setStyleSheet(f"""
            font-size: 12px;
            color: {theme.WARNING};
            background: transparent;
            padding: 4px 8px;
        """)
        self.validation_label.hide()
        self.add_content(self.validation_label)

        # Кнопки
        self.add_buttons([
            ("Отмена", "ghost", self.reject),
            ("Войти", "primary", self.accept)
        ])

        # Первоначальная валидация
        self.validate_input()

    def toggle_password_visibility(self, checked: bool):
        """Переключение видимости пароля"""
        mode = QLineEdit.EchoMode.Normal if checked else QLineEdit.EchoMode.Password
        self.password.setEchoMode(mode)

    def validate_input(self):
        """Валидация введённых данных"""
        email = self.email.text().strip()
        password = self.password.text()
        
        messages = []
        
        if not email:
            messages.append("• Введите email")
        elif "@" not in email or "." not in email:
            messages.append("• Введите корректный email")
            
        if not password:
            messages.append("• Введите пароль")
            
        if messages:
            self.validation_label.setText("\n".join(messages))
            self.validation_label.show()
            
            for btn in self.findChildren(QPushButton):
                if btn.text() == "Войти":
                    btn.setEnabled(False)
                    break
        else:
            self.validation_label.hide()
            for btn in self.findChildren(QPushButton):
                if btn.text() == "Войти":
                    btn.setEnabled(True)
                    break
                    
    def try_accept(self):
        """Попытка принять диалог при нажатии Enter"""
        if self.findChild(QPushButton, "").isEnabled():
            self.accept()
                    
    def payload(self) -> dict:
        """Получение данных для входа"""
        return {
            "email": self.email.text().strip(),
            "password": self.password.text(),
        }


class ConfirmDialog(ModernDialog):
    """
    Диалог подтверждения действия
    
    Особенности:
    - Разные варианты (danger/warning/info)
    - Кастомизируемый текст
    """
    
    def __init__(self, 
                 parent=None,
                 title: str = "Подтверждение",
                 message: str = "Вы уверены?",
                 confirm_text: str = "Подтвердить",
                 cancel_text: str = "Отмена",
                 variant: str = "warning"):
        
        super().__init__(parent, title, 400)
        
        # Выбор иконки и цвета в зависимости от варианта
        icons = {
            "danger": ("!", theme.ERROR),
            "warning": ("!", theme.WARNING),
            "info": ("i", theme.ACCENT),
            "success": ("+", theme.SUCCESS)
        }

        icon, color = icons.get(variant, ("?", theme.TEXT_MUTED))

        # Иконка
        icon_label = QLabel(icon)
        icon_label.setStyleSheet(f"""
            font-size: 40px;
            font-weight: 700;
            color: {color};
            background: transparent;
            qproperty-alignment: AlignCenter;
        """)
        icon_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.add_content(icon_label)
        
        # Сообщение
        msg_label = QLabel(message)
        msg_label.setWordWrap(True)
        msg_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        msg_label.setStyleSheet(f"""
            font-size: 15px;
            color: {theme.TEXT};
            background: transparent;
            line-height: 1.6;
            padding: 16px 0;
        """)
        self.add_content(msg_label)
        
        # Кнопки
        self.add_buttons([
            (cancel_text, "ghost", self.reject),
            (confirm_text, variant, self.accept)
        ])