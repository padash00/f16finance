from __future__ import annotations

import theme
from PyQt6.QtCore import Qt, QPropertyAnimation, QEasingCurve, pyqtSignal
from PyQt6.QtGui import QColor, QPalette, QFont, QIcon
from PyQt6.QtWidgets import (
    QLabel,
    QHBoxLayout,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
    QMessageBox,
    QHeaderView,
    QFrame,
    QSplitter,
)


class ModernStatusCard(QFrame):
    """Современная карточка статуса подключения"""
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setProperty("class", "status-card")

        self.setStyleSheet(f"""
            ModernStatusCard {{
                background: {theme.CARD};
                border: 1px solid {theme.DIVIDER};
                border-radius: 16px;
            }}
        """)

        layout = QHBoxLayout(self)
        layout.setContentsMargins(20, 16, 20, 16)
        layout.setSpacing(16)

        # Иконка статуса
        self.status_icon = QLabel("●")
        self.status_icon.setStyleSheet(f"""
            font-size: 16px;
            color: {theme.ERROR};
            background: transparent;
        """)

        # Текст статуса
        self.status_text = QLabel("Текущая точка: не привязана")
        self.status_text.setStyleSheet(f"""
            font-size: 15px;
            font-weight: 500;
            color: {theme.TEXT};
            background: transparent;
        """)

        # Индикатор токена
        self.token_indicator = QFrame()
        self.token_indicator.setFixedSize(8, 8)
        self.token_indicator.setStyleSheet(f"""
            background: {theme.ERROR};
            border-radius: 4px;
        """)

        self.token_label = QLabel("Нет токена")
        self.token_label.setStyleSheet(f"""
            font-size: 13px;
            color: {theme.TEXT_MUTED};
            background: transparent;
        """)

        layout.addWidget(self.status_icon)
        layout.addWidget(self.status_text, 1)
        layout.addWidget(self.token_indicator)
        layout.addWidget(self.token_label)

    def update_status(self, company_name: str = None, device_name: str = None, has_token: bool = False, is_online: bool = False):
        """Обновление статуса с анимацией"""
        if company_name and device_name:
            self.status_icon.setStyleSheet(f"font-size: 16px; color: {theme.SUCCESS}; background: transparent;")
            self.status_text.setText(f"{company_name} • {device_name}")

            if has_token and is_online:
                self.token_indicator.setStyleSheet(f"background: {theme.SUCCESS}; border-radius: 4px;")
                self.token_label.setText("Токен активен")
                self.token_label.setStyleSheet(f"font-size: 13px; color: {theme.SUCCESS}; background: transparent;")
            elif has_token:
                self.token_indicator.setStyleSheet(f"background: {theme.WARNING}; border-radius: 4px;")
                self.token_label.setText("Офлайн режим")
                self.token_label.setStyleSheet(f"font-size: 13px; color: {theme.WARNING}; background: transparent;")
        elif has_token:
            self.status_icon.setStyleSheet(f"font-size: 16px; color: {theme.WARNING}; background: transparent;")
            self.status_text.setText("Токен сохранён, ожидание подключения")
            self.token_indicator.setStyleSheet(f"background: {theme.WARNING}; border-radius: 4px;")
            self.token_label.setText("Токен есть")
            self.token_label.setStyleSheet(f"font-size: 13px; color: {theme.WARNING}; background: transparent;")
        else:
            self.status_icon.setStyleSheet(f"font-size: 16px; color: {theme.ERROR}; background: transparent;")
            self.status_text.setText("Текущая точка: не привязана")
            self.token_indicator.setStyleSheet(f"background: {theme.ERROR}; border-radius: 4px;")
            self.token_label.setText("Нет токена")
            self.token_label.setStyleSheet(f"font-size: 13px; color: {theme.ERROR}; background: transparent;")


class ModernActionButton(QPushButton):
    """Современная кнопка действия с иконкой"""
    def __init__(self, text: str, icon: str = None, variant: str = "default"):
        super().__init__(text)
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self.setMinimumHeight(44)

        # Добавляем иконку если есть
        if icon:
            self.setText(f"{icon}  {text}")

        # Стили для разных вариантов
        styles = {
            "primary": f"""
                QPushButton {{
                    background: {theme.ACCENT};
                    color: white;
                    border: none;
                    border-radius: 12px;
                    font-weight: 600;
                    font-size: 14px;
                    padding: 0 24px;
                }}
                QPushButton:hover {{
                    background: {theme.ACCENT};
                }}
                QPushButton:pressed {{
                    background: {theme.ACCENT};
                }}
            """,
            "success": f"""
                QPushButton {{
                    background: {theme.SUCCESS};
                    color: #0f1f0f;
                    border: none;
                    border-radius: 12px;
                    font-weight: 600;
                    font-size: 14px;
                    padding: 0 24px;
                }}
                QPushButton:hover {{
                    background: {theme.SUCCESS};
                }}
            """,
            "danger": f"""
                QPushButton {{
                    background: transparent;
                    color: {theme.ERROR};
                    border: 1.5px solid {theme.ERROR};
                    border-radius: 12px;
                    font-weight: 600;
                    font-size: 14px;
                    padding: 0 24px;
                }}
                QPushButton:hover {{
                    background: rgba(248,113,113,0.08);
                }}
            """,
            "ghost": f"""
                QPushButton {{
                    background: transparent;
                    color: {theme.TEXT_MUTED};
                    border: 1.5px solid {theme.DIVIDER};
                    border-radius: 12px;
                    font-weight: 500;
                    font-size: 14px;
                    padding: 0 24px;
                }}
                QPushButton:hover {{
                    color: {theme.TEXT};
                    border-color: {theme.TEXT_MUTED};
                }}
            """,
            "default": f"""
                QPushButton {{
                    background: {theme.CARD};
                    color: {theme.TEXT};
                    border: none;
                    border-radius: 12px;
                    font-weight: 500;
                    font-size: 14px;
                    padding: 0 24px;
                }}
                QPushButton:hover {{
                    background: {theme.DIVIDER};
                }}
            """
        }

        self.setStyleSheet(styles.get(variant, styles["default"]))


class DeviceTableWidget(QTableWidget):
    """Улучшенная таблица устройств"""
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setup_style()

    def setup_style(self):
        """Настройка стиля таблицы"""
        self.setShowGrid(False)
        self.setAlternatingRowColors(True)
        self.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        self.setSelectionMode(QTableWidget.SelectionMode.SingleSelection)

        # Дополнительные стили
        self.setStyleSheet(f"""
            QTableWidget {{
                background: {theme.BG};
                border: 1px solid {theme.DIVIDER};
                border-radius: 14px;
                gridline-color: transparent;
                selection-background-color: rgba(124,58,237,0.15);
            }}
            QTableWidget::item {{
                padding: 12px 8px;
                border-bottom: 1px solid {theme.DIVIDER};
            }}
            QTableWidget::item:selected {{
                background: rgba(124,58,237,0.15);
            }}
            QTableWidget::item:hover {{
                background: {theme.CARD};
            }}
            QTableWidget::item:selected:hover {{
                background: rgba(124,58,237,0.2);
            }}
        """)

    def add_status_badge(self, row: int, column: int, status: str):
        """Добавление цветного бейджа статуса"""
        badge = QFrame()
        badge.setFixedSize(8, 8)

        if status == "Активно":
            badge.setStyleSheet(f"background: {theme.SUCCESS}; border-radius: 4px;")
        else:
            badge.setStyleSheet(f"background: {theme.ERROR}; border-radius: 4px;")

        self.setCellWidget(row, column, badge)


class AdminTerminalTab(QWidget):
    """Улучшенная вкладка администратора терминала"""

    # Сигналы для обновления UI
    devices_loaded = pyqtSignal(int)
    device_selected = pyqtSignal(dict)

    def __init__(self, main_window):
        super().__init__(main_window)
        self.main_window = main_window
        self.devices: list[dict] = []
        self.animation_group = []
        self.init_ui()

    def init_ui(self):
        root = QVBoxLayout(self)
        root.setContentsMargins(20, 20, 20, 20)
        root.setSpacing(20)

        # Верхняя информационная панель
        info_container = QFrame()
        info_container.setStyleSheet(f"""
            QFrame {{
                background: rgba(124, 58, 237, 0.05);
                border: 1px solid rgba(124, 58, 237, 0.2);
                border-radius: 12px;
                padding: 12px 16px;
            }}
        """)

        info_layout = QHBoxLayout(info_container)
        info_layout.setContentsMargins(16, 12, 16, 12)

        info_icon = QLabel("i")
        info_icon.setStyleSheet(f"font-size: 16px; color: {theme.ACCENT}; font-weight: 700;")

        self.info_label = QLabel(
            "Super Admin режим. Здесь можно привязать программу к точке "
            "и сохранить device token локально."
        )
        self.info_label.setWordWrap(True)
        self.info_label.setProperty("class", "muted")
        self.info_label.setStyleSheet("font-size: 13px; line-height: 1.5;")

        info_layout.addWidget(info_icon)
        info_layout.addWidget(self.info_label, 1)

        root.addWidget(info_container)

        # Карточка текущего статуса
        self.status_card = ModernStatusCard()
        root.addWidget(self.status_card)

        # Панель действий
        actions_container = QFrame()
        actions_container.setStyleSheet("""
            QFrame {
                background: transparent;
            }
        """)

        actions = QHBoxLayout(actions_container)
        actions.setContentsMargins(0, 0, 0, 0)
        actions.setSpacing(12)

        # Кнопки действий
        self.refresh_btn = ModernActionButton("Обновить устройства", "⟳", "primary")
        self.refresh_btn.clicked.connect(self.load_devices)

        self.apply_btn = ModernActionButton("Привязать точку", "✓", "success")
        self.apply_btn.clicked.connect(self.apply_selected)
        self.apply_btn.setEnabled(False)

        self.clear_btn = ModernActionButton("Сбросить", "✗", "danger")
        self.clear_btn.clicked.connect(self.clear_binding)

        # Статистика устройств
        self.stats_label = QLabel("Устройств: 0")
        self.stats_label.setProperty("class", "muted")
        self.stats_label.setStyleSheet(f"""
            font-size: 13px;
            padding: 8px 16px;
            background: {theme.CARD};
            border-radius: 20px;
        """)

        actions.addWidget(self.refresh_btn)
        actions.addWidget(self.apply_btn)
        actions.addWidget(self.clear_btn)
        actions.addStretch(1)
        actions.addWidget(self.stats_label)

        root.addWidget(actions_container)

        # Таблица устройств
        self.table = DeviceTableWidget()
        self.table.setColumnCount(6)
        self.table.setHorizontalHeaderLabels(["ID", "Точка", "Устройство", "Режим", "Модули", "Статус"])
        self.table.setColumnHidden(0, True)

        # Настройка растяжения колонок
        header = self.table.horizontalHeader()
        header.setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        header.setSectionResizeMode(2, QHeaderView.ResizeMode.Stretch)
        header.setSectionResizeMode(4, QHeaderView.ResizeMode.ResizeToContents)
        header.setSectionResizeMode(5, QHeaderView.ResizeMode.ResizeToContents)

        # Подключение сигнала выбора
        self.table.itemSelectionChanged.connect(self.on_selection_changed)

        root.addWidget(self.table, 1)

        # Подсказка внизу
        hint_container = QFrame()
        hint_container.setStyleSheet(f"""
            QFrame {{
                background: {theme.BG};
                border: 1px solid {theme.DIVIDER};
                border-radius: 10px;
                padding: 8px 12px;
            }}
        """)

        hint_layout = QHBoxLayout(hint_container)
        hint_layout.setContentsMargins(12, 8, 12, 8)

        hint_icon = QLabel("*")
        hint_icon.setStyleSheet(f"font-size: 14px; color: {theme.WARNING}; font-weight: 700;")

        hint_text = QLabel("Выберите устройство из списка и нажмите «Привязать точку»")
        hint_text.setProperty("class", "muted")
        hint_text.setStyleSheet("font-size: 12px;")

        hint_layout.addWidget(hint_icon)
        hint_layout.addWidget(hint_text, 1)

        root.addWidget(hint_container)

        # Обновление статуса
        self.refresh_current_label()

        # Подключение сигналов
        self.devices_loaded.connect(self.update_stats)

    def refresh_current_label(self):
        """Обновление карточки статуса"""
        company = ((self.main_window.bootstrap_data or {}).get("company") or {}) if self.main_window.bootstrap_data else {}
        device = ((self.main_window.bootstrap_data or {}).get("device") or {}) if self.main_window.bootstrap_data else {}
        token = str(self.main_window.config.get("device_token") or "").strip()

        is_online = self.main_window.bootstrap_data is not None

        if company:
            self.status_card.update_status(
                company_name=company.get('name', '—'),
                device_name=device.get('name', 'device'),
                has_token=bool(token),
                is_online=is_online
            )
        elif token:
            self.status_card.update_status(has_token=True, is_online=is_online)
        else:
            self.status_card.update_status()

    def load_devices(self):
        """Загрузка списка устройств"""
        creds = self.main_window.admin_credentials
        if not creds or not self.main_window.api:
            self.show_message("Super Admin", "Сначала войдите как super-admin.", QMessageBox.Icon.Warning)
            return

        # Показываем индикатор загрузки
        self.refresh_btn.setEnabled(False)
        self.refresh_btn.setText("⟳ Загрузка...")

        try:
            response = self.main_window.api.list_admin_devices(creds["email"], creds["password"])
            self.devices = ((response.get("data") or {}).get("devices") or [])

            # Анимируем обновление
            self.animate_table_update()

        except Exception as error:
            self.show_message("Super Admin", str(error), QMessageBox.Icon.Critical)
        finally:
            self.refresh_btn.setEnabled(True)
            self.refresh_btn.setText("⟳ Обновить устройства")

    def animate_table_update(self):
        """Анимированное обновление таблицы"""
        self.table.setRowCount(len(self.devices))

        for row_index, device in enumerate(self.devices):
            company = device.get("company") or {}
            flags = device.get("feature_flags") or {}

            # Форматирование флагов
            flags_text = self.format_feature_flags(flags)
            status = "Активно" if device.get("is_active") else "Выключено"

            # Заполнение ячеек
            self.table.setItem(row_index, 0, QTableWidgetItem(str(device.get("id") or "")))

            # Точка
            company_item = QTableWidgetItem(str(company.get('name') or 'Точка'))
            self.table.setItem(row_index, 1, company_item)

            # Устройство
            device_item = QTableWidgetItem(str(device.get('name') or 'Устройство'))
            self.table.setItem(row_index, 2, device_item)

            # Режим работы
            mode = device.get("point_mode") or "—"
            mode_item = QTableWidgetItem(mode)
            self.table.setItem(row_index, 3, mode_item)

            self.table.setItem(row_index, 4, QTableWidgetItem(flags_text))

            # Статус с цветным индикатором
            status_item = QTableWidgetItem(status)
            if status == "Активно":
                status_item.setForeground(QColor(theme.SUCCESS))
            else:
                status_item.setForeground(QColor(theme.ERROR))
            self.table.setItem(row_index, 5, status_item)

        self.devices_loaded.emit(len(self.devices))
        self.refresh_current_label()

    def format_feature_flags(self, flags: dict) -> str:
        """Форматирование флагов функций"""
        flag_map = {
            "shift_report": "Смена",
            "income_report": "Доход",
            "debt_report": "Долги",
            "inventory": "Инвентарь",
            "analytics": "Аналитика"
        }

        active_flags = [flag_map[key] for key, label in flag_map.items() if flags.get(key)]

        if not active_flags:
            return "Без модулей"

        return " • ".join(active_flags)

    def on_selection_changed(self):
        """Обработка выбора устройства"""
        has_selection = self.table.currentRow() >= 0
        self.apply_btn.setEnabled(has_selection)

        if has_selection:
            device = self.selected_device()
            if device:
                self.device_selected.emit(device)

    def selected_device(self):
        """Получение выбранного устройства"""
        row = self.table.currentRow()
        if row < 0 or row >= len(self.devices):
            return None
        return self.devices[row]

    def apply_selected(self):
        """Применение выбранного устройства"""
        device = self.selected_device()
        if not device:
            self.show_message("Super Admin", "Выберите устройство точки.", QMessageBox.Icon.Information)
            return

        # Подтверждение действия
        company_name = device.get('company', {}).get('name') or 'Точка'
        device_name = device.get('name') or 'Устройство'

        reply = QMessageBox.question(
            self,
            "Подтверждение",
            f"Привязать программу к точке:\n\n{company_name}\n{device_name}?",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No
        )

        if reply != QMessageBox.StandardButton.Yes:
            return

        # Сохранение токена
        self.main_window.config["device_token"] = str(device.get("device_token") or "")
        self.main_window.save_config()

        # Попытка bootstrap
        if not self.main_window.bootstrap_if_possible(show_error=False):
            self.show_message(
                "Super Admin",
                "Точка выбрана, но bootstrap не выполнился. Проверьте устройство и сервер.",
                QMessageBox.Icon.Critical
            )
            return

        self.main_window.build_workspace_for_role()
        self.refresh_current_label()

        # Показываем успех с анимацией
        self.show_success_message(f"Программа привязана к точке {company_name}")

    def clear_binding(self):
        """Сброс привязки"""
        # Проверяем, есть ли что сбрасывать
        token = str(self.main_window.config.get("device_token") or "").strip()
        if not token:
            self.show_message("Super Admin", "Нет активной привязки.", QMessageBox.Icon.Information)
            return

        # Подтверждение
        reply = QMessageBox.question(
            self,
            "Подтверждение",
            "Сбросить локальную привязку точки?\n\nЭто действие не удалит данные на сервере.",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No
        )

        if reply != QMessageBox.StandardButton.Yes:
            return

        # Сброс
        self.main_window.config["device_token"] = ""
        self.main_window.save_config()
        self.main_window.bootstrap_data = None
        self.main_window.build_workspace_for_role()
        self.refresh_current_label()

        self.show_message("Super Admin", "Локальная привязка точки сброшена.", QMessageBox.Icon.Information)

    def update_stats(self, count: int):
        """Обновление статистики"""
        active_count = sum(1 for d in self.devices if d.get("is_active"))
        self.stats_label.setText(f"Всего: {count} • Активно: {active_count}")

    def show_message(self, title: str, text: str, icon: QMessageBox.Icon):
        """Показ сообщения с единым стилем"""
        msg = QMessageBox(self)
        msg.setWindowTitle(title)
        msg.setText(text)
        msg.setIcon(icon)

        # Стилизация сообщения
        msg.setStyleSheet(f"""
            QMessageBox {{
                background: {theme.BG};
            }}
            QMessageBox QLabel {{
                color: {theme.TEXT};
                font-size: 14px;
                min-width: 300px;
            }}
            QPushButton {{
                background: {theme.CARD};
                color: {theme.TEXT};
                border: none;
                border-radius: 8px;
                padding: 8px 20px;
                font-weight: 600;
                min-width: 80px;
            }}
            QPushButton:hover {{
                background: {theme.DIVIDER};
            }}
        """)

        msg.exec()

    def show_success_message(self, text: str):
        """Показ сообщения об успехе"""
        msg = QMessageBox(self)
        msg.setWindowTitle("Успешно")
        msg.setText(text)
        msg.setIcon(QMessageBox.Icon.Information)
        msg.setStyleSheet(f"""
            QMessageBox {{
                background: {theme.BG};
            }}
            QMessageBox QLabel {{
                color: {theme.SUCCESS};
                font-size: 14px;
                min-width: 300px;
            }}
            QPushButton {{
                background: {theme.SUCCESS};
                color: white;
                border: none;
                border-radius: 8px;
                padding: 8px 20px;
                font-weight: 600;
            }}
            QPushButton:hover {{
                background: #22c55e;
            }}
        """)
        msg.exec()
