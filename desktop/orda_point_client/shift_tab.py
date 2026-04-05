"""
Shift report tab for Orda Control Point
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional, Dict, Any, List, Tuple
from enum import Enum

import requests
from PyQt6.QtCore import QDate, Qt, QThread, pyqtSignal, QTimer, QPropertyAnimation, QEasingCurve
from utils import parse_money, format_money
from PyQt6.QtGui import QIntValidator, QColor, QFont, QDoubleValidator
from PyQt6.QtWidgets import (
    QDateEdit,
    QGridLayout,
    QGroupBox,
    QHBoxLayout,
    QInputDialog,
    QLabel,
    QLineEdit,
    QMessageBox,
    QPlainTextEdit,
    QPushButton,
    QVBoxLayout,
    QWidget,
    QFrame,
    QSplitter,
    QProgressBar,
    QApplication,
    QCheckBox,
)
import theme


# ==================== Вспомогательные функции ====================

def is_last_day_of_month(qdate: QDate) -> bool:
    """Проверка, является ли дата последним днём месяца"""
    return qdate.day() == qdate.daysInMonth()


class ShiftType(Enum):
    """Тип смены"""
    DAY = "day"
    NIGHT = "night"
    
    def display_name(self) -> str:
        names = {
            "day": "Дневная смена",
            "night": "Ночная смена"
        }
        return names.get(self.value, self.value)
    
    def icon(self) -> str:
        icons = {
            "day": "🌞",
            "night": "🌙"
        }
        return icons.get(self.value, "🕐")
    
    def color(self) -> str:
        colors = {
            "day": "#F59E0B",
            "night": "#3B82F6"
        }
        return colors.get(self.value, theme.TEXT_MUTED)


# ==================== Telegram Worker ====================

class TelegramWorker(QThread):
    """Отправка Telegram сообщения в фоне"""
    
    finished = pyqtSignal(bool, str)
    
    def __init__(self, bot_token: str, chat_id: str, text: str):
        super().__init__()
        self.bot_token = bot_token
        self.chat_id = chat_id
        self.text = text

    def run(self):
        try:
            response = requests.post(
                f"https://api.telegram.org/bot{self.bot_token}/sendMessage",
                json={
                    "chat_id": self.chat_id,
                    "text": self.text,
                    "parse_mode": "HTML",
                    "disable_web_page_preview": True
                },
                timeout=10,
            )
            
            if response.status_code == 200:
                self.finished.emit(True, "")
            else:
                self.finished.emit(False, f"HTTP {response.status_code}")
                
        except Exception as e:
            self.finished.emit(False, str(e))


# ==================== Современные UI компоненты ====================

class ResultCard(QFrame):
    """Карточка для отображения результата"""
    
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setup_ui()
        
    def setup_ui(self):
        self.setStyleSheet(
            f"ResultCard {{ background: {theme.CARD}; border: 1px solid {theme.DIVIDER};"
            f" border-radius: {theme.RADIUS_CARD}px; }}"
        )

        layout = QVBoxLayout(self)
        layout.setContentsMargins(theme.PADDING_CARD, theme.PADDING_CARD, theme.PADDING_CARD, theme.PADDING_CARD)
        layout.setSpacing(8)

        title_label = QLabel("Итог смены")
        title_label.setStyleSheet(theme.muted_style(11))

        # Основной результат
        self.result_label = QLabel("0 ₸")
        self.result_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.result_label.setStyleSheet(theme.total_style(theme.TEXT))

        # Детали (формула)
        self.details_label = QLabel("Факт: 0 ₸ — Kaspi: 0 ₸ — Senet: 0 ₸")
        self.details_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.details_label.setStyleSheet(theme.muted_style(12))

        layout.addWidget(title_label)
        layout.addWidget(self.result_label)
        layout.addWidget(self.details_label)
        
    def update_result(self, calc: Dict[str, int]):
        """Обновление результата"""
        diff = calc["diff"]
        
        if diff > 0:
            color = theme.WARNING
            prefix = "+"
        elif diff < 0:
            color = theme.ERROR
            prefix = ""
        else:
            color = theme.SUCCESS
            prefix = ""

        self.result_label.setText(f"{prefix}{format_money(diff)} ₸")
        self.result_label.setStyleSheet(theme.total_style(color))
        
        kaspi_total = calc["kaspi_pos"] + calc["kaspi_online"]
        self.details_label.setText(
            f"Факт: {format_money(calc['actual'])} ₸ • "
            f"Kaspi: {format_money(kaspi_total)} ₸ • "
            f"Senet: {format_money(calc['wipon'])} ₸"
        )


class MoneyInput(QFrame):
    """Поле ввода денежной суммы с улучшенным дизайном"""
    
    value_changed = pyqtSignal()
    
    def __init__(self, label: str, icon: str, color: str = "#3B82F6", parent=None):
        super().__init__(parent)
        self.label = label
        self.icon = icon
        self.color = color
        self.setup_ui()
        
    def setup_ui(self):
        self.setStyleSheet(
            f"MoneyInput {{ background: {theme.CARD}; border: 1px solid {theme.DIVIDER};"
            f" border-radius: {theme.RADIUS_INPUT}px; }}"
        )

        layout = QVBoxLayout(self)
        layout.setContentsMargins(12, theme.GAP_FIELD, 12, theme.GAP_FIELD)
        layout.setSpacing(4)

        label_text = QLabel(self.label.upper())
        label_text.setStyleSheet(theme.label_style())

        self.input = QLineEdit("0")
        self.input.setAlignment(Qt.AlignmentFlag.AlignRight)
        self.input.setValidator(QIntValidator(0, 9_999_999))
        self.input.textChanged.connect(self.on_value_changed)

        layout.addWidget(label_text)
        layout.addWidget(self.input)
        
    def on_value_changed(self):
        """Обработка изменения значения"""
        self.value_changed.emit()
        
    def get_value(self) -> int:
        """Получение числового значения"""
        return parse_money(self.input.text())
        
    def set_value(self, value: int):
        """Установка значения"""
        self.input.setText(str(value))
        
    def clear(self):
        """Очистка поля"""
        self.input.setText("0")


class ShiftSelector(QFrame):
    """Селектор типа смены"""
    
    shift_changed = pyqtSignal(ShiftType)
    
    def __init__(self, parent=None):
        super().__init__(parent)
        self.selected_shift: Optional[ShiftType] = None
        self.setup_ui()
        
    def setup_ui(self):
        self.setStyleSheet(
            f"ShiftSelector {{ background: {theme.CARD}; border: 1px solid {theme.DIVIDER};"
            f" border-radius: {theme.RADIUS_CARD}px; }}"
        )

        layout = QHBoxLayout(self)
        layout.setContentsMargins(4, 4, 4, 4)
        layout.setSpacing(4)

        shift_btn_style = (
            f"QPushButton {{ background: transparent; color: {theme.TEXT_MUTED};"
            f" border: none; border-radius: {theme.RADIUS_BUTTON}px;"
            f" padding: 8px 20px; font-size: {theme.FONT_BUTTON}px; font-weight: 600; }}"
            f"QPushButton:hover {{ color: {theme.TEXT}; }}"
            f"QPushButton:checked {{ background: {theme.ACCENT}; color: white; }}"
        )

        self.day_btn = QPushButton("День")
        self.day_btn.setCheckable(True)
        self.day_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.day_btn.clicked.connect(lambda: self.select_shift(ShiftType.DAY))
        self.day_btn.setStyleSheet(shift_btn_style)

        self.night_btn = QPushButton("Ночь")
        self.night_btn.setCheckable(True)
        self.night_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.night_btn.clicked.connect(lambda: self.select_shift(ShiftType.NIGHT))
        self.night_btn.setStyleSheet(shift_btn_style)

        layout.addWidget(self.day_btn)
        layout.addWidget(self.night_btn)
        
    def select_shift(self, shift: ShiftType):
        """Выбор смены"""
        self.selected_shift = shift
        
        if shift == ShiftType.DAY:
            self.day_btn.setChecked(True)
            self.night_btn.setChecked(False)
        else:
            self.day_btn.setChecked(False)
            self.night_btn.setChecked(True)
            
        self.shift_changed.emit(shift)
        
    def get_shift(self) -> Optional[ShiftType]:
        """Получение выбранной смены"""
        return self.selected_shift
        
    def set_shift(self, shift: Optional[ShiftType]):
        """Установка смены"""
        if shift:
            self.select_shift(shift)
        else:
            self.day_btn.setChecked(False)
            self.night_btn.setChecked(False)
            self.selected_shift = None


# ==================== Основной класс вкладки ====================

class ShiftReportTab(QWidget):
    """
    Улучшенная вкладка сменных отчётов
    
    Особенности:
    - Современный дизайн с карточками
    - Группировка полей по категориям
    - Автоматический расчёт
    - Поддержка разделения ночных смен
    - Telegram уведомления
    - Офлайн-режим
    """
    
    def __init__(self, main_window):
        super().__init__(main_window)
        self.main_window = main_window
        self.inputs: Dict[str, MoneyInput] = {}
        self.selected_shift: Optional[ShiftType] = None
        self._tg_workers: List[TelegramWorker] = []
        
        self.init_ui()
        self.load_draft()
        
    def init_ui(self):
        """Инициализация интерфейса"""
        root = QVBoxLayout(self)
        root.setContentsMargins(20, 20, 20, 20)
        root.setSpacing(20)

        # === Карточка результата ===
        self.result_card = ResultCard()
        root.addWidget(self.result_card)

        # === Основной контент ===
        content = QSplitter(Qt.Orientation.Horizontal)
        content.setStyleSheet(
            f"QSplitter::handle {{ background: {theme.DIVIDER}; width: 1px; }}"
        )

        # Левая колонка - фактические средства
        left_column = QWidget()
        left_layout = QVBoxLayout(left_column)
        left_layout.setContentsMargins(0, 0, 0, 0)
        left_layout.setSpacing(16)
        
        fact_group = QGroupBox("Фактические средства")
        fact_group.setStyleSheet(
            f"QGroupBox {{ border: 1px solid {theme.DIVIDER}; border-radius: {theme.RADIUS_CARD}px;"
            f" margin-top: 14px; font-weight: 600; color: {theme.TEXT_MUTED}; background: {theme.CARD}; }}"
            f"QGroupBox::title {{ subcontrol-origin: margin; left: 12px; padding: 0 6px; background: {theme.CARD}; }}"
        )
        
        fact_layout = QVBoxLayout(fact_group)
        fact_layout.setSpacing(12)
        
        self.inputs["cash"] = MoneyInput("Наличные", "", theme.SUCCESS)
        self.inputs["coins"] = MoneyInput("Мелочь", "", theme.TEXT_MUTED)
        self.inputs["kaspi_pos"] = MoneyInput("Kaspi POS", "", theme.ACCENT)
        self.inputs["kaspi_online"] = MoneyInput("Kaspi Online", "", theme.ACCENT)
        self.inputs["debts"] = MoneyInput("Компенсация / тех", "", theme.TEXT_MUTED)
        
        for input_field in self.inputs.values():
            input_field.value_changed.connect(self.update_calculation)
            fact_layout.addWidget(input_field)
            
        left_layout.addWidget(fact_group)
        
        # Правая колонка - системные данные и мета
        right_column = QWidget()
        right_layout = QVBoxLayout(right_column)
        right_layout.setContentsMargins(0, 0, 0, 0)
        right_layout.setSpacing(16)
        
        sys_group = QGroupBox("Данные системы")
        sys_group.setStyleSheet(fact_group.styleSheet())
        
        sys_layout = QVBoxLayout(sys_group)
        sys_layout.setSpacing(12)
        
        self.inputs["start_cash"] = MoneyInput("Касса утро", "", theme.TEXT_MUTED)
        self.inputs["wipon"] = MoneyInput("Senet (Wipon)", "", theme.TEXT_MUTED)
        
        self.inputs["start_cash"].value_changed.connect(self.update_calculation)
        self.inputs["wipon"].value_changed.connect(self.update_calculation)
        
        sys_layout.addWidget(self.inputs["start_cash"])
        sys_layout.addWidget(self.inputs["wipon"])
        
        right_layout.addWidget(sys_group)
        
        meta_group = QGroupBox("Информация о смене")
        meta_group.setStyleSheet(fact_group.styleSheet())
        
        meta_layout = QVBoxLayout(meta_group)
        meta_layout.setSpacing(16)
        
        # Дата
        date_container = QFrame()
        date_container.setStyleSheet(
            f"QFrame {{ background: {theme.CARD}; border: 1px solid {theme.DIVIDER};"
            f" border-radius: {theme.RADIUS_INPUT}px; }}"
        )

        date_layout = QHBoxLayout(date_container)
        date_layout.setContentsMargins(12, 8, 12, 8)

        date_label = QLabel("ДАТА СМЕНЫ")
        date_label.setStyleSheet(theme.label_style())

        self.date_edit = QDateEdit()
        self.date_edit.setCalendarPopup(True)
        self.date_edit.setDate(QDate.currentDate())

        date_layout.addWidget(date_label)
        date_layout.addWidget(self.date_edit)
        date_layout.addStretch()
        
        meta_layout.addWidget(date_container)
        
        # Селектор смены
        self.shift_selector = ShiftSelector()
        self.shift_selector.shift_changed.connect(self.on_shift_changed)
        meta_layout.addWidget(self.shift_selector)
        
        comment_container = QFrame()
        comment_container.setStyleSheet(
            f"QFrame {{ background: {theme.CARD}; border: 1px solid {theme.DIVIDER};"
            f" border-radius: {theme.RADIUS_INPUT}px; }}"
        )

        comment_layout = QVBoxLayout(comment_container)
        comment_layout.setContentsMargins(12, 8, 12, 8)

        comment_label = QLabel("КОММЕНТАРИЙ")
        comment_label.setStyleSheet(theme.label_style())

        self.comment_edit = QPlainTextEdit()
        self.comment_edit.setPlaceholderText("Дополнительная информация о смене...")
        self.comment_edit.setMaximumHeight(80)

        comment_layout.addWidget(comment_label)
        comment_layout.addWidget(self.comment_edit)
        
        meta_layout.addWidget(comment_container)
        
        right_layout.addWidget(meta_group)
        
        # Добавляем колонки в сплиттер
        content.addWidget(left_column)
        content.addWidget(right_column)
        
        # Устанавливаем пропорции (60% левая, 40% правая)
        content.setSizes([600, 400])
        
        root.addWidget(content, 1)

        # === Панель действий ===
        actions_layout = QHBoxLayout()
        actions_layout.setSpacing(12)
        
        # Левая группа
        left_actions = QHBoxLayout()
        left_actions.setSpacing(8)
        
        self.send_btn = QPushButton("Отправить смену")
        self.send_btn.setProperty("class", "success")
        self.send_btn.setFixedHeight(theme.BUTTON_H)
        self.send_btn.setMinimumWidth(200)
        self.send_btn.clicked.connect(self.submit_shift_report)

        self.clear_btn = QPushButton("Сбросить")
        self.clear_btn.setProperty("class", "ghost")
        self.clear_btn.setFixedHeight(theme.BUTTON_H)
        self.clear_btn.clicked.connect(self.clear_form)
        
        left_actions.addWidget(self.send_btn)
        left_actions.addWidget(self.clear_btn)
        
        # Правая группа
        right_actions = QHBoxLayout()
        right_actions.setSpacing(8)
        
        self.quick_fill_btn = QPushButton("Рассчитать")
        self.quick_fill_btn.setProperty("class", "primary")
        self.quick_fill_btn.setFixedHeight(theme.BUTTON_H)
        self.quick_fill_btn.clicked.connect(self.quick_fill)

        self.telegram_check = QCheckBox("Отправить в Telegram")
        self.telegram_check.setChecked(True)
        self.telegram_check.setStyleSheet(
            f"QCheckBox {{ color: {theme.TEXT}; font-size: {theme.FONT_VALUE}px; spacing: 8px; }}"
            f"QCheckBox::indicator {{ width: 18px; height: 18px; border: 1.5px solid {theme.DIVIDER};"
            f" border-radius: 4px; background: {theme.CARD}; }}"
            f"QCheckBox::indicator:checked {{ background: {theme.ACCENT}; border-color: {theme.ACCENT}; }}"
        )
        
        right_actions.addWidget(self.quick_fill_btn)
        right_actions.addWidget(self.telegram_check)
        
        actions_layout.addLayout(left_actions)
        actions_layout.addStretch()
        actions_layout.addLayout(right_actions)
        
        root.addLayout(actions_layout)

        # === Информационная строка ===
        info_container = QFrame()
        info_container.setStyleSheet(
            f"QFrame {{ background: {theme.CARD}; border: 1px solid {theme.DIVIDER};"
            f" border-radius: {theme.RADIUS_INPUT}px; }}"
        )

        info_layout = QHBoxLayout(info_container)
        info_layout.setContentsMargins(12, 8, 12, 8)

        self.info_label = QLabel("Заполните данные по смене")
        self.info_label.setStyleSheet(theme.muted_style(13))

        self.warning_label = QLabel("")
        self.warning_label.setStyleSheet(
            f"font-size: 12px; color: {theme.WARNING}; background: transparent;"
        )

        info_layout.addWidget(self.info_label, 1)
        info_layout.addWidget(self.warning_label)
        
        root.addWidget(info_container)

        # Первоначальный расчёт
        self.update_calculation()
        
    # ==================== Методы расчёта ====================

    def get_value(self, key: str) -> int:
        """Получение значения поля"""
        return self.inputs[key].get_value()

    def calculation(self) -> Dict[str, int]:
        """Выполнение расчёта"""
        wipon = self.get_value("wipon")
        kaspi_pos = self.get_value("kaspi_pos")
        kaspi_online = self.get_value("kaspi_online")
        debts = self.get_value("debts")
        cash = self.get_value("cash")
        coins = self.get_value("coins")
        start_cash = self.get_value("start_cash")
        
        actual = (cash + coins + kaspi_pos + debts) - start_cash
        diff = actual - wipon
        
        return {
            "wipon": wipon,
            "kaspi_pos": kaspi_pos,
            "kaspi_online": kaspi_online,
            "debts": debts,
            "cash": cash,
            "coins": coins,
            "start_cash": start_cash,
            "actual": actual,
            "diff": diff,
        }

    def update_calculation(self):
        """Обновление расчёта"""
        calc = self.calculation()
        self.result_card.update_result(calc)
        
        cash = calc["cash"]
        if cash > 500_000:
            self.warning_label.setText("Большая сумма наличных")
        elif cash > 300_000:
            self.warning_label.setText("Выше среднего")
        else:
            self.warning_label.setText("")

        if calc["diff"] < 0:
            self.info_label.setText(f"Недостача: {format_money(abs(calc['diff']))} ₸")
            self.info_label.setStyleSheet(f"font-size: 13px; color: {theme.ERROR}; background: transparent;")
        elif calc["diff"] > 0:
            self.info_label.setText(f"Излишек: {format_money(calc['diff'])} ₸")
            self.info_label.setStyleSheet(f"font-size: 13px; color: {theme.WARNING}; background: transparent;")
        else:
            self.info_label.setText("Смена сошлась")
            self.info_label.setStyleSheet(f"font-size: 13px; color: {theme.SUCCESS}; background: transparent;")
            
    def on_shift_changed(self, shift: ShiftType):
        """Обработка изменения смены"""
        self.selected_shift = shift
        self.info_label.setText(f"Выбрана: {shift.display_name()}")
        
    # ==================== Валидация и отправка ====================

    def validate_form(self) -> bool:
        """Валидация формы"""
        if not self.main_window.current_operator:
            QMessageBox.warning(self, "Сменный отчёт", "Сначала войдите как оператор.")
            return False

        if not self.selected_shift:
            QMessageBox.warning(self, "Сменный отчёт", "Выберите тип смены.")
            return False

        total = (
            self.get_value("wipon") +
            self.get_value("kaspi_pos") +
            self.get_value("cash") +
            self.get_value("start_cash")
        )
        
        if total == 0:
            QMessageBox.warning(self, "Сменный отчёт", "Заполните данные по смене.")
            return False

        return True

    def current_payload(self) -> Tuple[Optional[Dict], Optional[Dict]]:
        """Формирование payload для отправки"""
        if not self.main_window.current_operator:
            return None, None

        calc = self.calculation()
        operator_id = self.main_window.current_operator["operator_id"]
        date_str = self.date_edit.date().toString("yyyy-MM-dd")
        
        payload = {
            "date": date_str,
            "operator_id": operator_id,
            "shift": self.selected_shift.value,
            "cash_amount": calc["cash"],
            "kaspi_amount": calc["kaspi_pos"],
            "online_amount": calc["kaspi_online"],
            "card_amount": 0,
            "comment": self.comment_edit.toPlainText().strip() or None,
            "source": "orda-point-client",
            "local_ref": f"{operator_id}:{date_str}:{self.selected_shift.value}",
            "meta": {
                "coins": calc["coins"],
                "debts": calc["debts"],
                "start_cash": calc["start_cash"],
                "wipon": calc["wipon"],
                "diff": calc["diff"],
                "split_mode": False,
                "split_part": None,
                "original_date": date_str,
            },
        }
        
        return payload, calc

    def ask_split(self, payload: Dict, calc: Dict[str, int]) -> Optional[List[Dict]]:
        """Запрос разделения ночной смены"""
        reply = QMessageBox.question(
            self,
            "Разбивка по месяцу",
            "Это последний день месяца и ночная смена.\n"
            "Разбить выручку на две даты (до и после полуночи)?",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
        )
        
        if reply != QMessageBox.StandardButton.Yes:
            return None

        # Диалоги для ввода сумм после полуночи
        kaspi_after, ok1 = QInputDialog.getInt(
            self,
            "Kaspi POS после 00:00",
            f"Kaspi POS за 00:00–08:00 (макс {format_money(calc['kaspi_pos'])} ₸):",
            0,
            0,
            calc["kaspi_pos"],
        )
        if not ok1:
            return None

        online_after, ok2 = QInputDialog.getInt(
            self,
            "Kaspi Online после 00:00",
            f"Online за 00:00–08:00 (макс {format_money(calc['kaspi_online'])} ₸):",
            0,
            0,
            calc["kaspi_online"],
        )
        if not ok2:
            return None

        cash_after, ok3 = QInputDialog.getInt(
            self,
            "Наличные после 00:00",
            f"Наличные за 00:00–08:00 (макс {format_money(calc['cash'])} ₸):",
            0,
            0,
            calc["cash"],
        )
        if not ok3:
            return None

        next_date = self.date_edit.date().addDays(1).toString("yyyy-MM-dd")
        common_meta = payload["meta"]
        
        return [
            {
                **payload,
                "cash_amount": calc["cash"] - cash_after,
                "kaspi_amount": calc["kaspi_pos"] - kaspi_after,
                "online_amount": calc["kaspi_online"] - online_after,
                "meta": {
                    **common_meta,
                    "split_mode": True,
                    "split_part": "before-midnight",
                    "original_date": payload["date"],
                },
            },
            {
                **payload,
                "date": next_date,
                "cash_amount": cash_after,
                "kaspi_amount": kaspi_after,
                "online_amount": online_after,
                "comment": (payload.get("comment") or "") or "Часть ночной смены после 00:00",
                "local_ref": f"{payload['operator_id']}:{next_date}:{payload['shift']}:split",
                "meta": {
                    **common_meta,
                    "split_mode": True,
                    "split_part": "after-midnight",
                    "original_date": payload["date"],
                },
            },
        ]

    def submit_shift_report(self):
        """Отправка отчёта"""
        if not self.validate_form():
            return

        payload, calc = self.current_payload()
        if not payload or calc is None:
            return

        # Проверка на недостачу
        if calc["diff"] < 0:
            reply = QMessageBox.question(
                self,
                "Недостача",
                f"Недостача: {format_money(abs(calc['diff']))} ₸\n\n"
                "Всё равно закрыть смену?",
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            )
            if reply != QMessageBox.StandardButton.Yes:
                return

        if not self.main_window.api:
            QMessageBox.warning(self, "Сменный отчёт", "Сначала подключите точку.")
            return

        # Подготовка пакетов для отправки
        batches = [payload]
        
        if (self.selected_shift == ShiftType.NIGHT and 
            is_last_day_of_month(self.date_edit.date())):
            split_entries = self.ask_split(payload, calc)
            if split_entries is None:
                return
            if split_entries:
                batches = split_entries

        # Отправка
        saved_offline = False
        errors: List[str] = []
        
        for item in batches:
            try:
                self.main_window.api.send_shift_report(item)
            except Exception as error:
                self.main_window.queue.enqueue_shift(item)
                saved_offline = True
                errors.append(str(error))

        self.main_window.refresh_queue_label()
        self.save_draft()

        # Обработка результатов
        if errors and len(errors) == len(batches):
            QMessageBox.warning(
                self,
                "Оффлайн-режим",
                "Нет связи с сервером. Смена сохранена локально и будет отправлена позже.\n\n"
                + "\n".join(errors[:2]),
            )
            return

        if saved_offline:
            QMessageBox.warning(
                self,
                "Частичная отправка",
                "Часть данных отправлена на сервер, часть сохранена в оффлайн-очередь.",
            )
        else:
            QMessageBox.information(
                self,
                "Сменный отчёт",
                "✅ Смена успешно закрыта и отправлена в Orda Control."
            )

        # Отправка в Telegram
        if self.telegram_check.isChecked():
            date_str = self.date_edit.date().toString("yyyy-MM-dd")
            self._send_telegram(calc, date_str)

        self.clear_form()

    # ==================== Telegram ====================

    def _send_telegram(self, calc: Dict[str, int], date_str: str):
        """Отправка уведомления в Telegram"""
        cfg = self.main_window.config
        bot_token = str(cfg.get("telegram_bot_token") or "").strip()
        
        if not bot_token:
            return

        # Получаем chat_id
        operator = self.main_window.current_operator or {}
        personal_chat = str(operator.get("telegram_chat_id") or "").strip()
        group_chat = str(cfg.get("telegram_chat_id") or "").strip()

        company = (self.main_window.bootstrap_data or {}).get("company") or {}
        company_name = company.get("name", "—")
        
        operator_name = (
            operator.get("full_name")
            or operator.get("name")
            or "Оператор"
        )
        
        shift_icon = self.selected_shift.icon() if self.selected_shift else "🕐"
        shift_name = self.selected_shift.display_name() if self.selected_shift else "Смена"
        
        now_str = datetime.now().strftime("%d.%m.%Y %H:%M")

        diff = calc["diff"]
        if diff > 0:
            diff_line = f"📊 <b>ИТОГ: +{format_money(diff)} ₸</b> ✅"
        elif diff < 0:
            diff_line = f"📊 <b>ИТОГ: {format_money(diff)} ₸</b> ⚠️ НЕДОСТАЧА"
        else:
            diff_line = f"📊 <b>ИТОГ: 0 ₸</b> ✓"

        kaspi_total = calc["kaspi_pos"] + calc["kaspi_online"]
        
        lines = [
            f"<b>🧾 СМЕНА ЗАКРЫТА</b>",
            f"{'═' * 30}",
            f"🏢 <b>{company_name}</b>",
            f"👤 {operator_name}",
            f"{shift_icon} {shift_name} • {date_str}",
            f"🕐 {now_str}",
            f"{'═' * 30}",
            f"<b>НАЛИЧНЫЕ:</b>",
            f"  💵 Касса: {format_money(calc['cash'])} ₸",
            f"  🪙 Мелочь: {format_money(calc['coins'])} ₸",
            f"  🚀 Старт: {format_money(calc['start_cash'])} ₸",
            f"{'─' * 30}",
            f"<b>БЕЗНАЛИЧНЫЕ:</b>",
            f"  💳 Kaspi POS: {format_money(calc['kaspi_pos'])} ₸",
            f"  🛒 Kaspi Online: {format_money(calc['kaspi_online'])} ₸",
            f"  💳 Итого: {format_money(kaspi_total)} ₸",
            f"{'─' * 30}",
            f"<b>СИСТЕМА:</b>",
            f"  🖥 Senet: {format_money(calc['wipon'])} ₸",
            f"  🔧 Компенсация: {format_money(calc['debts'])} ₸",
            f"{'═' * 30}",
            diff_line,
        ]
        
        comment = self.comment_edit.toPlainText().strip()
        if comment:
            lines.append(f"💬 {comment}")

        message = "\n".join(lines)

        # Отправка
        for chat_id in filter(None, {personal_chat, group_chat}):
            worker = TelegramWorker(bot_token, chat_id, message)
            worker.finished.connect(self._on_telegram_finished)
            self._tg_workers.append(worker)
            worker.start()

    def _on_telegram_finished(self, success: bool, error: str):
        """Обработка завершения отправки в Telegram"""
        if not success:
            print(f"Telegram send failed: {error}")
        # Удаляем завершённые воркеры чтобы не копить их в памяти
        sender = self.sender()
        if sender in self._tg_workers:
            self._tg_workers.remove(sender)

    # ==================== Работа с черновиками ====================

    def save_draft(self):
        """Сохранение черновика"""
        self.main_window.config["draft"] = {
            "date": self.date_edit.date().toString("yyyy-MM-dd"),
            "selected_shift": self.selected_shift.value if self.selected_shift else None,
            "comment": self.comment_edit.toPlainText(),
            "inputs": {key: field.input.text() for key, field in self.inputs.items()},
        }
        self.main_window.save_config()

    def load_draft(self):
        """Загрузка черновика"""
        draft = self.main_window.config.get("draft") or {}
        
        # Дата
        if draft.get("date"):
            parsed = QDate.fromString(str(draft["date"]), "yyyy-MM-dd")
            if parsed.isValid():
                self.date_edit.setDate(parsed)

        # Смена
        shift = draft.get("selected_shift")
        if shift == "day":
            self.shift_selector.select_shift(ShiftType.DAY)
        elif shift == "night":
            self.shift_selector.select_shift(ShiftType.NIGHT)

        # Поля ввода
        inputs = draft.get("inputs") or {}
        for key, field in self.inputs.items():
            field.set_value(int(inputs.get(key, "0")))

        # Комментарий
        self.comment_edit.setPlainText(str(draft.get("comment") or ""))
        
        self.update_calculation()

    def clear_form(self):
        """Очистка формы"""
        for field in self.inputs.values():
            field.clear()
            
        self.comment_edit.clear()
        self.shift_selector.set_shift(None)
        self.date_edit.setDate(QDate.currentDate())
        self.selected_shift = None
        
        self.update_calculation()
        self.save_draft()
        
        self.info_label.setText("Форма очищена")

    # ==================== Дополнительные функции ====================

    def quick_fill(self):
        """Быстрая подстановка тестовых данных"""
        self.inputs["cash"].set_value(150000)
        self.inputs["coins"].set_value(5000)
        self.inputs["kaspi_pos"].set_value(75000)
        self.inputs["kaspi_online"].set_value(25000)
        self.inputs["debts"].set_value(10000)
        self.inputs["start_cash"].set_value(50000)
        self.inputs["wipon"].set_value(200000)
        
        self.update_calculation()
        self.info_label.setText("⚡ Подставлены тестовые данные")

    def set_operator_enabled(self, enabled: bool):
        """Включение/отключение вкладки"""
        self.setEnabled(enabled)
        if enabled:
            self.update_calculation()