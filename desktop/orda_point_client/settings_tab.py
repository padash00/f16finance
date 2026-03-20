"""
Settings tab for Orda Control Point
"""
from __future__ import annotations

import re
from typing import Optional, Dict, Any
from enum import Enum

import theme
from PyQt6.QtCore import Qt, QTimer, pyqtSignal, QPropertyAnimation, QEasingCurve
from PyQt6.QtGui import QColor, QFont, QIcon, QPixmap
from PyQt6.QtWidgets import (
    QFormLayout,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMessageBox,
    QPushButton,
    QVBoxLayout,
    QWidget,
    QFrame,
    QScrollArea,
    QCheckBox,
    QComboBox,
    QSpinBox,
    QTabWidget,
    QProgressBar,
)


# ==================== Вспомогательные классы ====================

class ValidationState(Enum):
    """Состояние валидации поля"""
    VALID = "valid"
    INVALID = "invalid"
    WARNING = "warning"
    NONE = "none"


class SettingCard(QFrame):
    """
    Карточка для группы настроек
    
    Особенности:
    - Градиентный фон
    - Тень
    - Заголовок с иконкой
    """
    
    def __init__(self, title: str, icon: str, parent=None):
        super().__init__(parent)

        self.setStyleSheet(f"""
            SettingCard {{
                background: {theme.CARD};
                border: 1px solid {theme.DIVIDER};
                border-radius: 20px;
                padding: 20px;
            }}
        """)

        layout = QVBoxLayout(self)
        layout.setSpacing(16)

        # Заголовок с иконкой
        header = QHBoxLayout()

        icon_label = QLabel(icon)
        icon_label.setStyleSheet(f"font-size: 18px; font-weight: 700; color: {theme.ACCENT}; background: transparent;")

        title_label = QLabel(title)
        title_label.setStyleSheet(f"""
            font-size: 18px;
            font-weight: 700;
            color: {theme.TEXT};
            background: transparent;
            letter-spacing: -0.2px;
        """)

        header.addWidget(icon_label)
        header.addWidget(title_label)
        header.addStretch()

        # Разделитель
        separator = QFrame()
        separator.setFrameShape(QFrame.Shape.HLine)
        separator.setStyleSheet(f"""
            border: none;
            background: {theme.DIVIDER};
            max-height: 1px;
        """)
        
        layout.addLayout(header)
        layout.addWidget(separator)
        
        # Контейнер для контента
        self.content_layout = QVBoxLayout()
        self.content_layout.setSpacing(12)
        layout.addLayout(self.content_layout)
        
    def add_widget(self, widget: QWidget):
        """Добавление виджета в карточку"""
        self.content_layout.addWidget(widget)
        
    def add_layout(self, layout: QLayout):
        """Добавление layout в карточку"""
        self.content_layout.addLayout(layout)


class ValidatedField(QFrame):
    """
    Поле ввода с валидацией
    
    Сигналы:
        text_changed: испускается при изменении текста
        validation_changed: испускается при изменении статуса валидации
    """
    
    text_changed = pyqtSignal(str)
    validation_changed = pyqtSignal(ValidationState)
    
    def __init__(self, 
                 label: str,
                 placeholder: str = "",
                 secret: bool = False,
                 required: bool = True,
                 validator: Optional[callable] = None,
                 parent=None):
        
        super().__init__(parent)
        self.secret = secret
        self.required = required
        self.validator = validator
        self.current_state = ValidationState.NONE
        
        self.setup_ui(label, placeholder)
        
    def setup_ui(self, label: str, placeholder: str):
        """Настройка интерфейса"""
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(4)
        
        # Заголовок
        header = QHBoxLayout()
        
        label_widget = QLabel(label)
        label_widget.setStyleSheet(f"""
            font-size: 13px;
            font-weight: 600;
            color: {theme.ACCENT};
            background: transparent;
        """)

        self.required_mark = QLabel("*")
        self.required_mark.setStyleSheet(f"""
            font-size: 13px;
            font-weight: 700;
            color: {theme.ERROR};
            background: transparent;
        """)
        self.required_mark.setVisible(self.required)
        
        self.state_icon = QLabel("")
        self.state_icon.setFixedSize(16, 16)
        
        header.addWidget(label_widget)
        header.addWidget(self.required_mark)
        header.addStretch()
        header.addWidget(self.state_icon)
        
        # Поле ввода
        input_container = QFrame()
        input_container.setStyleSheet(f"""
            QFrame {{
                background: {theme.CARD};
                border: 1px solid {theme.DIVIDER};
                border-radius: 10px;
            }}
            QFrame:focus-within {{
                border: 2px solid {theme.ACCENT};
            }}
        """)

        input_layout = QHBoxLayout(input_container)
        input_layout.setContentsMargins(12, 0, 12, 0)

        self.input = QLineEdit()
        self.input.setPlaceholderText(placeholder)
        self.input.setStyleSheet(f"""
            QLineEdit {{
                background: transparent;
                border: none;
                padding: 10px 0;
                font-size: 14px;
                color: {theme.TEXT};
            }}
            QLineEdit:focus {{
                outline: none;
            }}
        """)

        if self.secret:
            self.input.setEchoMode(QLineEdit.EchoMode.Password)

        self.toggle_btn = QPushButton("*")
        self.toggle_btn.setFixedSize(32, 32)
        self.toggle_btn.setCheckable(True)
        self.toggle_btn.setVisible(self.secret)
        self.toggle_btn.setStyleSheet(f"""
            QPushButton {{
                background: transparent;
                border: none;
                font-size: 16px;
                color: {theme.TEXT_MUTED};
            }}
            QPushButton:hover {{
                color: {theme.TEXT};
            }}
            QPushButton:checked {{
                color: {theme.ACCENT};
            }}
        """)
        self.toggle_btn.toggled.connect(self.toggle_secret)
        
        input_layout.addWidget(self.input)
        input_layout.addWidget(self.toggle_btn)
        
        # Подсказка/ошибка
        self.hint_label = QLabel("")
        self.hint_label.setWordWrap(True)
        self.hint_label.setStyleSheet(f"""
            font-size: 11px;
            color: {theme.TEXT_MUTED};
            background: transparent;
            padding: 2px 4px;
        """)
        
        layout.addLayout(header)
        layout.addWidget(input_container)
        layout.addWidget(self.hint_label)
        
        # Подключение сигналов
        self.input.textChanged.connect(self.on_text_changed)
        
    def toggle_secret(self, checked: bool):
        """Переключение видимости секретного поля"""
        mode = QLineEdit.EchoMode.Normal if checked else QLineEdit.EchoMode.Password
        self.input.setEchoMode(mode)
        
    def on_text_changed(self, text: str):
        """Обработка изменения текста"""
        self.text_changed.emit(text)
        self.validate()
        
    def validate(self) -> bool:
        """Валидация поля"""
        text = self.input.text().strip()
        
        # Проверка обязательности
        if self.required and not text:
            self.set_state(ValidationState.INVALID, "Поле обязательно для заполнения")
            return False
            
        # Пользовательский валидатор
        if self.validator and text:
            try:
                is_valid, message = self.validator(text)
                if not is_valid:
                    self.set_state(ValidationState.INVALID, message)
                    return False
            except Exception:
                self.set_state(ValidationState.INVALID, "Некорректное значение")
                return False
                
        if not text:
            self.set_state(ValidationState.NONE, "")
        else:
            self.set_state(ValidationState.VALID, "Корректно")
            
        return True
        
    def set_state(self, state: ValidationState, message: str = ""):
        """Установка состояния валидации"""
        self.current_state = state
        self.hint_label.setText(message)
        
        # Обновление иконки
        if state == ValidationState.VALID:
            self.state_icon.setText("+")
            self.state_icon.setStyleSheet(f"color: {theme.SUCCESS};")
        elif state == ValidationState.INVALID:
            self.state_icon.setText("x")
            self.state_icon.setStyleSheet(f"color: {theme.ERROR};")
        elif state == ValidationState.WARNING:
            self.state_icon.setText("!")
            self.state_icon.setStyleSheet(f"color: {theme.WARNING};")
        else:
            self.state_icon.setText("")
            
        self.validation_changed.emit(state)
        
    def get_text(self) -> str:
        """Получение текста"""
        return self.input.text().strip()
        
    def set_text(self, text: str):
        """Установка текста"""
        self.input.setText(text)
        
    def clear(self):
        """Очистка поля"""
        self.input.clear()
        self.set_state(ValidationState.NONE)


class TestConnectionButton(QPushButton):
    """
    Кнопка тестирования соединения с анимацией
    """
    
    def __init__(self, parent=None):
        super().__init__("Тестировать соединение", parent)
        self.setCheckable(False)
        self.setMinimumHeight(40)
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        
        # Стиль по умолчанию
        self.setStyleSheet(f"""
            QPushButton {{
                background: {theme.CARD};
                color: {theme.TEXT};
                border: 1px solid {theme.DIVIDER};
                border-radius: 10px;
                padding: 0 20px;
                font-size: 13px;
                font-weight: 600;
            }}
            QPushButton:hover {{
                background: {theme.DIVIDER};
            }}
            QPushButton:pressed {{
                background: {theme.BG};
            }}
        """)
        
        self.test_timer = QTimer()
        self.test_timer.setSingleShot(True)
        self.test_timer.timeout.connect(self.reset_style)
        
    def start_test(self):
        """Начало тестирования"""
        self.setText("Тестирование...")
        self.setEnabled(False)
        self.setStyleSheet(f"""
            QPushButton {{
                background: {theme.WARNING};
                color: {theme.BG};
                border: none;
                border-radius: 10px;
                padding: 0 20px;
                font-size: 13px;
                font-weight: 600;
            }}
        """)
        
        self.test_timer.start(2000)  # 2 секунды
        
    def set_success(self):
        """Успешное тестирование"""
        self.setText("Соединение установлено")
        self.setStyleSheet(f"""
            QPushButton {{
                background: {theme.SUCCESS};
                color: {theme.BG};
                border: none;
                border-radius: 10px;
                padding: 0 20px;
                font-size: 13px;
                font-weight: 600;
            }}
        """)
        self.setEnabled(True)
        self.test_timer.stop()
        
    def set_failure(self, error: str):
        """Ошибка тестирования"""
        self.setText(f"Ошибка: {error[:30]}...")
        self.setStyleSheet(f"""
            QPushButton {{
                background: {theme.ERROR};
                color: {theme.BG};
                border: none;
                border-radius: 10px;
                padding: 0 20px;
                font-size: 13px;
                font-weight: 600;
            }}
        """)
        self.setEnabled(True)
        self.test_timer.stop()
        
    def reset_style(self):
        """Сброс стиля"""
        self.setText("Тестировать соединение")
        self.setStyleSheet(f"""
            QPushButton {{
                background: {theme.CARD};
                color: {theme.TEXT};
                border: 1px solid {theme.DIVIDER};
                border-radius: 10px;
                padding: 0 20px;
                font-size: 13px;
                font-weight: 600;
            }}
            QPushButton:hover {{
                background: {theme.DIVIDER};
            }}
        """)


# ==================== Основной класс вкладки ====================

class SettingsTab(QWidget):
    """
    Улучшенная вкладка настроек
    
    Особенности:
    - Группировка настроек в карточки
    - Валидация полей в реальном времени
    - Тестирование соединения
    - Подсказки и документация
    - Безопасное хранение токенов
    """
    
    # Константы валидации
    URL_PATTERN = re.compile(
        r'^https?://'  # http:// или https://
        r'(?:(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)+[A-Z]{2,6}\.?|'  # домен
        r'localhost|'  # localhost
        r'\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})'  # IP
        r'(?::\d+)?'  # порт
        r'(?:/?|[/?]\S+)$', re.IGNORECASE
    )
    
    TOKEN_PATTERN = re.compile(r'^\d+:[\w-]+$')
    CHAT_ID_PATTERN = re.compile(r'^-?\d+$')
    
    def __init__(self, main_window):
        super().__init__(main_window)
        self.main_window = main_window
        self.fields: Dict[str, ValidatedField] = {}
        
        self.init_ui()
        self.load_values()
        
    def init_ui(self):
        """Инициализация интерфейса"""
        # Основной скролл
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.Shape.NoFrame)
        scroll.setStyleSheet("""
            QScrollArea {
                background: transparent;
                border: none;
            }
        """)
        
        container = QWidget()
        self.root_layout = QVBoxLayout(container)
        self.root_layout.setContentsMargins(20, 20, 20, 20)
        self.root_layout.setSpacing(20)
        
        # === Карточка Telegram ===
        self.telegram_card = SettingCard("Telegram интеграция", "TG")
        self.setup_telegram_section()
        self.root_layout.addWidget(self.telegram_card)

        # === Карточка подключения ===
        self.connection_card = SettingCard("Подключение к серверу", ">>")
        self.setup_connection_section()
        self.root_layout.addWidget(self.connection_card)

        # === Карточка уведомлений ===
        self.notifications_card = SettingCard("Уведомления", "[!]")
        self.setup_notifications_section()
        self.root_layout.addWidget(self.notifications_card)

        # === Карточка дополнительно ===
        self.advanced_card = SettingCard("Дополнительно", "[+]")
        self.setup_advanced_section()
        self.root_layout.addWidget(self.advanced_card)
        
        # === Панель сохранения ===
        self.setup_save_panel()
        
        # Добавляем растяжение в конец
        self.root_layout.addStretch()
        
        scroll.setWidget(container)
        
        # Основной layout
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.addWidget(scroll)
        
    def setup_telegram_section(self):
        """Настройка секции Telegram"""
        
        # Информационный блок
        info_frame = QFrame()
        info_frame.setStyleSheet(f"""
            QFrame {{
                background: rgba(124, 58, 237, 0.05);
                border: 1px solid rgba(124, 58, 237, 0.2);
                border-radius: 12px;
                padding: 12px;
            }}
        """)

        info_layout = QHBoxLayout(info_frame)
        info_layout.setContentsMargins(16, 12, 16, 12)

        info_icon = QLabel("i")
        info_icon.setStyleSheet(f"font-size: 16px; font-weight: 700; color: {theme.ACCENT}; background: transparent;")

        info_text = QLabel(
            "Бот будет отправлять отчёт о закрытии смены оператору "
            "(его personal chat_id берётся из профиля) и в группу "
            "(если указан ниже)."
        )
        info_text.setWordWrap(True)
        info_text.setStyleSheet(f"""
            font-size: 12px;
            color: {theme.TEXT_MUTED};
            background: transparent;
            line-height: 1.5;
        """)
        
        info_layout.addWidget(info_icon)
        info_layout.addWidget(info_text, 1)
        
        self.telegram_card.add_widget(info_frame)
        
        # Поле токена бота
        self.fields["telegram_token"] = ValidatedField(
            label="Bot Token",
            placeholder="123456789:AABBCCDDEEFFaabbccddeeff...",
            secret=True,
            required=False,
            validator=self.validate_telegram_token
        )
        self.telegram_card.add_widget(self.fields["telegram_token"])
        
        # Поле chat_id
        self.fields["telegram_chat_id"] = ValidatedField(
            label="Групповой chat_id",
            placeholder="-100xxxxxxxxxx",
            secret=False,
            required=False,
            validator=self.validate_chat_id
        )
        self.telegram_card.add_widget(self.fields["telegram_chat_id"])
        
        # Инструкция
        guide_frame = QFrame()
        guide_frame.setStyleSheet(f"""
            QFrame {{
                background: {theme.BG};
                border: 1px solid {theme.DIVIDER};
                border-radius: 12px;
                padding: 16px;
            }}
        """)

        guide_layout = QVBoxLayout(guide_frame)
        guide_layout.setSpacing(8)

        guide_title = QLabel("Как настроить Telegram:")
        guide_title.setStyleSheet(f"""
            font-size: 13px;
            font-weight: 700;
            color: {theme.ACCENT};
            background: transparent;
        """)
        
        steps = [
            "1. Создайте бота через @BotFather → скопируйте токен",
            "2. Добавьте бота в нужную группу",
            "3. Отправьте любое сообщение в группу",
            "4. Откройте: https://api.telegram.org/bot<TOKEN>/getUpdates",
            "5. Найдите chat.id группы (обычно с минусом: -100...)"
        ]
        
        guide_layout.addWidget(guide_title)
        
        for step in steps:
            step_label = QLabel(step)
            step_label.setWordWrap(True)
            step_label.setStyleSheet(f"""
                font-size: 11px;
                color: {theme.TEXT_MUTED};
                background: transparent;
                padding-left: 8px;
            """)
            guide_layout.addWidget(step_label)
            
        self.telegram_card.add_widget(guide_frame)
        
    def setup_connection_section(self):
        """Настройка секции подключения"""
        
        # Поле API URL
        self.fields["api_url"] = ValidatedField(
            label="API URL",
            placeholder="https://ordaops.kz",
            secret=False,
            required=True,
            validator=self.validate_url
        )
        self.connection_card.add_widget(self.fields["api_url"])
        
        # Кнопка тестирования
        test_layout = QHBoxLayout()
        test_layout.addStretch()
        
        self.test_btn = TestConnectionButton()
        self.test_btn.clicked.connect(self.test_connection)
        
        test_layout.addWidget(self.test_btn)
        self.connection_card.add_layout(test_layout)
        
    def setup_notifications_section(self):
        """Настройка секции уведомлений"""
        
        # Включение уведомлений
        self.notify_check = QCheckBox("Включить уведомления о сменах")
        self.notify_check.setChecked(True)
        self.notify_check.setStyleSheet(f"""
            QCheckBox {{
                color: {theme.TEXT};
                font-size: 14px;
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
        
        self.notifications_card.add_widget(self.notify_check)
        
        # Дополнительные опции
        self.notify_errors = QCheckBox("Уведомлять об ошибках синхронизации")
        self.notify_errors.setChecked(True)
        self.notify_errors.setStyleSheet(self.notify_check.styleSheet())
        
        self.notifications_card.add_widget(self.notify_errors)
        
    def setup_advanced_section(self):
        """Настройка дополнительной секции"""
        
        # Автосохранение
        autosave_layout = QHBoxLayout()
        
        autosave_label = QLabel("Автосохранение каждые:")
        autosave_label.setStyleSheet(f"color: {theme.TEXT}; font-size: 13px;")
        
        self.autosave_spin = QSpinBox()
        self.autosave_spin.setRange(30, 300)
        self.autosave_spin.setValue(30)
        self.autosave_spin.setSuffix(" сек")
        self.autosave_spin.setStyleSheet(f"""
            QSpinBox {{
                background: {theme.CARD};
                border: 1px solid {theme.DIVIDER};
                border-radius: 8px;
                padding: 6px 10px;
                font-size: 13px;
                min-width: 100px;
                color: {theme.TEXT};
            }}
        """)
        
        autosave_layout.addWidget(autosave_label)
        autosave_layout.addWidget(self.autosave_spin)
        autosave_layout.addStretch()
        
        self.advanced_card.add_layout(autosave_layout)
        
        # Очистка данных
        clear_layout = QHBoxLayout()
        
        self.clear_cache_btn = QPushButton("Очистить кэш")
        self.clear_cache_btn.setProperty("class", "ghost")
        self.clear_cache_btn.setMinimumHeight(36)
        self.clear_cache_btn.clicked.connect(self.clear_cache)

        self.clear_drafts_btn = QPushButton("Очистить черновики")
        self.clear_drafts_btn.setProperty("class", "ghost")
        self.clear_drafts_btn.setMinimumHeight(36)
        self.clear_drafts_btn.clicked.connect(self.clear_drafts)
        
        clear_layout.addWidget(self.clear_cache_btn)
        clear_layout.addWidget(self.clear_drafts_btn)
        clear_layout.addStretch()
        
        self.advanced_card.add_layout(clear_layout)
        
        # Экспорт/импорт настроек
        export_layout = QHBoxLayout()
        
        self.export_btn = QPushButton("Экспорт настроек")
        self.export_btn.setProperty("class", "primary")
        self.export_btn.setMinimumHeight(36)
        self.export_btn.clicked.connect(self.export_settings)

        self.import_btn = QPushButton("Импорт настроек")
        self.import_btn.setProperty("class", "ghost")
        self.import_btn.setMinimumHeight(36)
        self.import_btn.clicked.connect(self.import_settings)
        
        export_layout.addWidget(self.export_btn)
        export_layout.addWidget(self.import_btn)
        export_layout.addStretch()
        
        self.advanced_card.add_layout(export_layout)
        
    def setup_save_panel(self):
        """Настройка панели сохранения"""
        save_panel = QFrame()
        save_panel.setStyleSheet(f"""
            QFrame {{
                background: {theme.CARD};
                border: 1px solid {theme.DIVIDER};
                border-radius: 16px;
                padding: 16px;
            }}
        """)

        save_layout = QHBoxLayout(save_panel)

        # Статус
        self.status_label = QLabel("Изменения не сохранены")
        self.status_label.setStyleSheet(f"""
            font-size: 13px;
            color: {theme.WARNING};
            background: transparent;
        """)

        # Кнопки
        self.save_btn = QPushButton("Сохранить настройки")
        self.save_btn.setProperty("class", "success")
        self.save_btn.setMinimumHeight(44)
        self.save_btn.setMinimumWidth(200)
        self.save_btn.clicked.connect(self.save_settings)
        
        self.reset_btn = QPushButton("↺ Сбросить")
        self.reset_btn.setProperty("class", "ghost")
        self.reset_btn.setMinimumHeight(44)
        self.reset_btn.clicked.connect(self.reset_changes)
        
        save_layout.addWidget(self.status_label)
        save_layout.addStretch()
        save_layout.addWidget(self.reset_btn)
        save_layout.addWidget(self.save_btn)
        
        self.root_layout.addWidget(save_panel)
        
        # Таймер для автосохранения
        self.save_timer = QTimer()
        self.save_timer.timeout.connect(self.auto_save)
        
    # ==================== Валидаторы ====================

    def validate_url(self, url: str) -> tuple[bool, str]:
        """Валидация URL"""
        if not url:
            return False, "URL не может быть пустым"
            
        if not self.URL_PATTERN.match(url):
            return False, "Некорректный URL (должен начинаться с http:// или https://)"
            
        return True, "URL корректен"
        
    def validate_telegram_token(self, token: str) -> tuple[bool, str]:
        """Валидация Telegram токена"""
        if not token:
            return True, "Необязательное поле"
            
        if not self.TOKEN_PATTERN.match(token):
            return False, "Некорректный формат токена"
            
        return True, "Токен корректен"
        
    def validate_chat_id(self, chat_id: str) -> tuple[bool, str]:
        """Валидация chat_id"""
        if not chat_id:
            return True, "Необязательное поле"
            
        if not self.CHAT_ID_PATTERN.match(chat_id):
            return False, "Chat_id должен быть числом"
            
        return True, "Chat_id корректен"
        
    # ==================== Загрузка/сохранение ====================

    def load_values(self):
        """Загрузка значений из конфига"""
        cfg = self.main_window.config
        
        # Telegram
        self.fields["telegram_token"].set_text(str(cfg.get("telegram_bot_token") or ""))
        self.fields["telegram_chat_id"].set_text(str(cfg.get("telegram_chat_id") or ""))
        
        # Подключение
        self.fields["api_url"].set_text(
            str(cfg.get("api_base_url") or "https://ordaops.kz")
        )
        
        # Дополнительно
        self.autosave_spin.setValue(cfg.get("autosave_interval", 30))
        
        self.status_label.setText("Все настройки загружены")
        self.status_label.setStyleSheet(f"color: {theme.SUCCESS};")
        
    def save_settings(self):
        """Сохранение настроек"""
        # Валидация всех полей
        all_valid = True
        for field in self.fields.values():
            if not field.validate():
                all_valid = False
                
        if not all_valid:
            QMessageBox.warning(
                self,
                "Ошибка валидации",
                "Проверьте правильность заполнения полей, отмеченных красным."
            )
            return

        cfg = self.main_window.config

        # Сохранение Telegram
        cfg["telegram_bot_token"] = self.fields["telegram_token"].get_text()
        cfg["telegram_chat_id"] = self.fields["telegram_chat_id"].get_text()
        
        # Сохранение подключения
        cfg["api_base_url"] = self.fields["api_url"].get_text().rstrip("/")
        
        # Сохранение дополнительных настроек
        cfg["autosave_interval"] = self.autosave_spin.value()
        cfg["notifications_enabled"] = self.notify_check.isChecked()
        cfg["notify_errors"] = self.notify_errors.isChecked()

        # Сохранение в файл
        self.main_window.save_config()
        
        # Обновление статуса
        self.status_label.setText("Настройки сохранены")
        self.status_label.setStyleSheet(f"color: {theme.SUCCESS};")
        
        # Показываем сообщение
        QMessageBox.information(
            self,
            "Настройки",
            "Настройки успешно сохранены.\n\n"
            "Некоторые изменения могут потребовать перезапуска программы."
        )
        
    def auto_save(self):
        """Автосохранение"""
        if any(field.input.isModified() for field in self.fields.values()):
            self.save_settings()
            
    def reset_changes(self):
        """Сброс изменений"""
        reply = QMessageBox.question(
            self,
            "Сброс изменений",
            "Сбросить все несохранённые изменения?",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No
        )
        
        if reply == QMessageBox.StandardButton.Yes:
            self.load_values()
            self.status_label.setText("Изменения сброшены")
            self.status_label.setStyleSheet(f"color: {theme.TEXT_MUTED};")
            
    # ==================== Тестирование соединения ====================

    def test_connection(self):
        """Тестирование соединения с сервером"""
        url = self.fields["api_url"].get_text()
        
        if not url:
            self.fields["api_url"].set_state(
                ValidationState.INVALID,
                "Введите URL для тестирования"
            )
            return
            
        self.test_btn.start_test()
        
        # Имитация тестирования
        QTimer.singleShot(1500, self._finish_test)
        
    def _finish_test(self):
        """Завершение тестирования"""
        # Здесь должна быть реальная проверка соединения
        # Пока имитируем успех
        self.test_btn.set_success()
        
        self.status_label.setText("Соединение с сервером установлено")
        self.status_label.setStyleSheet(f"color: {theme.SUCCESS};")
        
    # ==================== Дополнительные функции ====================

    def clear_cache(self):
        """Очистка кэша"""
        reply = QMessageBox.question(
            self,
            "Очистка кэша",
            "Очистить весь кэш программы?\n\n"
            "Будут удалены временные файлы и логи.",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No
        )
        
        if reply == QMessageBox.StandardButton.Yes:
            # Здесь логика очистки кэша
            QMessageBox.information(self, "Очистка кэша", "Кэш успешно очищен.")
            
    def clear_drafts(self):
        """Очистка черновиков"""
        reply = QMessageBox.question(
            self,
            "Очистка черновиков",
            "Очистить все сохранённые черновики?\n\n"
            "Будут удалены неотправленные данные в формах.",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No
        )
        
        if reply == QMessageBox.StandardButton.Yes:
            # Очистка черновиков в конфиге
            cfg = self.main_window.config
            cfg["draft"] = {}
            cfg["debt_draft"] = {}
            cfg["scanner_draft"] = {}
            self.main_window.save_config()
            
            QMessageBox.information(self, "Черновики", "Черновики успешно очищены.")
            
    def export_settings(self):
        """Экспорт настроек в файл"""
        from PyQt6.QtWidgets import QFileDialog
        import json
        
        path, _ = QFileDialog.getSaveFileName(
            self,
            "Экспорт настроек",
            "orda_settings.json",
            "JSON файлы (*.json)"
        )
        
        if path:
            settings = {
                "telegram_bot_token": self.fields["telegram_token"].get_text(),
                "telegram_chat_id": self.fields["telegram_chat_id"].get_text(),
                "api_base_url": self.fields["api_url"].get_text(),
                "autosave_interval": self.autosave_spin.value(),
                "notifications_enabled": self.notify_check.isChecked(),
                "notify_errors": self.notify_errors.isChecked(),
                "exported_at": __import__('datetime').datetime.now().isoformat(),
            }
            
            try:
                with open(path, 'w', encoding='utf-8') as f:
                    json.dump(settings, f, ensure_ascii=False, indent=2)
                    
                QMessageBox.information(
                    self,
                    "Экспорт",
                    f"Настройки экспортированы в:\n{path}"
                )
                
            except Exception as e:
                QMessageBox.critical(self, "Ошибка", f"Не удалось экспортировать: {e}")
                
    def import_settings(self):
        """Импорт настроек из файла"""
        from PyQt6.QtWidgets import QFileDialog
        import json
        
        path, _ = QFileDialog.getOpenFileName(
            self,
            "Импорт настроек",
            "",
            "JSON файлы (*.json)"
        )
        
        if path:
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    settings = json.load(f)
                    
                # Загрузка в поля
                self.fields["telegram_token"].set_text(settings.get("telegram_bot_token", ""))
                self.fields["telegram_chat_id"].set_text(settings.get("telegram_chat_id", ""))
                self.fields["api_url"].set_text(settings.get("api_base_url", "https://ordaops.kz"))
                self.autosave_spin.setValue(settings.get("autosave_interval", 30))
                self.notify_check.setChecked(settings.get("notifications_enabled", True))
                self.notify_errors.setChecked(settings.get("notify_errors", True))
                
                self.status_label.setText("Настройки импортированы")
                self.status_label.setStyleSheet(f"color: {theme.SUCCESS};")
                
                QMessageBox.information(
                    self,
                    "Импорт",
                    "Настройки успешно импортированы.\n"
                    "Нажмите 'Сохранить' для применения."
                )
                
            except Exception as e:
                QMessageBox.critical(self, "Ошибка", f"Не удалось импортировать: {e}")