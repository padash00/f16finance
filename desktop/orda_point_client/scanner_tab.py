"""
Scanner tab for quick debt creation with barcode scanning
"""
from __future__ import annotations

import uuid
from typing import Optional, List, Dict, Any, Tuple
from enum import Enum
from datetime import datetime

import theme
from PyQt6.QtCore import Qt, QTimer, pyqtSignal, QPropertyAnimation, QEasingCurve
from PyQt6.QtGui import QIntValidator, QColor, QFont, QKeySequence, QShortcut
from utils import parse_money, format_money
from PyQt6.QtWidgets import (
    QComboBox,
    QGridLayout,
    QGroupBox,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QLineEdit,
    QMessageBox,
    QPushButton,
    QSpinBox,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
    QFrame,
    QSplitter,
    QProgressBar,
    QApplication,
)


# ==================== Вспомогательные функции ====================

def generate_local_ref() -> str:
    """Генерация локальной ссылки"""
    return f"scanner:{uuid.uuid4().hex[:8]}"


class ScannerMode(Enum):
    """Режимы работы сканера"""
    SCANNER = "scanner"
    MANUAL = "manual"
    
    def display_name(self) -> str:
        names = {
            "scanner": "Режим сканера",
            "manual": "Ручной ввод"
        }
        return names.get(self.value, self.value)


# ==================== Современные UI компоненты ====================

class ScannerCard(QFrame):
    """Карточка для отображения текущего сканирования"""
    
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setProperty("class", "scanner-card")

        self.setStyleSheet(f"""
            ScannerCard {{
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

        icon_label = QLabel("[S]")
        icon_label.setStyleSheet(f"font-size: 16px; color: {theme.ACCENT}; font-weight: 700; background: transparent;")

        title_label = QLabel("Сканер товаров")
        title_label.setStyleSheet(f"""
            font-size: 20px;
            font-weight: 700;
            color: {theme.TEXT};
            background: transparent;
        """)
        
        self.mode_badge = QFrame()
        self.mode_badge.setFixedSize(8, 8)
        self.mode_badge.setStyleSheet("background: #10B981; border-radius: 4px;")
        
        self.mode_label = QLabel("Активен")
        self.mode_label.setStyleSheet("""
            font-size: 12px;
            color: #10B981;
            background: transparent;
        """)
        
        header.addWidget(icon_label)
        header.addWidget(title_label)
        header.addStretch()
        header.addWidget(self.mode_badge)
        header.addWidget(self.mode_label)
        
        layout.addLayout(header)
        
        # Индикатор последнего сканирования
        self.last_scan_container = QFrame()
        self.last_scan_container.setStyleSheet(f"""
            QFrame {{
                background: {theme.CARD};
                border: 1px solid {theme.DIVIDER};
                border-radius: 12px;
                padding: 12px;
            }}
        """)
        self.last_scan_container.hide()
        
        last_scan_layout = QHBoxLayout(self.last_scan_container)
        last_scan_layout.setContentsMargins(12, 8, 12, 8)
        
        self.last_scan_icon = QLabel("+")
        self.last_scan_icon.setStyleSheet(f"font-size: 16px; color: {theme.SUCCESS}; font-weight: 700;")

        self.last_scan_label = QLabel("Последний товар: —")
        self.last_scan_label.setStyleSheet(f"font-size: 13px; color: {theme.SUCCESS};")
        
        last_scan_layout.addWidget(self.last_scan_icon)
        last_scan_layout.addWidget(self.last_scan_label, 1)
        
        layout.addWidget(self.last_scan_container)
        
    def set_last_scan(self, product_name: str, price: int):
        """Установка информации о последнем сканировании"""
        self.last_scan_label.setText(f"Последний товар: {product_name} ({format_money(price)} ₸)")
        self.last_scan_container.show()
        
        # Анимация появления
        self.animation = QPropertyAnimation(self.last_scan_container, b"windowOpacity")
        self.animation.setDuration(300)
        self.animation.setStartValue(0)
        self.animation.setEndValue(1)
        self.animation.start()
        
    def set_mode(self, mode: ScannerMode):
        """Установка режима работы"""
        if mode == ScannerMode.SCANNER:
            self.mode_badge.setStyleSheet("background: #10B981; border-radius: 4px;")
            self.mode_label.setText("Режим сканера")
            self.mode_label.setStyleSheet("color: #10B981;")
        else:
            self.mode_badge.setStyleSheet("background: #F59E0B; border-radius: 4px;")
            self.mode_label.setText("Ручной ввод")
            self.mode_label.setStyleSheet("color: #F59E0B;")


class ScannerForm(QGroupBox):
    """
    Улучшенная форма для быстрого добавления долгов через сканер
    
    Сигналы:
        product_scanned: испускается при сканировании товара
        debt_created: испускается при создании долга
    """
    
    product_scanned = pyqtSignal(dict)
    debt_created = pyqtSignal(dict)
    
    def __init__(self, parent=None):
        super().__init__("Быстрое сканирование", parent)
        self.current_mode = ScannerMode.SCANNER
        self.setup_ui()

    def setup_ui(self):
        """Настройка интерфейса формы"""
        self.setStyleSheet(f"""
            ScannerForm {{
                border: 1px solid {theme.DIVIDER};
                border-radius: 16px;
                margin-top: 16px;
                font-weight: 600;
                color: {theme.ACCENT};
                background: {theme.CARD};
                padding: 20px;
            }}
            ScannerForm::title {{
                subcontrol-origin: margin;
                left: 16px;
                padding: 0 12px;
                background: {theme.BG};
                font-size: 15px;
            }}
        """)
        
        layout = QGridLayout(self)
        layout.setVerticalSpacing(16)
        layout.setHorizontalSpacing(12)

        # === Строка 1: Оператор / Клиент ===
        # Оператор
        operator_label = QLabel("Оператор")
        operator_label.setStyleSheet(f"font-size: 13px; font-weight: 600; color: {theme.ACCENT};")

        self.operator_box = QComboBox()
        self.operator_box.setMinimumHeight(44)
        self.operator_box.currentIndexChanged.connect(self.on_target_changed)

        # Или клиент
        or_label = QLabel("или")
        or_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        or_label.setStyleSheet(f"color: {theme.TEXT_MUTED}; font-size: 13px;")

        self.manual_name = QLineEdit()
        self.manual_name.setPlaceholderText("Имя клиента")
        self.manual_name.setMinimumHeight(44)
        
        layout.addWidget(operator_label, 0, 0)
        layout.addWidget(self.operator_box, 0, 1)
        layout.addWidget(or_label, 0, 2)
        layout.addWidget(self.manual_name, 0, 3, 1, 2)

        # === Строка 2: Штрихкод и товар ===
        # Штрихкод
        barcode_label = QLabel("Штрихкод")
        barcode_label.setStyleSheet(f"font-size: 13px; font-weight: 600; color: {theme.ACCENT};")

        self.barcode_input = QLineEdit()
        self.barcode_input.setPlaceholderText("Введите или отсканируйте штрихкод")
        self.barcode_input.setMinimumHeight(44)
        self.barcode_input.returnPressed.connect(self.apply_barcode)

        # Товар
        product_label = QLabel("Товар")
        product_label.setStyleSheet(f"font-size: 13px; font-weight: 600; color: {theme.ACCENT};")

        self.product_box = QComboBox()
        self.product_box.setEditable(True)
        self.product_box.setMinimumHeight(44)
        self.product_box.currentIndexChanged.connect(self.on_product_changed)
        
        layout.addWidget(barcode_label, 1, 0)
        layout.addWidget(self.barcode_input, 1, 1, 1, 2)
        layout.addWidget(product_label, 1, 3)
        layout.addWidget(self.product_box, 1, 4)

        # === Строка 3: Количество и цена ===
        # Количество
        qty_label = QLabel("Количество")
        qty_label.setStyleSheet(f"font-size: 13px; font-weight: 600; color: {theme.ACCENT};")

        self.qty_spin = QSpinBox()
        self.qty_spin.setRange(1, 999)
        self.qty_spin.setValue(1)
        self.qty_spin.setMinimumHeight(44)
        self.qty_spin.valueChanged.connect(self.update_total)

        # Цена
        price_label = QLabel("Цена")
        price_label.setStyleSheet(f"font-size: 13px; font-weight: 600; color: {theme.ACCENT};")

        price_container = QWidget()
        price_layout = QHBoxLayout(price_container)
        price_layout.setContentsMargins(0, 0, 0, 0)
        price_layout.setSpacing(4)

        self.price_input = QLineEdit("0")
        self.price_input.setValidator(QIntValidator(0, 9_999_999))
        self.price_input.setMinimumHeight(44)
        self.price_input.textChanged.connect(self.update_total)

        currency_label = QLabel("₸")
        currency_label.setStyleSheet(f"""
            font-size: 18px;
            font-weight: 700;
            color: {theme.WARNING};
            background: transparent;
        """)
        
        price_layout.addWidget(self.price_input, 1)
        price_layout.addWidget(currency_label)
        
        layout.addWidget(qty_label, 2, 0)
        layout.addWidget(self.qty_spin, 2, 1)
        layout.addWidget(price_label, 2, 2)
        layout.addWidget(price_container, 2, 3, 1, 2)

        # === Строка 4: Итого ===
        total_label = QLabel("ИТОГО:")
        total_label.setStyleSheet(f"""
            font-size: 16px;
            font-weight: 700;
            color: {theme.WARNING};
            background: transparent;
        """)

        self.total_display = QFrame()
        self.total_display.setStyleSheet(f"""
            QFrame {{
                background: {theme.CARD};
                border: 1px solid {theme.DIVIDER};
                border-radius: 12px;
                padding: 8px 16px;
            }}
        """)

        total_display_layout = QHBoxLayout(self.total_display)
        total_display_layout.setContentsMargins(16, 8, 16, 8)

        self.total_label = QLabel("0 ₸")
        self.total_label.setAlignment(Qt.AlignmentFlag.AlignRight)
        self.total_label.setStyleSheet(f"""
            font-size: 24px;
            font-weight: 700;
            color: {theme.WARNING};
            background: transparent;
        """)
        
        total_display_layout.addWidget(self.total_label)
        
        layout.addWidget(total_label, 3, 3)
        layout.addWidget(self.total_display, 3, 4)
        
        # Добавляем растяжение для последней строки
        layout.setColumnStretch(1, 1)
        layout.setColumnStretch(2, 1)
        layout.setColumnStretch(4, 2)
        
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
            
        if current_id:
            for index in range(self.operator_box.count()):
                data = self.operator_box.itemData(index)
                if isinstance(data, dict) and str(data.get("id")) == current_id:
                    self.operator_box.setCurrentIndex(index)
                    break
                    
        self.operator_box.blockSignals(False)
        self.on_target_changed()
        
    def set_products(self, products: List[Dict], current_barcode: Optional[str] = None):
        """Установка списка товаров"""
        self.product_box.blockSignals(True)
        self.product_box.clear()
        
        self.product_box.addItem("Выберите товар", None)
        
        for product in products:
            if product.get("is_active") is False:
                continue
            name = product.get('name', 'Товар')
            barcode = product.get('barcode', '—')
            price = product.get('price', 0)
            self.product_box.addItem(f"{name} ({barcode}) - {format_money(price)} ₸", product)
            
        if current_barcode:
            for index in range(self.product_box.count()):
                data = self.product_box.itemData(index)
                if isinstance(data, dict) and str(data.get("barcode")) == current_barcode:
                    self.product_box.setCurrentIndex(index)
                    break
                    
        self.product_box.blockSignals(False)
        
    def current_product(self) -> Optional[Dict]:
        """Получение текущего выбранного товара"""
        data = self.product_box.currentData()
        return data if isinstance(data, dict) else None
        
    def on_product_changed(self):
        """Обработка изменения выбранного товара"""
        product = self.current_product()
        if not product:
            return
            
        self.barcode_input.setText(str(product.get("barcode") or ""))
        self.price_input.setText(str(int(product.get("price") or 0)))
        self.update_total()
        
        # Сигнал о сканировании
        self.product_scanned.emit(product)
        
    def apply_barcode(self):
        """Применение введённого штрихкода"""
        barcode = self.barcode_input.text().strip()
        if not barcode:
            return
            
        # Поиск по всем товарам (без учёта фильтра)
        for index in range(self.product_box.count()):
            data = self.product_box.itemData(index)
            if isinstance(data, dict) and str(data.get("barcode") or "") == barcode:
                self.product_box.setCurrentIndex(index)
                return
                
        QMessageBox.warning(
            self, 
            "Сканер", 
            f"Товар со штрихкодом {barcode} не найден в каталоге."
        )
        
    def update_total(self):
        """Обновление итоговой суммы"""
        total = self.qty_spin.value() * parse_money(self.price_input.text())
        self.total_label.setText(f"{format_money(total)} ₸")
        
    def get_payload(self) -> Optional[Dict]:
        """Получение данных для создания долга"""
        product = self.current_product()
        if not product:
            QMessageBox.warning(self, "Сканер", "Выберите товар из каталога.")
            return None

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

        if not client_name:
            QMessageBox.warning(
                self, 
                "Сканер", 
                "Выберите оператора точки или введите имя клиента."
            )
            return None

        quantity = self.qty_spin.value()
        unit_price = parse_money(self.price_input.text())
        total_amount = quantity * unit_price
        
        if total_amount <= 0:
            QMessageBox.warning(self, "Сканер", "Цена и сумма должны быть больше нуля.")
            return None

        return {
            "operator_id": operator_id,
            "client_name": client_name,
            "item_name": str(product.get("name") or "Товар"),
            "quantity": quantity,
            "unit_price": unit_price,
            "total_amount": total_amount,
            "comment": f"barcode:{product.get('barcode')}",
            "local_ref": generate_local_ref(),
        }
        
    def clear(self):
        """Очистка формы"""
        self.operator_box.setCurrentIndex(0)
        self.manual_name.clear()
        self.barcode_input.clear()
        self.product_box.setCurrentIndex(0)
        self.qty_spin.setValue(1)
        self.price_input.setText("0")
        self.on_target_changed()
        self.update_total()
        
    def set_mode(self, mode: ScannerMode):
        """Установка режима работы"""
        self.current_mode = mode
        if mode == ScannerMode.SCANNER:
            self.barcode_input.setFocus()
        else:
            self.manual_name.setFocus()


class ScannerTable(QTableWidget):
    """Улучшенная таблица для отображения долгов по сканеру"""
    
    item_selected = pyqtSignal(dict)
    
    def __init__(self, parent=None):
        super().__init__(parent)
        self.items: List[Dict] = []
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
        
        # Подключение сигнала выбора
        self.itemSelectionChanged.connect(self.on_selection_changed)
        
    def set_items(self, items: List[Dict]):
        """Установка списка элементов"""
        self.items = items
        self.update_table()
        
    def update_table(self):
        """Обновление таблицы"""
        self.setRowCount(len(self.items))
        self.setColumnCount(7)
        self.setHorizontalHeaderLabels([
            "ID", "Должник", "Товар", "Штрихкод", "Кол-во", "Сумма", "Статус"
        ])
        self.setColumnHidden(0, True)  # Скрываем ID
        
        for row, item in enumerate(self.items):
            # ID (скрыт)
            self.setItem(row, 0, QTableWidgetItem(str(item.get("id") or "")))
            
            # Должник
            debtor = str(item.get("debtor_name") or "")
            debtor_item = QTableWidgetItem(debtor)
            self.setItem(row, 1, debtor_item)

            # Товар
            product = str(item.get("item_name") or "")
            product_item = QTableWidgetItem(product)
            self.setItem(row, 2, product_item)

            # Штрихкод
            barcode = str(item.get("barcode") or "—")
            barcode_item = QTableWidgetItem(barcode)
            if barcode != "—":
                barcode_item.setForeground(QColor("#3B82F6"))
            self.setItem(row, 3, barcode_item)
            
            # Количество
            qty = str(item.get("quantity") or 0)
            qty_item = QTableWidgetItem(qty)
            qty_item.setTextAlignment(Qt.AlignmentFlag.AlignRight)
            self.setItem(row, 4, qty_item)
            
            # Сумма
            amount = int(item.get("total_amount") or 0)
            amount_item = QTableWidgetItem(f"{format_money(amount)} ₸")
            amount_item.setTextAlignment(Qt.AlignmentFlag.AlignRight)
            
            # Цветовая индикация суммы
            if amount > 100000:
                amount_item.setForeground(QColor("#EF4444"))
            elif amount > 50000:
                amount_item.setForeground(QColor("#F59E0B"))
            else:
                amount_item.setForeground(QColor("#10B981"))
                
            self.setItem(row, 5, amount_item)
            
            # Статус
            status = item.get("status", "active")
            status_text = "В очереди" if status == "pending" else "Активен"
            status_color = theme.WARNING if status == "pending" else theme.SUCCESS
            
            status_item = QTableWidgetItem(status_text)
            status_item.setForeground(QColor(status_color))
            self.setItem(row, 6, status_item)
            
    def on_selection_changed(self):
        """Обработка изменения выбора"""
        row = self.currentRow()
        if 0 <= row < len(self.items):
            self.item_selected.emit(self.items[row])
            
    def selected_item(self) -> Optional[Dict]:
        """Получение выбранного элемента"""
        row = self.currentRow()
        if 0 <= row < len(self.items):
            return self.items[row]
        return None


# ==================== Основной класс вкладки ====================

class ScannerTab(QWidget):
    """
    Улучшенная вкладка сканера для быстрого создания долгов
    
    Особенности:
    - Быстрое сканирование штрихкодов
    - Автоподстановка товаров
    - Режимы работы (сканер/ручной ввод)
    - Статистика сканирований
    - Горячие клавиши
    """
    
    def __init__(self, main_window):
        super().__init__(main_window)
        self.main_window = main_window
        self.products: List[Dict] = []
        self.items: List[Dict] = []
        self.scan_count = 0
        self.total_amount = 0
        
        self.init_ui()
        self.setup_shortcuts()
        self.load_draft()
        
    def init_ui(self):
        """Инициализация интерфейса"""
        root = QVBoxLayout(self)
        root.setContentsMargins(20, 20, 20, 20)
        root.setSpacing(20)

        # === Карточка сканера ===
        self.scanner_card = ScannerCard()
        root.addWidget(self.scanner_card)

        # === Форма сканирования ===
        self.scanner_form = ScannerForm()
        self.scanner_form.product_scanned.connect(self.on_product_scanned)
        root.addWidget(self.scanner_form)

        # === Панель статистики ===
        stats_layout = QHBoxLayout()
        stats_layout.setSpacing(16)
        
        # Карточка количества сканирований
        self.scan_count_card = QFrame()
        self.scan_count_card.setStyleSheet(f"""
            QFrame {{
                background: {theme.BG};
                border: 1px solid {theme.DIVIDER};
                border-radius: 12px;
                padding: 12px;
            }}
        """)
        
        scan_count_layout = QHBoxLayout(self.scan_count_card)
        scan_count_layout.setContentsMargins(12, 8, 12, 8)
        
        scan_icon = QLabel("[S]")
        scan_icon.setStyleSheet(f"font-size: 13px; color: {theme.ACCENT}; font-weight: 700;")

        self.scan_count_label = QLabel("0 сканирований")
        self.scan_count_label.setStyleSheet(f"font-size: 14px; font-weight: 600; color: {theme.ACCENT};")
        
        scan_count_layout.addWidget(scan_icon)
        scan_count_layout.addWidget(self.scan_count_label)
        scan_count_layout.addStretch()
        
        # Карточка общей суммы
        self.total_amount_card = QFrame()
        self.total_amount_card.setStyleSheet(f"""
            QFrame {{
                background: {theme.BG};
                border: 1px solid {theme.DIVIDER};
                border-radius: 12px;
                padding: 12px;
            }}
        """)
        
        amount_layout = QHBoxLayout(self.total_amount_card)
        amount_layout.setContentsMargins(12, 8, 12, 8)
        
        amount_icon = QLabel("$")
        amount_icon.setStyleSheet(f"font-size: 14px; color: {theme.WARNING}; font-weight: 700;")

        self.total_amount_label = QLabel("0 ₸")
        self.total_amount_label.setStyleSheet(f"font-size: 14px; font-weight: 600; color: {theme.WARNING};")
        
        amount_layout.addWidget(amount_icon)
        amount_layout.addWidget(self.total_amount_label)
        amount_layout.addStretch()
        
        stats_layout.addWidget(self.scan_count_card)
        stats_layout.addWidget(self.total_amount_card)
        stats_layout.addStretch()
        
        root.addLayout(stats_layout)

        # === Панель действий ===
        actions_layout = QHBoxLayout()
        actions_layout.setSpacing(12)
        
        # Левая группа
        left_actions = QHBoxLayout()
        left_actions.setSpacing(8)
        
        self.add_btn = QPushButton("Добавить долг")
        self.add_btn.setProperty("class", "success")
        self.add_btn.setMinimumHeight(44)
        self.add_btn.setMinimumWidth(160)
        self.add_btn.clicked.connect(self.add_debt)

        self.clear_btn = QPushButton("Очистить")
        self.clear_btn.setProperty("class", "ghost")
        self.clear_btn.setMinimumHeight(44)
        self.clear_btn.clicked.connect(self.clear_form)
        
        left_actions.addWidget(self.add_btn)
        left_actions.addWidget(self.clear_btn)
        
        # Переключатель режимов
        mode_container = QFrame()
        mode_container.setStyleSheet(f"""
            QFrame {{
                background: {theme.BG};
                border: 1px solid {theme.DIVIDER};
                border-radius: 22px;
                padding: 2px;
            }}
        """)
        
        mode_layout = QHBoxLayout(mode_container)
        mode_layout.setContentsMargins(2, 2, 2, 2)
        mode_layout.setSpacing(2)
        
        self.scanner_mode_btn = QPushButton("Сканер")
        self.scanner_mode_btn.setCheckable(True)
        self.scanner_mode_btn.setChecked(True)
        self.scanner_mode_btn.setFixedHeight(36)
        self.scanner_mode_btn.clicked.connect(lambda: self.set_mode(ScannerMode.SCANNER))
        self.scanner_mode_btn.setStyleSheet(f"""
            QPushButton {{
                background: {theme.ACCENT};
                color: white;
                border: none;
                border-radius: 20px;
                padding: 0 16px;
                font-size: 13px;
                font-weight: 600;
            }}
            QPushButton:!checked {{
                background: transparent;
                color: {theme.TEXT_MUTED};
            }}
            QPushButton:!checked:hover {{
                color: {theme.TEXT};
            }}
        """)

        self.manual_mode_btn = QPushButton("Ручной")
        self.manual_mode_btn.setCheckable(True)
        self.manual_mode_btn.setFixedHeight(36)
        self.manual_mode_btn.clicked.connect(lambda: self.set_mode(ScannerMode.MANUAL))
        self.manual_mode_btn.setStyleSheet(f"""
            QPushButton {{
                background: transparent;
                color: {theme.TEXT_MUTED};
                border: none;
                border-radius: 20px;
                padding: 0 16px;
                font-size: 13px;
            }}
            QPushButton:checked {{
                background: {theme.ACCENT};
                color: white;
                font-weight: 600;
            }}
            QPushButton:hover {{
                color: {theme.TEXT};
            }}
        """)
        
        mode_layout.addWidget(self.scanner_mode_btn)
        mode_layout.addWidget(self.manual_mode_btn)
        
        # Правая группа
        right_actions = QHBoxLayout()
        right_actions.setSpacing(8)
        
        self.reload_btn = QPushButton("Обновить")
        self.reload_btn.setProperty("class", "ghost")
        self.reload_btn.setMinimumHeight(44)
        self.reload_btn.clicked.connect(self.load_products)

        self.delete_btn = QPushButton("Удалить")
        self.delete_btn.setProperty("class", "danger")
        self.delete_btn.setMinimumHeight(44)
        self.delete_btn.clicked.connect(self.delete_selected)
        
        right_actions.addWidget(self.reload_btn)
        right_actions.addWidget(self.delete_btn)
        
        actions_layout.addLayout(left_actions)
        actions_layout.addStretch()
        actions_layout.addWidget(mode_container)
        actions_layout.addStretch()
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
        info_icon.setStyleSheet(f"font-size: 13px; color: {theme.ACCENT}; font-weight: 700;")
        
        self.info_label = QLabel("Готов к сканированию")
        self.info_label.setProperty("class", "muted")
        self.info_label.setStyleSheet("font-size: 13px;")
        
        self.stats_label = QLabel("")
        self.stats_label.setProperty("class", "muted")
        self.stats_label.setStyleSheet("font-size: 12px;")
        
        info_layout.addWidget(info_icon)
        info_layout.addWidget(self.info_label, 1)
        info_layout.addWidget(self.stats_label)
        
        root.addWidget(info_container)

        # === Таблица долгов ===
        self.table = ScannerTable()
        self.table.item_selected.connect(self.on_item_selected)
        root.addWidget(self.table, 1)

        # === Статусная строка ===
        status_bar = QFrame()
        status_bar.setStyleSheet(f"""
            QFrame {{
                background: {theme.BG};
                border: 1px solid {theme.DIVIDER};
                border-radius: 8px;
                padding: 6px 12px;
            }}
        """)
        
        status_layout = QHBoxLayout(status_bar)
        status_layout.setContentsMargins(12, 4, 12, 4)
        
        self.status_label = QLabel("⚡ Ожидание сканирования...")
        self.status_label.setProperty("class", "muted")
        self.status_label.setStyleSheet("font-size: 12px;")
        
        self.shortcut_hint = QLabel("Ctrl+F - фокус на сканер | Enter - добавить")
        self.shortcut_hint.setProperty("class", "muted")
        self.shortcut_hint.setStyleSheet("font-size: 11px; color: #4F5E73;")
        
        status_layout.addWidget(self.status_label)
        status_layout.addStretch()
        status_layout.addWidget(self.shortcut_hint)
        
        root.addWidget(status_bar)

        # Начальная загрузка данных
        self.update_operator_choices()
        self.load_products()
        self.load_debts()
        self.update_stats()
        
    def setup_shortcuts(self):
        """Настройка горячих клавиш"""
        # Ctrl+F - фокус на поле штрихкода
        self.focus_shortcut = QShortcut(QKeySequence("Ctrl+F"), self)
        self.focus_shortcut.activated.connect(self.focus_scanner)
        
        # Ctrl+Enter - добавить долг
        self.add_shortcut = QShortcut(QKeySequence("Ctrl+Return"), self)
        self.add_shortcut.activated.connect(self.add_debt)
        
        # Ctrl+L - очистить форму
        self.clear_shortcut = QShortcut(QKeySequence("Ctrl+L"), self)
        self.clear_shortcut.activated.connect(self.clear_form)
        
    def focus_scanner(self):
        """Фокус на поле ввода штрихкода"""
        self.scanner_form.barcode_input.setFocus()
        self.scanner_form.barcode_input.selectAll()
        self.status_label.setText("⚡ Режим сканирования")
        
    def set_mode(self, mode: ScannerMode):
        """Установка режима работы"""
        self.scanner_mode_btn.setChecked(mode == ScannerMode.SCANNER)
        self.manual_mode_btn.setChecked(mode == ScannerMode.MANUAL)
        self.scanner_card.set_mode(mode)
        self.scanner_form.set_mode(mode)
        
        if mode == ScannerMode.SCANNER:
            self.status_label.setText("⚡ Режим сканера - отсканируйте штрихкод")
        else:
            self.status_label.setText("✍️ Ручной режим - введите данные вручную")
            
    def update_operator_choices(self):
        """Обновление списка операторов"""
        operators = ((self.main_window.bootstrap_data or {}).get("operators") or [])
        current_id = self.selected_operator_id()
        self.scanner_form.set_operators(operators, current_id)
        
    def selected_operator_id(self) -> Optional[str]:
        """Получение ID выбранного оператора"""
        return self.scanner_form.selected_operator_id()
        
    def load_products(self):
        """Загрузка списка товаров"""
        if not self.main_window.api:
            self.products = []
            self.update_product_choices()
            return
            
        try:
            response = self.main_window.api.list_products()
            self.products = ((response.get("data") or {}).get("products") or [])
            self.info_label.setText(f"📦 Товаров в каталоге: {len(self.products)}")
        except Exception as error:
            self.products = []
            self.info_label.setText(f"⚠️ Каталог недоступен: {error}")
            
        self.update_product_choices()
        
    def update_product_choices(self):
        """Обновление выпадающего списка товаров"""
        current_barcode = self.current_product_barcode()
        self.scanner_form.set_products(self.products, current_barcode)
        
    def current_product_barcode(self) -> Optional[str]:
        """Получение штрихкода текущего товара"""
        product = self.scanner_form.current_product()
        return str(product.get("barcode")) if product else None
        
    def on_product_scanned(self, product: Dict):
        """Обработка сканирования товара"""
        self.scan_count += 1
        self.scan_count_label.setText(f"{self.scan_count} сканирований")
        
        name = product.get("name", "Товар")
        price = int(product.get("price", 0))
        
        self.scanner_card.set_last_scan(name, price)
        self.status_label.setText(f"✅ Отсканирован: {name}")
        
        # Вибрируем поле ввода для обратной связи
        self.scanner_form.barcode_input.setStyleSheet(f"""
            QLineEdit {{
                background: {theme.CARD};
                border: 2px solid {theme.SUCCESS};
                border-radius: 10px;
                padding: 0 12px;
                font-size: 14px;
            }}
        """)
        
        # Возвращаем обычный стиль через 300ms
        QTimer.singleShot(300, self.reset_barcode_style)
        
    def reset_barcode_style(self):
        """Сброс стиля поля ввода штрихкода"""
        self.scanner_form.barcode_input.setStyleSheet("")
        
    def on_item_selected(self, item: Dict):
        """Обработка выбора элемента в таблице"""
        self.status_label.setText(f"👆 Выбран долг: {item.get('debtor_name')} - {format_money(item.get('total_amount', 0))} ₸")
        
    def update_stats(self):
        """Обновление статистики"""
        total_items = len(self.items)
        pending_items = sum(1 for i in self.items if i.get("status") == "pending")
        total_amount = sum(int(i.get("total_amount") or 0) for i in self.items)
        
        self.stats_label.setText(
            f"📊 Всего: {total_items} • В очереди: {pending_items} • Сумма: {format_money(total_amount)} ₸"
        )
        self.total_amount_label.setText(f"{format_money(total_amount)} ₸")
        
    def add_debt(self):
        """Добавление нового долга"""
        if not self.main_window.current_operator:
            QMessageBox.warning(self, "Сканер", "Сначала войдите как оператор.")
            return
            
        if not self.main_window.api:
            QMessageBox.warning(self, "Сканер", "Сначала подключите точку.")
            return

        payload = self.scanner_form.get_payload()
        if not payload:
            return

        try:
            self.main_window.api.create_debt(payload)
            self.show_success("✅ Долг добавлен", "Долг успешно сохранён на сервере")
            self.scanner_form.clear()
            self.load_debts()
            self.save_draft()
            
            if self.main_window.debt_tab:
                self.main_window.debt_tab.load_debts()
                
        except Exception as error:
            # Сохраняем в оффлайн-очередь
            self.main_window.queue.enqueue_debt_action("createDebt", payload)
            self.main_window.refresh_queue_label()
            self.save_draft()
            self.load_debts()
            
            self.show_warning(
                "⏳ Оффлайн-режим",
                f"Долг сохранён локально и будет отправлен позже.\n\n{error}"
            )

    def delete_selected(self):
        """Удаление выбранного долга"""
        item = self.table.selected_item()
        if not item:
            QMessageBox.information(self, "Сканер", "Выберите запись для удаления.")
            return

        # Подтверждение
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
            self.show_info("🗑️ Удалено", "Локальный долг удалён из очереди.")
            return

        try:
            self.main_window.api.delete_debt(item_id)
            self.load_debts()
            if self.main_window.debt_tab:
                self.main_window.debt_tab.load_debts()
            self.show_success("🗑️ Удалено", "Запись удалена с сервера.")
            
        except Exception as error:
            # Сохраняем удаление в очередь
            self.main_window.queue.enqueue_debt_action("deleteDebt", {"item_id": item_id})
            self.main_window.refresh_queue_label()
            self.load_debts()
            
            self.show_warning(
                "⏳ Оффлайн-режим",
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
            
            # Фильтруем удалённые и добавляем штрихкоды
            filtered = []
            for item in items:
                if str(item.get("id")) in pending_deletes:
                    continue
                comment = str(item.get("comment") or "")
                barcode = comment.split("barcode:", 1)[1].strip() if "barcode:" in comment else "—"
                filtered.append({**item, "barcode": barcode})
                
            self.items = pending_items + filtered
            self.update_table()
            self.update_stats()
            
        except Exception as error:
            self.items = pending_items
            self.update_table()
            self.info_label.setText(f"⚠️ Ошибка загрузки: {error}")

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

            comment = str(payload.get("comment") or "")
            barcode = comment.split("barcode:", 1)[1].strip() if "barcode:" in comment else ""
            
            qty = int(payload.get("quantity") or 1)
            unit_price = int(payload.get("unit_price") or 0)
            total_amount = int(payload.get("total_amount") or qty * unit_price)
            
            pending_items.append({
                "id": f"local-{action['id']}",
                "debtor_name": str(payload.get("client_name") or "Должник"),
                "item_name": str(payload.get("item_name") or "Товар"),
                "barcode": barcode,
                "quantity": qty,
                "total_amount": total_amount,
                "status": "pending",
            })
            
        return pending_items, pending_deletes

    def update_table(self):
        """Обновление таблицы"""
        self.table.set_items(self.items)

    def save_draft(self):
        """Сохранение черновика"""
        self.main_window.config["scanner_draft"] = {
            "selected_operator_id": self.selected_operator_id(),
            "manual_name": self.scanner_form.manual_name.text(),
            "barcode": self.scanner_form.barcode_input.text(),
            "current_index": self.scanner_form.product_box.currentIndex(),
            "quantity": self.scanner_form.qty_spin.value(),
            "price": self.scanner_form.price_input.text(),
        }
        self.main_window.save_config()

    def load_draft(self):
        """Загрузка черновика"""
        draft = self.main_window.config.get("scanner_draft") or {}
        
        operator_id = str(draft.get("selected_operator_id") or "")
        if operator_id:
            for index in range(self.scanner_form.operator_box.count()):
                data = self.scanner_form.operator_box.itemData(index)
                if isinstance(data, dict) and str(data.get("id")) == operator_id:
                    self.scanner_form.operator_box.setCurrentIndex(index)
                    break
                    
        self.scanner_form.manual_name.setText(str(draft.get("manual_name") or ""))
        self.scanner_form.barcode_input.setText(str(draft.get("barcode") or ""))
        self.scanner_form.qty_spin.setValue(int(draft.get("quantity") or 1))
        self.scanner_form.price_input.setText(str(draft.get("price") or "0"))
        
        current_index = int(draft.get("current_index") or 0)
        if 0 <= current_index < self.scanner_form.product_box.count():
            self.scanner_form.product_box.setCurrentIndex(current_index)
            
        self.scanner_form.on_target_changed()
        self.scanner_form.update_total()

    def clear_form(self):
        """Очистка формы"""
        self.scanner_form.clear()
        self.save_draft()
        self.focus_scanner()

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