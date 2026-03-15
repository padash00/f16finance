from __future__ import annotations

from PyQt6.QtCore import Qt
from PyQt6.QtGui import QIntValidator
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
)


def parse_money(raw: str) -> int:
    try:
        return max(0, int((raw or "").replace(" ", "").replace(",", "")))
    except ValueError:
        return 0


def format_money(value: int) -> str:
    return f"{int(value):,}".replace(",", " ")


class ScannerTab(QWidget):
    def __init__(self, main_window):
        super().__init__(main_window)
        self.main_window = main_window
        self.products: list[dict] = []
        self.items: list[dict] = []
        self.init_ui()
        self.load_draft()

    def init_ui(self):
        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(16)

        form_group = QGroupBox("Сканер и быстрые долги")
        form = QGridLayout(form_group)

        self.operator_box = QComboBox()
        self.operator_box.currentIndexChanged.connect(self.on_target_changed)
        self.manual_name = QLineEdit()
        self.manual_name.setPlaceholderText("Имя клиента вручную, если это не оператор")

        self.barcode_input = QLineEdit()
        self.barcode_input.setPlaceholderText("Штрихкод")
        self.barcode_input.returnPressed.connect(self.apply_barcode)

        self.product_box = QComboBox()
        self.product_box.setEditable(True)
        self.product_box.currentIndexChanged.connect(self.on_product_changed)

        self.qty_spin = QSpinBox()
        self.qty_spin.setRange(1, 99)
        self.qty_spin.setValue(1)
        self.qty_spin.valueChanged.connect(self.update_total)

        self.price_input = QLineEdit("0")
        self.price_input.setValidator(QIntValidator(0, 9_999_999))
        self.price_input.textChanged.connect(self.update_total)

        self.total_label = QLabel("0 ₸")
        self.total_label.setStyleSheet(
            "font-size: 22px; font-weight: 700; color: #f59e0b; background: #111827; "
            "border: 1px solid #1f2937; border-radius: 12px; padding: 10px 14px;"
        )

        form.addWidget(QLabel("Оператор точки"), 0, 0)
        form.addWidget(self.operator_box, 0, 1)
        form.addWidget(QLabel("Или клиент"), 0, 2)
        form.addWidget(self.manual_name, 0, 3)
        form.addWidget(QLabel("Штрихкод"), 1, 0)
        form.addWidget(self.barcode_input, 1, 1)
        form.addWidget(QLabel("Товар"), 1, 2)
        form.addWidget(self.product_box, 1, 3)
        form.addWidget(QLabel("Количество"), 2, 0)
        form.addWidget(self.qty_spin, 2, 1)
        form.addWidget(QLabel("Цена"), 2, 2)
        form.addWidget(self.price_input, 2, 3)
        form.addWidget(QLabel("Итого"), 3, 2)
        form.addWidget(self.total_label, 3, 3)
        root.addWidget(form_group)

        actions = QHBoxLayout()
        self.reload_products_btn = QPushButton("Обновить товары")
        self.reload_products_btn.clicked.connect(self.load_products)
        self.add_btn = QPushButton("Добавить долг")
        self.add_btn.clicked.connect(self.add_debt)
        self.clear_btn = QPushButton("Очистить")
        self.clear_btn.clicked.connect(self.clear_form)
        actions.addWidget(self.reload_products_btn)
        actions.addStretch(1)
        actions.addWidget(self.clear_btn)
        actions.addWidget(self.add_btn)
        root.addLayout(actions)

        self.info_label = QLabel("Активные долги по сканеру")
        self.info_label.setStyleSheet("font-size: 13px; color: #cbd5e1;")
        root.addWidget(self.info_label)

        self.table = QTableWidget(0, 7)
        self.table.setHorizontalHeaderLabels(["ID", "Должник", "Товар", "Штрихкод", "Кол-во", "Сумма", "Статус"])
        self.table.setColumnHidden(0, True)
        self.table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        self.table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeMode.Stretch)
        self.table.horizontalHeader().setSectionResizeMode(3, QHeaderView.ResizeMode.Stretch)
        root.addWidget(self.table, 1)

        delete_row = QHBoxLayout()
        self.delete_btn = QPushButton("Удалить выбранное")
        self.delete_btn.clicked.connect(self.delete_selected)
        delete_row.addStretch(1)
        delete_row.addWidget(self.delete_btn)
        root.addLayout(delete_row)

        self.update_operator_choices()
        self.on_target_changed()
        self.load_products()
        self.load_debts()
        self.update_total()

    def update_operator_choices(self):
        operators = ((self.main_window.bootstrap_data or {}).get("operators") or [])
        current_id = self.selected_operator_id()
        self.operator_box.blockSignals(True)
        self.operator_box.clear()
        self.operator_box.addItem("Ручной клиент / без оператора", None)
        for operator in operators:
            name = operator.get("full_name") or operator.get("name") or operator.get("short_name") or "Оператор"
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

    def selected_operator(self):
        data = self.operator_box.currentData()
        return data if isinstance(data, dict) else None

    def selected_operator_id(self) -> str | None:
        operator = self.selected_operator()
        return str(operator.get("id")) if operator and operator.get("id") else None

    def on_target_changed(self):
        has_operator = self.selected_operator() is not None
        self.manual_name.setEnabled(not has_operator)
        if has_operator:
            self.manual_name.clear()

    def load_products(self):
        if not self.main_window.api:
            self.products = []
            self.refresh_product_choices()
            return
        try:
            response = self.main_window.api.list_products()
            self.products = ((response.get("data") or {}).get("products") or [])
            self.info_label.setText(f"Товаров в каталоге: {len(self.products)}")
        except Exception as error:
            self.products = []
            self.info_label.setText(f"Каталог недоступен: {error}")
        self.refresh_product_choices()

    def refresh_product_choices(self):
        current_barcode = self.current_product_barcode()
        self.product_box.blockSignals(True)
        self.product_box.clear()
        self.product_box.addItem("Выберите товар", None)
        for product in self.products:
            if product.get("is_active") is False:
                continue
            label = f"{product.get('name', 'Товар')} ({product.get('barcode', '—')})"
            self.product_box.addItem(label, product)
        if current_barcode:
            for index in range(self.product_box.count()):
                data = self.product_box.itemData(index)
                if isinstance(data, dict) and str(data.get("barcode")) == current_barcode:
                    self.product_box.setCurrentIndex(index)
                    break
        self.product_box.blockSignals(False)
        self.on_product_changed()

    def current_product(self):
        data = self.product_box.currentData()
        return data if isinstance(data, dict) else None

    def current_product_barcode(self) -> str | None:
        product = self.current_product()
        return str(product.get("barcode")) if product and product.get("barcode") else None

    def on_product_changed(self):
        product = self.current_product()
        if not product:
            self.update_total()
            return
        self.barcode_input.setText(str(product.get("barcode") or ""))
        self.price_input.setText(str(int(product.get("price") or 0)))
        self.update_total()

    def apply_barcode(self):
        barcode = self.barcode_input.text().strip()
        if not barcode:
            return
        for index in range(self.product_box.count()):
            data = self.product_box.itemData(index)
            if isinstance(data, dict) and str(data.get("barcode") or "") == barcode:
                self.product_box.setCurrentIndex(index)
                return
        QMessageBox.warning(self, "Сканер", f"Товар со штрихкодом {barcode} не найден в каталоге.")

    def update_total(self):
        total = self.qty_spin.value() * parse_money(self.price_input.text())
        self.total_label.setText(f"{format_money(total)} ₸")

    def create_payload(self) -> dict | None:
        product = self.current_product()
        if not product:
            QMessageBox.warning(self, "Сканер", "Выберите товар из каталога.")
            return None

        operator = self.selected_operator()
        operator_id = str(operator.get("id")) if operator and operator.get("id") else None
        client_name = self.manual_name.text().strip()
        if operator:
            client_name = operator.get("full_name") or operator.get("name") or operator.get("short_name") or client_name

        if not client_name:
            QMessageBox.warning(self, "Сканер", "Выберите оператора точки или введите имя клиента.")
            return None

        quantity = int(self.qty_spin.value())
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
            "local_ref": (
                f"scanner:{operator_id or client_name}:{product.get('barcode')}:{quantity}:{unit_price}"
            ),
        }

    def add_debt(self):
        if not self.main_window.current_operator:
            QMessageBox.warning(self, "Сканер", "Сначала войдите как оператор.")
            return
        if not self.main_window.api:
            QMessageBox.warning(self, "Сканер", "Сначала подключите точку.")
            return

        payload = self.create_payload()
        if not payload:
            return

        try:
            self.main_window.api.create_debt(payload)
            QMessageBox.information(self, "Сканер", "Долг по товару сохранён в Orda Control.")
            self.clear_form()
            self.load_debts()
            if self.main_window.debt_tab:
                self.main_window.debt_tab.load_debts()
        except Exception as error:
            self.main_window.queue.enqueue_debt_action("createDebt", payload)
            self.main_window.refresh_queue_label()
            self.save_draft()
            self.load_debts()
            QMessageBox.warning(
                self,
                "Оффлайн-очередь",
                "Долг по товару сохранён локально и будет отправлен позже.\n\n" + str(error),
            )

    def pending_debt_view(self):
        pending_actions = self.main_window.queue.list_pending_debt_actions(200)
        pending_items: list[dict] = []
        pending_deletes: set[str] = set()
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
            pending_items.append(
                {
                    "id": f"local-{action['id']}",
                    "debtor_name": str(payload.get("client_name") or "Должник"),
                    "item_name": str(payload.get("item_name") or "Товар"),
                    "barcode": barcode,
                    "quantity": int(payload.get("quantity") or 1),
                    "total_amount": int(payload.get("total_amount") or 0),
                    "status": "pending",
                }
            )
        return pending_items, pending_deletes

    def load_debts(self):
        if not self.main_window.api:
            self.items = []
            self.table.setRowCount(0)
            return

        pending_items, pending_deletes = self.pending_debt_view()
        try:
            response = self.main_window.api.list_debts()
            items = ((response.get("data") or {}).get("items") or [])
        except Exception as error:
            items = []
            self.info_label.setText(f"Список долгов недоступен: {error}")

        filtered = []
        for item in items:
            if str(item.get("id")) in pending_deletes:
                continue
            comment = str(item.get("comment") or "")
            barcode = comment.split("barcode:", 1)[1].strip() if "barcode:" in comment else ""
            filtered.append({**item, "barcode": barcode})

        self.items = pending_items + filtered
        self.table.setRowCount(len(self.items))
        for row_index, item in enumerate(self.items):
            self.table.setItem(row_index, 0, QTableWidgetItem(str(item.get("id") or "")))
            self.table.setItem(row_index, 1, QTableWidgetItem(str(item.get("debtor_name") or "")))
            self.table.setItem(row_index, 2, QTableWidgetItem(str(item.get("item_name") or "")))
            self.table.setItem(row_index, 3, QTableWidgetItem(str(item.get("barcode") or "—")))
            self.table.setItem(row_index, 4, QTableWidgetItem(str(item.get("quantity") or 0)))
            self.table.setItem(row_index, 5, QTableWidgetItem(f"{format_money(int(item.get('total_amount') or 0))} ₸"))
            self.table.setItem(row_index, 6, QTableWidgetItem("В очереди" if item.get("status") == "pending" else "Активен"))

    def delete_selected(self):
        row = self.table.currentRow()
        if row < 0:
            QMessageBox.information(self, "Сканер", "Выберите запись для удаления.")
            return

        item = self.items[row]
        if QMessageBox.question(self, "Удаление", "Удалить выбранный долг?") != QMessageBox.StandardButton.Yes:
            return

        item_id = str(item.get("id") or "")
        if item_id.startswith("local-"):
            queue_id = int(item_id.split("-", 1)[1])
            self.main_window.queue.remove_debt_action(queue_id)
            self.main_window.refresh_queue_label()
            self.load_debts()
            return

        try:
            self.main_window.api.delete_debt(item_id)
            self.load_debts()
            if self.main_window.debt_tab:
                self.main_window.debt_tab.load_debts()
            QMessageBox.information(self, "Сканер", "Запись удалена.")
        except Exception as error:
            self.main_window.queue.enqueue_debt_action("deleteDebt", {"item_id": item_id})
            self.main_window.refresh_queue_label()
            self.load_debts()
            QMessageBox.warning(
                self,
                "Оффлайн-очередь",
                "Удаление сохранено в очередь и будет выполнено позже.\n\n" + str(error),
            )

    def save_draft(self):
        self.main_window.config["scanner_draft"] = {
            "selected_operator_id": self.selected_operator_id(),
            "manual_name": self.manual_name.text(),
            "barcode": self.barcode_input.text(),
            "current_index": self.product_box.currentIndex(),
            "quantity": self.qty_spin.value(),
            "price": self.price_input.text(),
        }
        self.main_window.save_config()

    def load_draft(self):
        draft = self.main_window.config.get("scanner_draft") or {}
        operator_id = str(draft.get("selected_operator_id") or "")
        if operator_id:
            for index in range(self.operator_box.count()):
                data = self.operator_box.itemData(index)
                if isinstance(data, dict) and str(data.get("id")) == operator_id:
                    self.operator_box.setCurrentIndex(index)
                    break
        self.manual_name.setText(str(draft.get("manual_name") or ""))
        self.barcode_input.setText(str(draft.get("barcode") or ""))
        self.qty_spin.setValue(int(draft.get("quantity") or 1))
        self.price_input.setText(str(draft.get("price") or "0"))
        current_index = int(draft.get("current_index") or 0)
        if 0 <= current_index < self.product_box.count():
            self.product_box.setCurrentIndex(current_index)
        self.on_target_changed()
        self.update_total()

    def clear_form(self):
        self.operator_box.setCurrentIndex(0)
        self.manual_name.clear()
        self.barcode_input.clear()
        self.product_box.setCurrentIndex(0)
        self.qty_spin.setValue(1)
        self.price_input.setText("0")
        self.on_target_changed()
        self.update_total()
        self.save_draft()
