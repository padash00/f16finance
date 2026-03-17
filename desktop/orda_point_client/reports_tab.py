"""
Reports and analytics tab for Orda Control Point
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional, List, Dict, Any, Tuple
from enum import Enum

from PyQt6.QtCore import Qt, QTimer, pyqtSignal, QDate
from PyQt6.QtGui import QColor
from PyQt6.QtWidgets import (
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QPushButton,
    QSplitter,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
    QFrame,
    QGroupBox,
    QGridLayout,
    QComboBox,
    QDateEdit,
    QProgressBar,
    QGraphicsDropShadowEffect,
    QScrollArea,
    QSizePolicy,
)

from theme import (
    BG, SURFACE, SURFACE_2, BORDER,
    TEXT, TEXT_MUTED, TEXT_DIM,
    ACCENT, SUCCESS, WARNING, DANGER, VIOLET,
)


# ==================== Вспомогательные функции ====================

def format_money(value: int | float | None) -> str:
    """Форматирование числа в денежный формат"""
    return f"{int(value or 0):,}".replace(",", " ")


def format_date(date_str: str) -> str:
    """Форматирование даты"""
    try:
        if len(date_str) >= 10:
            dt = datetime.fromisoformat(date_str[:10])
            return dt.strftime("%d.%m.%Y")
    except:
        pass
    return date_str[:10] if date_str else "—"


class ReportMetric(Enum):
    """Метрики для отчётов"""
    WAREHOUSE = "warehouse"
    WORKERS = "workers"
    CLIENTS = "clients"
    SHIFTS = "shifts"

    def display_name(self) -> str:
        names = {
            "warehouse": "Склад",
            "workers": "Сотрудники",
            "clients": "Клиенты",
            "shifts": "Смены"
        }
        return names.get(self.value, self.value)

    def icon(self) -> str:
        icons = {
            "warehouse": "📦",
            "workers": "👥",
            "clients": "👤",
            "shifts": "🕐"
        }
        return icons.get(self.value, "📊")


# ==================== Современные UI компоненты ====================

class MetricCard(QFrame):
    """Карточка метрики для дашборда"""

    def __init__(self, title: str, icon: str, color: str = ACCENT, parent=None):
        super().__init__(parent)
        self.setProperty("class", "metric-card")

        # Тень
        shadow = QGraphicsDropShadowEffect()
        shadow.setBlurRadius(20)
        shadow.setColor(QColor(0, 0, 0, 40))
        shadow.setOffset(0, 4)
        self.setGraphicsEffect(shadow)

        self.setStyleSheet(f"""
            MetricCard {{
                background: qlineargradient(x1:0, y1:0, x2:1, y2:1,
                    stop:0 {BG}, stop:1 {BG});
                border: 1px solid {BORDER};
                border-radius: 16px;
                border-left: 4px solid {color};
                padding: 16px;
            }}
        """)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(16, 14, 16, 14)
        layout.setSpacing(8)

        # Верхняя строка с иконкой и заголовком
        top_row = QHBoxLayout()

        icon_label = QLabel(icon)
        icon_label.setStyleSheet(f"font-size: 28px; background: transparent;")

        self.title_label = QLabel(title)
        self.title_label.setProperty("class", "muted")
        self.title_label.setStyleSheet("font-size: 13px; background: transparent;")

        top_row.addWidget(icon_label)
        top_row.addWidget(self.title_label)
        top_row.addStretch()

        # Значение
        self.value_label = QLabel("0")
        self.value_label.setStyleSheet(f"""
            font-size: 32px;
            font-weight: 700;
            color: {color};
            background: transparent;
            line-height: 1.2;
        """)

        # Дополнительная информация
        self.sub_label = QLabel("")
        self.sub_label.setProperty("class", "muted")
        self.sub_label.setStyleSheet("font-size: 11px; background: transparent;")

        layout.addLayout(top_row)
        layout.addWidget(self.value_label)
        layout.addWidget(self.sub_label)

    def set_value(self, value: int | str, sub: str = ""):
        """Установка значения"""
        self.value_label.setText(str(value))
        self.sub_label.setText(sub)


class ReportTable(QTableWidget):
    """Улучшенная таблица для отчётов"""

    def __init__(self, headers: List[str], parent=None):
        super().__init__(parent)
        self.headers = headers
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
                background: {BG};
                border: 1px solid {BORDER};
                border-radius: 12px;
                gridline-color: transparent;
                selection-background-color: #1E3A5F;
            }}
            QTableWidget::item {{
                padding: 10px 8px;
                border-bottom: 1px solid {BORDER};
            }}
            QTableWidget::item:selected {{
                background: #1E3A5F;
            }}
            QTableWidget::item:hover {{
                background: #1A2634;
            }}
        """)

        # Настройка заголовков
        self.setColumnCount(len(self.headers))
        self.setHorizontalHeaderLabels(self.headers)

        header = self.horizontalHeader()
        header.setStyleSheet(f"""
            QHeaderView::section {{
                background: {BG};
                color: {TEXT_MUTED};
                border: none;
                border-bottom: 2px solid {BORDER};
                padding: 12px 8px;
                font-weight: 700;
                font-size: 12px;
            }}
        """)

        # Растяжение колонок
        for i in range(len(self.headers)):
            if i == 0:
                header.setSectionResizeMode(i, QHeaderView.ResizeMode.ResizeToContents)
            else:
                header.setSectionResizeMode(i, QHeaderView.ResizeMode.Stretch)

    def add_row(self, items: List[QTableWidgetItem]):
        """Добавление строки"""
        row = self.rowCount()
        self.insertRow(row)
        for col, item in enumerate(items):
            self.setItem(row, col, item)

    def clear_rows(self):
        """Очистка всех строк"""
        self.setRowCount(0)


class ChartWidget(QFrame):
    """Виджет для отображения графиков (заглушка для будущей реализации)"""

    def __init__(self, title: str, parent=None):
        super().__init__(parent)
        self.setStyleSheet(f"""
            ChartWidget {{
                background: {BG};
                border: 1px solid {BORDER};
                border-radius: 12px;
                padding: 16px;
            }}
        """)

        layout = QVBoxLayout(self)

        title_label = QLabel(title)
        title_label.setStyleSheet(f"""
            font-size: 14px;
            font-weight: 600;
            color: {TEXT};
            padding-bottom: 8px;
        """)

        placeholder = QLabel("📊 График будет доступен в следующей версии")
        placeholder.setAlignment(Qt.AlignmentFlag.AlignCenter)
        placeholder.setProperty("class", "muted")
        placeholder.setStyleSheet(f"""
            font-size: 12px;
            padding: 20px;
            background: {BORDER};
            border-radius: 8px;
        """)

        layout.addWidget(title_label)
        layout.addWidget(placeholder)


class FilterBar(QFrame):
    """Панель фильтров для отчётов"""

    filters_changed = pyqtSignal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setup_ui()

    def setup_ui(self):
        self.setStyleSheet(f"""
            FilterBar {{
                background: {BG};
                border: 1px solid {BORDER};
                border-radius: 12px;
                padding: 12px;
            }}
        """)

        layout = QHBoxLayout(self)
        layout.setContentsMargins(12, 8, 12, 8)
        layout.setSpacing(12)

        # Фильтр по дате
        date_label = QLabel("📅 Период:")
        date_label.setStyleSheet(f"font-size: 13px; color: {TEXT_MUTED};")

        self.date_from = QDateEdit()
        self.date_from.setDate(QDate.currentDate().addDays(-30))
        self.date_from.setCalendarPopup(True)
        self.date_from.setFixedWidth(120)
        self.date_from.setStyleSheet(f"""
            QDateEdit {{
                background: {BORDER};
                border: 1px solid {BORDER};
                border-radius: 8px;
                padding: 6px 8px;
                font-size: 12px;
            }}
        """)

        date_to_label = QLabel("—")
        date_to_label.setStyleSheet(f"color: {TEXT_MUTED};")

        self.date_to = QDateEdit()
        self.date_to.setDate(QDate.currentDate())
        self.date_to.setCalendarPopup(True)
        self.date_to.setFixedWidth(120)
        self.date_to.setStyleSheet(f"""
            QDateEdit {{
                background: {BORDER};
                border: 1px solid {BORDER};
                border-radius: 8px;
                padding: 6px 8px;
                font-size: 12px;
            }}
        """)

        # Фильтр по типу
        type_label = QLabel("📋 Тип:")
        type_label.setStyleSheet(f"font-size: 13px; color: {TEXT_MUTED};")

        self.type_filter = QComboBox()
        self.type_filter.addItems(["Все", "Смены", "Долги", "Склад"])
        self.type_filter.setFixedWidth(100)
        self.type_filter.setStyleSheet(f"""
            QComboBox {{
                background: {BORDER};
                border: 1px solid {BORDER};
                border-radius: 8px;
                padding: 6px 8px;
                font-size: 12px;
            }}
        """)

        # Кнопка применения
        self.apply_btn = QPushButton("Применить")
        self.apply_btn.setProperty("class", "primary")
        self.apply_btn.setFixedHeight(32)
        self.apply_btn.setFixedWidth(100)
        self.apply_btn.clicked.connect(self.filters_changed)

        layout.addWidget(date_label)
        layout.addWidget(self.date_from)
        layout.addWidget(date_to_label)
        layout.addWidget(self.date_to)
        layout.addSpacing(16)
        layout.addWidget(type_label)
        layout.addWidget(self.type_filter)
        layout.addStretch()
        layout.addWidget(self.apply_btn)

    def get_filters(self) -> Dict:
        """Получение текущих фильтров"""
        return {
            "date_from": self.date_from.date().toString("yyyy-MM-dd"),
            "date_to": self.date_to.date().toString("yyyy-MM-dd"),
            "type": self.type_filter.currentText(),
        }


# ==================== Основной класс вкладки ====================

class ReportsTab(QWidget):
    """
    Улучшенная вкладка отчётов и аналитики

    Особенности:
    - Дашборд с ключевыми метриками
    - Фильтрация по датам
    - Цветовая индикация данных
    - Улучшенные таблицы
    - Поддержка экспорта
    """

    def __init__(self, main_window):
        super().__init__(main_window)
        self.main_window = main_window
        self.current_data: Dict[str, Any] = {}
        self.init_ui()
        self.load_data()

    def init_ui(self):
        """Инициализация интерфейса"""
        root = QVBoxLayout(self)
        root.setContentsMargins(20, 20, 20, 20)
        root.setSpacing(20)

        # === Верхняя панель с заголовком и кнопками ===
        top_bar = QHBoxLayout()

        title_container = QHBoxLayout()
        title_icon = QLabel("📊")
        title_icon.setStyleSheet("font-size: 28px; background: transparent;")

        title_text = QLabel("Аналитика и отчёты")
        title_text.setStyleSheet(f"""
            font-size: 22px;
            font-weight: 700;
            color: {TEXT};
            letter-spacing: -0.3px;
        """)

        title_container.addWidget(title_icon)
        title_container.addWidget(title_text)
        title_container.addStretch()

        # Кнопки действий
        self.refresh_btn = QPushButton("⟳ Обновить")
        self.refresh_btn.setProperty("class", "primary")
        self.refresh_btn.setMinimumHeight(40)
        self.refresh_btn.setMinimumWidth(120)
        self.refresh_btn.clicked.connect(self.load_data)

        self.export_btn = QPushButton("📥 Экспорт")
        self.export_btn.setProperty("class", "ghost")
        self.export_btn.setMinimumHeight(40)
        self.export_btn.setMinimumWidth(100)
        self.export_btn.clicked.connect(self.export_data)

        top_bar.addLayout(title_container, 1)
        top_bar.addWidget(self.export_btn)
        top_bar.addSpacing(8)
        top_bar.addWidget(self.refresh_btn)

        root.addLayout(top_bar)

        # === Панель фильтров ===
        self.filter_bar = FilterBar()
        self.filter_bar.filters_changed.connect(self.apply_filters)
        root.addWidget(self.filter_bar)

        # === Дашборд с метриками ===
        metrics_layout = QHBoxLayout()
        metrics_layout.setSpacing(16)

        self.warehouse_card = MetricCard("Товаров на складе", "📦", SUCCESS)
        self.workers_card = MetricCard("Долги сотрудников", "👥", WARNING)
        self.clients_card = MetricCard("Долги клиентов", "👤", DANGER)
        self.shifts_card = MetricCard("Всего смен", "🕐", ACCENT)

        metrics_layout.addWidget(self.warehouse_card)
        metrics_layout.addWidget(self.workers_card)
        metrics_layout.addWidget(self.clients_card)
        metrics_layout.addWidget(self.shifts_card)

        root.addLayout(metrics_layout)

        # === Информационная строка ===
        info_container = QFrame()
        info_container.setStyleSheet("""
            QFrame {
                background: rgba(59, 130, 246, 0.05);
                border: 1px solid rgba(59, 130, 246, 0.2);
                border-radius: 10px;
                padding: 8px 12px;
            }
        """)

        info_layout = QHBoxLayout(info_container)
        info_layout.setContentsMargins(12, 8, 12, 8)

        info_icon = QLabel("ℹ️")
        info_icon.setStyleSheet("font-size: 14px;")

        self.info_label = QLabel("Загрузка данных...")
        self.info_label.setProperty("class", "muted")
        self.info_label.setStyleSheet("font-size: 13px;")

        self.last_update_label = QLabel("")
        self.last_update_label.setProperty("class", "muted")
        self.last_update_label.setStyleSheet("font-size: 12px;")

        info_layout.addWidget(info_icon)
        info_layout.addWidget(self.info_label, 1)
        info_layout.addWidget(self.last_update_label)

        root.addWidget(info_container)

        # === Основной контент с таблицами ===
        content = QSplitter(Qt.Orientation.Vertical)
        content.setStyleSheet(f"""
            QSplitter::handle {{
                background: {BORDER};
                height: 1px;
            }}
        """)

        # Верхняя секция
        upper = QWidget()
        upper_layout = QVBoxLayout(upper)
        upper_layout.setContentsMargins(0, 0, 0, 0)
        upper_layout.setSpacing(16)

        upper_tables = QSplitter(Qt.Orientation.Horizontal)

        # Склад
        self.warehouse_table = ReportTable(["Код", "Товар", "Количество"])
        upper_tables.addWidget(self.wrap_box("📦 Склад (долги)", self.warehouse_table))

        # Сотрудники
        self.workers_table = ReportTable(["Сотрудник", "Сумма долга"])
        upper_tables.addWidget(self.wrap_box("👥 Долги сотрудников", self.workers_table))

        # Клиенты
        self.clients_table = ReportTable(["Клиент", "Сумма долга"])
        upper_tables.addWidget(self.wrap_box("👤 Долги клиентов", self.clients_table))

        upper_layout.addWidget(upper_tables)

        # Нижняя секция
        lower = QWidget()
        lower_layout = QVBoxLayout(lower)
        lower_layout.setContentsMargins(0, 0, 0, 0)
        lower_layout.setSpacing(16)

        lower_tables = QSplitter(Qt.Orientation.Horizontal)

        # История долгов
        self.history_table = ReportTable([
            "Дата", "Должник", "Товар", "Штрихкод", "Сумма", "Статус"
        ])
        lower_tables.addWidget(self.wrap_box("📜 История долгов", self.history_table))

        # История смен
        self.shifts_table = ReportTable([
            "Дата", "Оператор", "Смена", "Выручка", "Зона", "Комментарий"
        ])
        lower_tables.addWidget(self.wrap_box("🕐 История смен", self.shifts_table))

        lower_layout.addWidget(lower_tables)

        content.addWidget(upper)
        content.addWidget(lower)

        # Устанавливаем пропорции (40% верх, 60% низ)
        content.setSizes([400, 600])

        root.addWidget(content, 1)

        # === Статусная строка ===
        status_bar = QFrame()
        status_bar.setStyleSheet(f"""
            QFrame {{
                background: {BG};
                border: 1px solid {BORDER};
                border-radius: 8px;
                padding: 6px 12px;
            }}
        """)

        status_layout = QHBoxLayout(status_bar)
        status_layout.setContentsMargins(12, 4, 12, 4)

        self.status_label = QLabel("✓ Готов к работе")
        self.status_label.setProperty("class", "muted")
        self.status_label.setStyleSheet("font-size: 12px;")

        self.data_quality_label = QLabel("")
        self.data_quality_label.setProperty("class", "muted")
        self.data_quality_label.setStyleSheet("font-size: 12px;")

        status_layout.addWidget(self.status_label)
        status_layout.addStretch()
        status_layout.addWidget(self.data_quality_label)

        root.addWidget(status_bar)

    def wrap_box(self, title: str, table: QTableWidget) -> QWidget:
        """Обёртка для таблицы с заголовком"""
        wrapper = QWidget()
        layout = QVBoxLayout(wrapper)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(8)

        title_label = QLabel(title)
        title_label.setStyleSheet(f"""
            font-size: 14px;
            font-weight: 600;
            color: {TEXT};
            padding-left: 4px;
        """)

        layout.addWidget(title_label)
        layout.addWidget(table, 1)

        return wrapper

    # ==================== Методы работы с данными ====================

    def load_data(self):
        """Загрузка данных отчётов"""
        if not self.main_window.api:
            self.info_label.setText("⚠️ API недоступен")
            self.status_label.setText("✗ Ошибка подключения")
            return

        try:
            response = self.main_window.api.get_reports()
            self.current_data = (response.get("data") or {}) if isinstance(response, dict) else {}

            # Обновление всех таблиц
            self.update_all_tables()

            # Обновление метрик
            self.update_metrics()

            # Обновление информационной строки
            self.update_info()

            self.status_label.setText("✓ Данные обновлены")
            self.last_update_label.setText(f"Обновлено: {datetime.now().strftime('%H:%M:%S')}")

        except Exception as error:
            self.info_label.setText(f"⚠️ Ошибка загрузки: {error}")
            self.status_label.setText("✗ Ошибка загрузки")

    def update_all_tables(self):
        """Обновление всех таблиц"""
        warehouse = self.current_data.get("warehouse") or []
        worker_totals = self.current_data.get("worker_totals") or []
        client_totals = self.current_data.get("client_totals") or []
        debt_history = self.current_data.get("debt_history") or []
        shifts = self.current_data.get("shifts") or []

        self.fill_warehouse(warehouse)
        self.fill_totals(self.workers_table, worker_totals, "worker")
        self.fill_totals(self.clients_table, client_totals, "client")
        self.fill_debt_history(debt_history)
        self.fill_shifts(shifts)

    def update_metrics(self):
        """Обновление метрик дашборда"""
        warehouse = self.current_data.get("warehouse") or []
        worker_totals = self.current_data.get("worker_totals") or []
        client_totals = self.current_data.get("client_totals") or []
        shifts = self.current_data.get("shifts") or []

        # Склад
        total_items = sum(item.get("quantity", 0) for item in warehouse)
        self.warehouse_card.set_value(
            total_items,
            f"{len(warehouse)} позиций"
        )

        # Долги сотрудников
        worker_total = sum(item.get("total_amount", 0) for item in worker_totals)
        self.workers_card.set_value(
            f"{format_money(worker_total)} ₸",
            f"{len(worker_totals)} сотрудников"
        )

        # Долги клиентов
        client_total = sum(item.get("total_amount", 0) for item in client_totals)
        self.clients_card.set_value(
            f"{format_money(client_total)} ₸",
            f"{len(client_totals)} клиентов"
        )

        # Смены
        self.shifts_card.set_value(
            len(shifts),
            f"последняя: {shifts[0].get('date', '—') if shifts else '—'}"
        )

    def update_info(self):
        """Обновление информационной строки"""
        warehouse = self.current_data.get("warehouse") or []
        worker_totals = self.current_data.get("worker_totals") or []
        client_totals = self.current_data.get("client_totals") or []
        debt_history = self.current_data.get("debt_history") or []
        shifts = self.current_data.get("shifts") or []

        self.info_label.setText(
            f"📊 Склад: {len(warehouse)} позиций • "
            f"👥 Сотрудники: {len(worker_totals)} • "
            f"👤 Клиенты: {len(client_totals)} • "
            f"📜 История: {len(debt_history)} записей • "
            f"🕐 Смены: {len(shifts)}"
        )

        # Оценка качества данных
        total_records = len(warehouse) + len(worker_totals) + len(client_totals) + len(debt_history) + len(shifts)
        if total_records > 0:
            self.data_quality_label.setText(f"✅ Всего записей: {total_records}")
        else:
            self.data_quality_label.setText("📭 Нет данных за выбранный период")

    def fill_warehouse(self, rows: List[Dict]):
        """Заполнение таблицы склада"""
        self.warehouse_table.clear_rows()

        for item in rows:
            barcode = str(item.get("barcode") or "—")
            name = str(item.get("item_name") or "")
            quantity = str(item.get("quantity") or 0)

            # Визуальное выделение для малого количества
            qty_item = QTableWidgetItem(quantity)
            try:
                if int(quantity) < 5:
                    qty_item.setForeground(QColor(DANGER))
                elif int(quantity) < 10:
                    qty_item.setForeground(QColor(WARNING))
            except:
                pass

            self.warehouse_table.add_row([
                QTableWidgetItem(f"🔳 {barcode}"),
                QTableWidgetItem(f"📦 {name}"),
                qty_item
            ])

    def fill_totals(self, table: ReportTable, rows: List[Dict], type_: str):
        """Заполнение таблицы долгов"""
        table.clear_rows()

        for item in rows:
            name = str(item.get("name") or "")
            amount = int(item.get("total_amount") or 0)

            name_item = QTableWidgetItem(f"{'👤' if type_ == 'client' else '👥'} {name}")
            amount_item = QTableWidgetItem(f"{format_money(amount)} ₸")
            amount_item.setTextAlignment(Qt.AlignmentFlag.AlignRight)

            # Цветовая индикация сумм
            if amount > 100000:
                amount_item.setForeground(QColor(DANGER))
            elif amount > 50000:
                amount_item.setForeground(QColor(WARNING))
            else:
                amount_item.setForeground(QColor(SUCCESS))

            table.add_row([name_item, amount_item])

    def fill_debt_history(self, rows: List[Dict]):
        """Заполнение таблицы истории долгов"""
        self.history_table.clear_rows()

        for item in rows:
            date = format_date(str(item.get("created_at") or ""))
            debtor = str(item.get("debtor_name") or "")
            product = str(item.get("item_name") or "")
            barcode = str(item.get("barcode") or "—")
            amount = int(item.get("total_amount") or 0)
            status = item.get("status", "active")

            # Форматирование статуса
            status_text = "✅ Активен" if status == "active" else "❌ Удалён"
            status_color = SUCCESS if status == "active" else DANGER

            date_item = QTableWidgetItem(date)
            debtor_item = QTableWidgetItem(f"👤 {debtor}")
            product_item = QTableWidgetItem(f"📦 {product}")
            barcode_item = QTableWidgetItem(f"🔳 {barcode}")

            amount_item = QTableWidgetItem(f"{format_money(amount)} ₸")
            amount_item.setTextAlignment(Qt.AlignmentFlag.AlignRight)

            status_item = QTableWidgetItem(status_text)
            status_item.setForeground(QColor(status_color))

            self.history_table.add_row([
                date_item, debtor_item, product_item,
                barcode_item, amount_item, status_item
            ])

    def fill_shifts(self, rows: List[Dict]):
        """Заполнение таблицы смен"""
        self.shifts_table.clear_rows()

        for item in rows:
            date = str(item.get("date") or "")
            operator = str(item.get("operator_name") or "")
            shift = str(item.get("shift") or "")
            amount = int(item.get("actual_amount") or 0)
            zone = str(item.get("zone") or "—")
            comment = str(item.get("comment") or "—")

            # Определение типа смены
            shift_icon = "🌞" if shift == "day" else "🌙"
            shift_text = f"{shift_icon} {'День' if shift == 'day' else 'Ночь'}"

            date_item = QTableWidgetItem(date[:10] if len(date) > 10 else date)
            operator_item = QTableWidgetItem(f"👤 {operator}")
            shift_item = QTableWidgetItem(shift_text)

            amount_item = QTableWidgetItem(f"{format_money(amount)} ₸")
            amount_item.setTextAlignment(Qt.AlignmentFlag.AlignRight)

            # Цветовая индикация выручки
            if amount > 200000:
                amount_item.setForeground(QColor(SUCCESS))
            elif amount > 100000:
                amount_item.setForeground(QColor(ACCENT))

            zone_item = QTableWidgetItem(f"📍 {zone}")
            comment_item = QTableWidgetItem(comment[:30] + "..." if len(comment) > 30 else comment)

            self.shifts_table.add_row([
                date_item, operator_item, shift_item,
                amount_item, zone_item, comment_item
            ])

    def apply_filters(self):
        """Применение фильтров"""
        filters = self.filter_bar.get_filters()

        # TODO: Реализовать фильтрацию на стороне сервера
        # Пока просто перезагружаем данные
        self.status_label.setText(f"🔍 Фильтр: {filters['type']}, {filters['date_from']} - {filters['date_to']}")

        # Здесь можно добавить вызов API с фильтрами
        self.load_data()

    def export_data(self):
        """Экспорт данных в CSV/Excel"""
        # TODO: Реализовать экспорт данных
        from PyQt6.QtWidgets import QMessageBox

        QMessageBox.information(
            self,
            "Экспорт данных",
            "Функция экспорта будет доступна в следующей версии\n\n"
            "Планируется экспорт в:\n"
            "• CSV\n"
            "• Excel\n"
            "• PDF"
        )
