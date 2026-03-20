"""
Debt management tab for Orda Control Point
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional, List, Dict, Any, Tuple
from enum import Enum

import theme
from PyQt6.QtCore import QDate, Qt, QTimer, pyqtSignal
from PyQt6.QtGui import QIntValidator, QColor, QPalette, QFont, QIcon
from utils import parse_money, format_money
from PyQt6.QtWidgets import (
    QComboBox,
    QDateEdit,
    QGridLayout,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMessageBox,
    QPlainTextEdit,
    QPushButton,
    QSpinBox,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
    QHeaderView,
    QFrame,
    QSplitter,
    QProgressBar,
)


# ==================== Вспомогательные функции ====================

def get_status_color(status: str) -> str:
    """Получение цвета для статуса"""
    colors = {
        "active": theme.SUCCESS,
        "pending": theme.WARNING,
        "deleted": theme.ERROR,
        "paid": "#3B82F6"
    }
    return colors.get(status.lower(), theme.TEXT_MUTED)


class DebtStatus(Enum):
    """Статусы долга"""
    ACTIVE = "active"
    PENDING = "pending"
    DELETED = "deleted"
    PAID = "paid"

    def display_name(self) -> str:
        names = {
            "active": "Активен",
            "pending": "В очереди",
            "deleted": "Удалён",
            "paid": "Оплачен"
        }
        return names.get(self.value, self.value)

    def color(self) -> str:
        return get_status_color(self.value)


# ==================== Современные UI компоненты ====================

class DebtCard(QFrame):
    """Карточка для отображения краткой статистики долгов"""

    def __init__(self, title: str, value: str, icon: str, color: str, parent=None):
        super().__init__(parent)
        self.setProperty("class", "debt-card")

        self.setStyleSheet(f"""
            DebtCard {{
                background: {theme.CARD};
                border: 1px solid {theme.DIVIDER};
                border-radius: 16px;
                border-left: 4px solid {color};
            }}
        """)

        layout = QHBoxLayout(self)
        layout.setContentsMargins(16, 14, 16, 14)
        layout.setSpacing(12)

        # Иконка
        icon_label = QLabel(icon)
        icon_label.setStyleSheet("font-size: 24px; background: transparent;")

        # Текстовый контейнер
        text_container = QVBoxLayout()
        text_container.setSpacing(4)

        title_label = QLabel(title)
        title_label.setProperty("class", "muted")
        title_label.setStyleSheet("font-size: 12px; background: transparent;")

        value_label = QLabel(value)
        value_label.setStyleSheet(f"""
            font-size: 20px;
            font-weight: 700;
            color: {color};
            background: transparent;
        """)

        text_container.addWidget(title_label)
        text_container.addWidget(value_label)

        layout.addWidget(icon_label)
        layout.addLayout(text_container, 1)


class ModernDebtForm(QGroupBox):
    """Современная форма добавления долга"""

    # Сигналы
    debt_added = pyqtSignal(dict)

    def __init__(self, parent=None):
        super().__init__("Добавить новый долг", parent)
        self.setup_ui()

    def setup_ui(self):
        self.setStyleSheet(f"""
            ModernDebtForm {{
                border: 1px solid {theme.DIVIDER};
                border-radius: 16px;
                margin-top: 16px;
                font-weight: 600;
                color: {theme.ACCENT};
                background: {theme.CARD};
                padding: 16px;
            }}
            ModernDebtForm::title {{
                subcontrol-origin: margin;
                left: 16px;
                padding: 0 10px;
                background: {theme.BG};
            }}
        """)

        layout = QGridLayout(self)
        layout.setVerticalSpacing(16)
        layout.setHorizontalSpacing(12)

        # === Строка 1: Оператор / Клиент ===
        # Оператор
        operator_label = QLabel("Оператор")
        operator_label.setProperty("class", "accent")
        operator_label.setStyleSheet("font-size: 13px; font-weight: 600;")

        self.operator_box = QComboBox()
        self.operator_box.setMinimumHeight(40)
        self.operator_box.currentIndexChanged.connect(self.on_target_changed)

        # Или клиент
        or_label = QLabel("или")
        or_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        or_label.setProperty("class", "muted")

        self.manual_name = QLineEdit()
        self.manual_name.setPlaceholderText("Имя клиента вручную")
        self.manual_name.setMinimumHeight(40)

        layout.addWidget(operator_label, 0, 0)
        layout.addWidget(self.operator_box, 0, 1)
        layout.addWidget(or_label, 0, 2)
        layout.addWidget(self.manual_name, 0, 3)

        # === Строка 2: Товар / причина ===
        item_label = QLabel("Товар / причина")
        item_label.setProperty("class", "accent")
        item_label.setStyleSheet("font-size: 13px; font-weight: 600;")

        self.item_name = QLineEdit()
        self.item_name.setPlaceholderText("Например: Рис, Доширак, ...")
        self.item_name.setMinimumHeight(40)

        layout.addWidget(item_label, 1, 0)
        layout.addWidget(self.item_name, 1, 1, 1, 3)

        # === Строка 3: Количество и Цена ===
        qty_label = QLabel("Количество")
        qty_label.setProperty("class", "accent")
        qty_label.setStyleSheet("font-size: 13px; font-weight: 600;")

        self.qty_spin = QSpinBox()
        self.qty_spin.setRange(1, 999)
        self.qty_spin.setValue(1)
        self.qty_spin.setMinimumHeight(40)
        self.qty_spin.valueChanged.connect(self.update_total)

        price_label = QLabel("Цена")
        price_label.setProperty("class", "accent")
        price_label.setStyleSheet("font-size: 13px; font-weight: 600;")

        self.price_input = QLineEdit("0")
        self.price_input.setValidator(QIntValidator(0, 9_999_999))
        self.price_input.setMinimumHeight(40)
        self.price_input.textChanged.connect(self.update_total)

        layout.addWidget(qty_label, 2, 0)
        layout.addWidget(self.qty_spin, 2, 1)
        layout.addWidget(price_label, 2, 2)
        layout.addWidget(self.price_input, 2, 3)

        # === Строка 4: Дата и Итого ===
        date_label = QLabel("Дата")
        date_label.setProperty("class", "accent")
        date_label.setStyleSheet("font-size: 13px; font-weight: 600;")

        self.debt_date = QDateEdit()
        self.debt_date.setCalendarPopup(True)
        self.debt_date.setDate(QDate.currentDate())
        self.debt_date.setMinimumHeight(40)

        total_label = QLabel("Итого")
        total_label.setProperty("class", "accent")
        total_label.setStyleSheet("font-size: 13px; font-weight: 600;")

        self.total_display = QFrame()
        self.total_display.setStyleSheet(f"""
            QFrame {{
                background: {theme.CARD};
                border: 1px solid {theme.DIVIDER};
                border-radius: 10px;
                padding: 8px 12px;
            }}
        """)

        total_layout = QHBoxLayout(self.total_display)
        total_layout.setContentsMargins(12, 0, 12, 0)

        self.total_label = QLabel("0 ₸")
        self.total_label.setAlignment(Qt.AlignmentFlag.AlignRight)
        self.total_label.setStyleSheet(f"""
            font-size: 18px;
            font-weight: 700;
            color: {theme.WARNING};
            background: transparent;
        """)

        total_layout.addWidget(self.total_label)

        layout.addWidget(date_label, 3, 0)
        layout.addWidget(self.debt_date, 3, 1)
        layout.addWidget(total_label, 3, 2)
        layout.addWidget(self.total_display, 3, 3)

        # === Строка 5: Комментарий ===
        comment_label = QLabel("Комментарий")
        comment_label.setProperty("class", "accent")
        comment_label.setStyleSheet("font-size: 13px; font-weight: 600;")

        self.comment_edit = QPlainTextEdit()
        self.comment_edit.setPlaceholderText("Дополнительная информация о долге...")
        self.comment_edit.setMinimumHeight(80)
        self.comment_edit.setStyleSheet(f"""
            QPlainTextEdit {{
                background: {theme.CARD};
                border: 1px solid {theme.DIVIDER};
                border-radius: 12px;
                padding: 10px;
                font-size: 13px;
            }}
        """)

        layout.addWidget(comment_label, 4, 0, Qt.AlignmentFlag.AlignTop)
        layout.addWidget(self.comment_edit, 4, 1, 1, 3)

        # Настройка растяжения колонок
        layout.setColumnStretch(1, 2)
        layout.setColumnStretch(3, 2)

    def on_target_changed(self):
        """Обработка изменения выбора оператора"""
        has_operator = self.selected_operator() is not None
        self.manual_name.setEnabled(not has_operator)
        if has_operator:
            self.manual_name.clear()

    def selected_operator(self) -> Optional[Dict]:
        """Получение выбранного оператора"""
        data = self.operator_box.currentData()
        return data if isinstance(data, dict) else None

    def selected_operator_id(self) -> Optional[str]:
        """Получение ID выбранного оператора"""
        operator = self.selected_operator()
        return str(operator.get("id")) if operator and operator.get("id") else None

    def update_total(self):
        """Обновление отображения итоговой суммы"""
        total = self.qty_spin.value() * parse_money(self.price_input.text())
        self.total_label.setText(f"{format_money(total)} ₸")

    def get_payload(self) -> Optional[Dict]:
        """Получение данных формы для отправки"""
        operator = self.selected_operator()
        operator_id = self.selected_operator_id()

        # Определение имени клиента
        client_name = self.manual_name.text().strip()
        if operator:
            client_name = (
                operator.get("full_name")
                or operator.get("name")
                or operator.get("short_name")
                or client_name
            )

        item_name = self.item_name.text().strip()
        quantity = self.qty_spin.value()
        unit_price = parse_money(self.price_input.text())
        total_amount = quantity * unit_price

        # Валидация
        if not client_name:
            QMessageBox.warning(self, "Долг", "Выберите оператора точки или введите имя клиента.")
            return None

        if not item_name:
            QMessageBox.warning(self, "Долг", "Укажите товар или причину долга.")
            return None

        if total_amount <= 0:
            QMessageBox.warning(self, "Долг", "Сумма долга должна быть больше нуля.")
            return None

        return {
            "operator_id": operator_id,
            "client_name": client_name,
            "item_name": item_name,
            "quantity": quantity,
            "unit_price": unit_price,
            "total_amount": total_amount,
            "comment": self.comment_edit.toPlainText().strip() or None,
            "occurred_at": self.debt_date.date().toString("yyyy-MM-dd"),
            "local_ref": uuid.uuid4().hex,
        }

    def clear(self):
        """Очистка формы"""
        self.operator_box.setCurrentIndex(0)
        self.manual_name.clear()
        self.item_name.clear()
        self.qty_spin.setValue(1)
        self.price_input.setText("0")
        self.debt_date.setDate(QDate.currentDate())
        self.comment_edit.clear()
        self.update_total()

    def set_operators(self, operators: List[Dict], current_id: Optional[str] = None):
        """Установка списка операторов"""
        self.operator_box.blockSignals(True)
        self.operator_box.clear()

        # Опция ручного ввода
        self.operator_box.addItem("Ручной ввод", None)

        # Операторы
        for operator in operators:
            name = (
                operator.get("full_name")
                or operator.get("name")
                or operator.get("short_name")
                or "Оператор"
            )
            role = operator.get("role_in_company") or "operator"
            self.operator_box.addItem(f"{name} • {role}", operator)

        # Восстановление выбранного оператора
        if current_id:
            for index in range(self.operator_box.count()):
                data = self.operator_box.itemData(index)
                if isinstance(data, dict) and str(data.get("id")) == current_id:
                    self.operator_box.setCurrentIndex(index)
                    break

        self.operator_box.blockSignals(False)
        self.on_target_changed()

    def load_draft(self, draft: Dict):
        """Загрузка черновика"""
        operator_id = str(draft.get("selected_operator_id") or "")
        if operator_id:
            for index in range(self.operator_box.count()):
                data = self.operator_box.itemData(index)
                if isinstance(data, dict) and str(data.get("id")) == operator_id:
                    self.operator_box.setCurrentIndex(index)
                    break

        self.manual_name.setText(str(draft.get("manual_name") or ""))
        self.item_name.setText(str(draft.get("item_name") or ""))
        self.qty_spin.setValue(int(draft.get("quantity") or 1))
        self.price_input.setText(str(draft.get("unit_price") or "0"))
        self.comment_edit.setPlainText(str(draft.get("comment") or ""))

        if draft.get("date"):
            parsed = QDate.fromString(str(draft["date"]), "yyyy-MM-dd")
            if parsed.isValid():
                self.debt_date.setDate(parsed)

        self.on_target_changed()
        self.update_total()

    def to_draft(self) -> Dict:
        """Сохранение в черновик"""
        return {
            "selected_operator_id": self.selected_operator_id(),
            "manual_name": self.manual_name.text(),
            "item_name": self.item_name.text(),
            "quantity": self.qty_spin.value(),
            "unit_price": self.price_input.text(),
            "comment": self.comment_edit.toPlainText(),
            "date": self.debt_date.date().toString("yyyy-MM-dd"),
        }


class DebtTableWidget(QTableWidget):
    """Улучшенная таблица долгов"""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setup_style()

    def setup_style(self):
        """Настройка стиля таблицы"""
        self.setShowGrid(False)
        self.setAlternatingRowColors(True)
        self.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        self.setSelectionMode(QTableWidget.SelectionMode.SingleSelection)
        self.setVerticalScrollMode(QTableWidget.ScrollMode.ScrollPerPixel)

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

        # Настройка заголовков
        header = self.horizontalHeader()
        header.setStyleSheet(f"""
            QHeaderView::section {{
                background: {theme.BG};
                color: {theme.TEXT_MUTED};
                border: none;
                border-bottom: 2px solid {theme.DIVIDER};
                padding: 14px 8px;
                font-weight: 700;
                font-size: 13px;
            }}
        """)

    def add_status_badge(self, row: int, column: int, status: str):
        """Добавление цветного бейджа статуса"""
        badge = QFrame()
        badge.setFixedSize(8, 8)
        badge.setStyleSheet(f"background: {get_status_color(status)}; border-radius: 4px;")

        container = QWidget()
        layout = QHBoxLayout(container)
        layout.setContentsMargins(8, 0, 0, 0)
        layout.addWidget(badge)
        layout.addStretch()

        self.setCellWidget(row, column, container)

    def resize_columns_to_content(self):
        """Автоматическое изменение размера колонок"""
        header = self.horizontalHeader()
        header.setSectionResizeMode(0, QHeaderView.ResizeMode.ResizeToContents)  # ID
        header.setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)  # Должник
        header.setSectionResizeMode(2, QHeaderView.ResizeMode.Stretch)  # Товар
        header.setSectionResizeMode(3, QHeaderView.ResizeMode.ResizeToContents)  # Кол-во
        header.setSectionResizeMode(4, QHeaderView.ResizeMode.ResizeToContents)  # Цена
        header.setSectionResizeMode(5, QHeaderView.ResizeMode.ResizeToContents)  # Сумма
        header.setSectionResizeMode(6, QHeaderView.ResizeMode.ResizeToContents)  # Статус


# ==================== Основной класс вкладки ====================

class DebtTab(QWidget):
    """
    Улучшенная вкладка управления долгами

    Особенности:
    - Современный дизайн
    - Карточки статистики
    - Улучшенная форма ввода
    - Цветовая индикация статусов
    - Анимации
    """

    def __init__(self, main_window):
        super().__init__(main_window)
        self.main_window = main_window
        self.items: List[Dict] = []
        self.filtered_items: List[Dict] = []
        self.current_filter = "all"

        self.init_ui()
        self.load_draft()

    def init_ui(self):
        """Инициализация интерфейса"""
        root = QVBoxLayout(self)
        root.setContentsMargins(20, 20, 20, 20)
        root.setSpacing(20)

        # === Верхняя панель с карточками статистики ===
        stats_layout = QHBoxLayout()
        stats_layout.setSpacing(16)

        self.total_debts_card = DebtCard(
            "Всего долгов", "0", "*", "#3B82F6"
        )
        self.active_debts_card = DebtCard(
            "Активных", "0", "+", theme.SUCCESS
        )
        self.pending_debts_card = DebtCard(
            "В очереди", "0", "~", theme.WARNING
        )
        self.total_amount_card = DebtCard(
            "Общая сумма", "0 ₸", "$", theme.WARNING
        )

        stats_layout.addWidget(self.total_debts_card)
        stats_layout.addWidget(self.active_debts_card)
        stats_layout.addWidget(self.pending_debts_card)
        stats_layout.addWidget(self.total_amount_card)

        root.addLayout(stats_layout)

        # === Форма добавления долга ===
        self.debt_form = ModernDebtForm()
        root.addWidget(self.debt_form)

        # === Панель действий ===
        actions_layout = QHBoxLayout()
        actions_layout.setSpacing(12)

        # Левая группа кнопок
        left_actions = QHBoxLayout()
        left_actions.setSpacing(8)

        self.add_btn = QPushButton("Добавить долг")
        self.add_btn.setProperty("class", "success")
        self.add_btn.setMinimumHeight(44)
        self.add_btn.clicked.connect(self.add_debt)

        self.clear_btn = QPushButton("Очистить форму")
        self.clear_btn.setProperty("class", "ghost")
        self.clear_btn.setMinimumHeight(44)
        self.clear_btn.clicked.connect(self.clear_form)

        left_actions.addWidget(self.add_btn)
        left_actions.addWidget(self.clear_btn)

        # Правая группа кнопок
        right_actions = QHBoxLayout()
        right_actions.setSpacing(8)

        self.refresh_btn = QPushButton("⟳ Обновить")
        self.refresh_btn.setProperty("class", "ghost")
        self.refresh_btn.setMinimumHeight(44)
        self.refresh_btn.clicked.connect(self.load_debts)

        self.delete_btn = QPushButton("Удалить")
        self.delete_btn.setProperty("class", "danger")
        self.delete_btn.setMinimumHeight(44)
        self.delete_btn.clicked.connect(self.delete_selected)

        # Фильтр статусов
        self.filter_combo = QComboBox()
        self.filter_combo.addItems(["Все", "Активные", "В очереди", "Оплаченные"])
        self.filter_combo.setMinimumHeight(44)
        self.filter_combo.setMinimumWidth(120)
        self.filter_combo.currentTextChanged.connect(self.apply_filter)

        right_actions.addWidget(self.refresh_btn)
        right_actions.addWidget(self.delete_btn)
        right_actions.addWidget(self.filter_combo)

        actions_layout.addLayout(left_actions)
        actions_layout.addStretch(1)
        actions_layout.addLayout(right_actions)

        root.addLayout(actions_layout)

        # === Информационная строка ===
        info_container = QFrame()
        info_container.setStyleSheet(f"""
            QFrame {{
                background: rgba(124, 58, 237, 0.05);
                border: 1px solid rgba(124, 58, 237, 0.2);
                border-radius: 10px;
                padding: 8px 12px;
            }}
        """)

        info_layout = QHBoxLayout(info_container)
        info_layout.setContentsMargins(12, 8, 12, 8)

        info_icon = QLabel("i")
        info_icon.setStyleSheet(f"font-size: 14px; color: {theme.ACCENT}; font-weight: 700;")

        self.info_label = QLabel("Загрузка списка долгов...")
        self.info_label.setProperty("class", "muted")
        self.info_label.setStyleSheet("font-size: 13px;")

        info_layout.addWidget(info_icon)
        info_layout.addWidget(self.info_label, 1)

        root.addWidget(info_container)

        # === Таблица долгов ===
        self.table = DebtTableWidget()
        self.table.setColumnCount(7)
        self.table.setHorizontalHeaderLabels([
            "ID", "Должник", "Товар", "Кол-во", "Цена", "Сумма", "Статус"
        ])
        self.table.setColumnHidden(0, True)  # Скрываем ID
        self.table.resize_columns_to_content()

        # Двойной клик для редактирования (можно добавить позже)
        self.table.doubleClicked.connect(self.on_item_double_clicked)

        root.addWidget(self.table, 1)

        # === Загрузка данных ===
        self.update_operator_choices()
        self.update_total()

    def update_operator_choices(self):
        """Обновление списка операторов"""
        operators = ((self.main_window.bootstrap_data or {}).get("operators") or [])
        current_id = self.selected_operator_id()

        self.debt_form.set_operators(operators, current_id)

    def selected_operator_id(self) -> Optional[str]:
        """Получение ID выбранного оператора"""
        return self.debt_form.selected_operator_id()

    def update_total(self):
        """Обновление итоговой суммы в форме"""
        self.debt_form.update_total()

    def set_operator_enabled(self, enabled: bool):
        """Включение/отключение вкладки"""
        self.setEnabled(enabled)
        if enabled:
            self.load_debts()
            self.update_operator_choices()

    def add_debt(self):
        """Добавление нового долга"""
        if not self.main_window.current_operator:
            self.show_warning("Долг", "Сначала войдите как оператор.")
            return

        if not self.main_window.api:
            self.show_warning("Долг", "Сначала подключите точку.")
            return

        payload = self.debt_form.get_payload()
        if not payload:
            return

        try:
            self.main_window.api.create_debt(payload)
            self.show_success("Долг", "Долг сохранён в Orda Control.")
            self.debt_form.clear()
            self.load_debts()
            self.save_draft()

        except Exception as error:
            # Сохраняем в оффлайн-очередь
            self.main_window.queue.enqueue_debt_action("createDebt", payload)
            self.main_window.refresh_queue_label()
            self.save_draft()
            self.load_debts()

            self.show_warning(
                "Оффлайн-очередь",
                f"Долг сохранён локально и будет отправлен позже.\n\n{error}"
            )

    def delete_selected(self):
        """Удаление выбранного долга"""
        row = self.table.currentRow()
        if row < 0:
            self.show_info("Долг", "Выберите запись для удаления.")
            return

        item = self.items[row]

        # Подтверждение удаления
        reply = QMessageBox.question(
            self,
            "Подтверждение",
            f"Удалить долг для {item.get('debtor_name', 'клиента')}?",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No
        )

        if reply != QMessageBox.StandardButton.Yes:
            return

        item_id = str(item.get("id") or "")

        # Локальный долг (в очереди)
        if item_id.startswith("local-"):
            queue_id = int(item_id.split("-", 1)[1])
            self.main_window.queue.remove_debt_action(queue_id)
            self.main_window.refresh_queue_label()
            self.load_debts()
            self.show_info("Долг", "Локальный долг удалён из очереди.")
            return

        # Долг на сервере
        if not self.main_window.api:
            self.show_warning("Долг", "Сначала подключите точку.")
            return

        try:
            self.main_window.api.delete_debt(item_id)
            self.load_debts()
            self.show_success("Долг", "Запись удалена с сервера.")

        except Exception as error:
            # Сохраняем удаление в очередь
            self.main_window.queue.enqueue_debt_action("deleteDebt", {"item_id": item_id})
            self.main_window.refresh_queue_label()
            self.load_debts()

            self.show_warning(
                "Оффлайн-очередь",
                f"Удаление сохранено в очередь и будет выполнено позже.\n\n{error}"
            )

    def load_debts(self):
        """Загрузка списка долгов"""
        if not self.main_window.api:
            self.items = []
            self.update_table()
            return

        # Получаем ожидающие действия
        pending_items, pending_deletes = self.pending_debt_view()

        try:
            response = self.main_window.api.list_debts()
            items = ((response.get("data") or {}).get("items") or [])

            # Фильтруем удалённые
            filtered = [item for item in items if str(item.get("id")) not in pending_deletes]

            # Объединяем с ожидающими
            self.items = pending_items + filtered

            # Обновляем статистику
            self.update_statistics()

        except Exception as error:
            self.items = pending_items
            self.info_label.setText(f"Сервер недоступен: {error}")

        # Обновляем таблицу
        self.update_table()
        self.apply_filter()

    def pending_debt_view(self) -> Tuple[List[Dict], set]:
        """Получение списка ожидающих долгов"""
        pending_actions = self.main_window.queue.list_pending_debt_actions(200)
        pending_items: List[Dict] = []
        pending_deletes: set = set()

        for action in pending_actions:
            payload = action.get("payload") or {}

            if action.get("action") == "deleteDebt":
                item_id = str(payload.get("item_id") or "").strip()
                if item_id:
                    pending_deletes.add(item_id)
                continue

            if action.get("action") != "createDebt":
                continue

            qty = int(payload.get("quantity") or 1)
            unit_price = int(payload.get("unit_price") or 0)
            total_amount = int(payload.get("total_amount") or qty * unit_price)

            pending_items.append({
                "id": f"local-{action['id']}",
                "debtor_name": str(payload.get("client_name") or "Должник"),
                "item_name": str(payload.get("item_name") or "Новая запись"),
                "quantity": qty,
                "unit_price": unit_price,
                "total_amount": total_amount,
                "status": DebtStatus.PENDING.value,
            })

        return pending_items, pending_deletes

    def update_table(self):
        """Обновление таблицы"""
        self.table.setRowCount(len(self.filtered_items if hasattr(self, 'filtered_items') else self.items))

        items_to_show = self.filtered_items if hasattr(self, 'filtered_items') and self.filtered_items else self.items

        for row_index, item in enumerate(items_to_show):
            # ID (скрыт)
            self.table.setItem(row_index, 0, QTableWidgetItem(str(item.get("id") or "")))

            # Должник
            debtor_name = str(item.get("debtor_name") or item.get("client_name") or "")
            debtor_item = QTableWidgetItem(debtor_name)
            self.table.setItem(row_index, 1, debtor_item)

            # Товар
            item_name = str(item.get("item_name") or "")
            item_item = QTableWidgetItem(item_name)
            self.table.setItem(row_index, 2, item_item)

            # Количество
            qty_item = QTableWidgetItem(str(item.get("quantity") or 0))
            qty_item.setTextAlignment(Qt.AlignmentFlag.AlignRight)
            self.table.setItem(row_index, 3, qty_item)

            # Цена
            price = int(item.get("unit_price") or 0)
            price_item = QTableWidgetItem(f"{format_money(price)} ₸")
            price_item.setTextAlignment(Qt.AlignmentFlag.AlignRight)
            self.table.setItem(row_index, 4, price_item)

            # Сумма
            amount = int(item.get("total_amount") or 0)
            amount_item = QTableWidgetItem(f"{format_money(amount)} ₸")
            amount_item.setTextAlignment(Qt.AlignmentFlag.AlignRight)

            # Выделение цветом для крупных сумм
            if amount > 100000:
                amount_item.setForeground(QColor(theme.WARNING))
            elif amount > 50000:
                amount_item.setForeground(QColor("#3B82F6"))

            self.table.setItem(row_index, 5, amount_item)

            # Статус с бейджем
            status = item.get("status", DebtStatus.ACTIVE.value)
            status_display = DebtStatus(status).display_name() if status in [s.value for s in DebtStatus] else status

            status_item = QTableWidgetItem(status_display)
            status_item.setForeground(QColor(get_status_color(status)))
            self.table.setItem(row_index, 6, status_item)

            # Добавляем цветной бейдж
            self.table.add_status_badge(row_index, 6, status)

    def update_statistics(self):
        """Обновление карточек статистики"""
        total = len(self.items)
        active = sum(1 for i in self.items if i.get("status") == DebtStatus.ACTIVE.value)
        pending = sum(1 for i in self.items if i.get("status") == DebtStatus.PENDING.value)
        total_amount = sum(int(i.get("total_amount") or 0) for i in self.items)

        self.total_debts_card.findChild(QLabel, "", Qt.FindChildOption.FindChildrenRecursively).setText(str(total))
        self.active_debts_card.findChild(QLabel, "", Qt.FindChildOption.FindChildrenRecursively).setText(str(active))
        self.pending_debts_card.findChild(QLabel, "", Qt.FindChildOption.FindChildrenRecursively).setText(str(pending))
        self.total_amount_card.findChild(QLabel, "", Qt.FindChildOption.FindChildrenRecursively).setText(f"{format_money(total_amount)} ₸")

        self.info_label.setText(
            f"Всего: {total} • Активных: {active} • В очереди: {pending} • Сумма: {format_money(total_amount)} ₸"
        )

    def apply_filter(self, filter_text: str = None):
        """Применение фильтра к таблице"""
        if filter_text is None:
            filter_text = self.filter_combo.currentText()

        self.current_filter = filter_text.lower()

        if self.current_filter == "все":
            self.filtered_items = self.items
        else:
            status_map = {
                "активные": DebtStatus.ACTIVE.value,
                "в очереди": DebtStatus.PENDING.value,
                "оплаченные": DebtStatus.PAID.value
            }

            target_status = status_map.get(self.current_filter)
            if target_status:
                self.filtered_items = [i for i in self.items if i.get("status") == target_status]
            else:
                self.filtered_items = self.items

        self.update_table()

    def on_item_double_clicked(self):
        """Обработка двойного клика по элементу"""
        # TODO: Добавить редактирование долга
        pass

    def save_draft(self):
        """Сохранение черновика"""
        self.main_window.config["debt_draft"] = self.debt_form.to_draft()
        self.main_window.save_config()

    def load_draft(self):
        """Загрузка черновика"""
        draft = self.main_window.config.get("debt_draft") or {}
        self.debt_form.load_draft(draft)

    def clear_form(self):
        """Очистка формы"""
        self.debt_form.clear()
        self.save_draft()

    # ==================== Вспомогательные методы ====================

    def show_warning(self, title: str, message: str):
        """Показ предупреждения"""
        QMessageBox.warning(self, title, message)

    def show_info(self, title: str, message: str):
        """Показ информации"""
        QMessageBox.information(self, title, message)

    def show_success(self, title: str, message: str):
        """Показ сообщения об успехе"""
        msg = QMessageBox(self)
        msg.setWindowTitle(title)
        msg.setText(message)
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
