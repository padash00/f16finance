from __future__ import annotations

import uuid

from PyQt6.QtCore import QDate
from PyQt6.QtGui import QIntValidator
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
)


def parse_money(raw: str) -> int:
    try:
        return max(0, int((raw or "").replace(" ", "").replace(",", "")))
    except ValueError:
        return 0


def format_money(value: int) -> str:
    return f"{int(value):,}".replace(",", " ")


class DebtTab(QWidget):
    def __init__(self, main_window):
        super().__init__(main_window)
        self.main_window = main_window
        self.items: list[dict] = []
        self.init_ui()
        self.load_draft()

    def init_ui(self):
        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(16)

        form_group = QGroupBox("Добавить долг")
        form = QGridLayout(form_group)

        self.operator_box = QComboBox()
        self.operator_box.currentIndexChanged.connect(self.on_target_changed)
        self.manual_name = QLineEdit()
        self.manual_name.setPlaceholderText("Имя клиента вручную, если это не оператор")
        self.item_name = QLineEdit()
        self.item_name.setPlaceholderText("Товар / причина долга")
        self.qty_spin = QSpinBox()
        self.qty_spin.setRange(1, 99)
        self.qty_spin.setValue(1)
        self.qty_spin.valueChanged.connect(self.update_total)
        self.price_input = QLineEdit("0")
        self.price_input.setValidator(QIntValidator(0, 9_999_999))
        self.price_input.textChanged.connect(self.update_total)
        self.debt_date = QDateEdit()
        self.debt_date.setCalendarPopup(True)
        self.debt_date.setDate(QDate.currentDate())
        self.comment_edit = QPlainTextEdit()
        self.comment_edit.setPlaceholderText("Комментарий к долгу")
        self.comment_edit.setFixedHeight(72)
        self.total_label = QLabel("0 ₸")
        self.total_label.setStyleSheet(
            "font-size: 22px; font-weight: 700; color: #f59e0b; background: #111827; "
            "border: 1px solid #1f2937; border-radius: 12px; padding: 10px 14px;"
        )

        form.addWidget(QLabel("Оператор точки"), 0, 0)
        form.addWidget(self.operator_box, 0, 1)
        form.addWidget(QLabel("Или клиент"), 0, 2)
        form.addWidget(self.manual_name, 0, 3)
        form.addWidget(QLabel("Товар / причина"), 1, 0)
        form.addWidget(self.item_name, 1, 1, 1, 3)
        form.addWidget(QLabel("Количество"), 2, 0)
        form.addWidget(self.qty_spin, 2, 1)
        form.addWidget(QLabel("Цена"), 2, 2)
        form.addWidget(self.price_input, 2, 3)
        form.addWidget(QLabel("Дата"), 3, 0)
        form.addWidget(self.debt_date, 3, 1)
        form.addWidget(QLabel("Итого"), 3, 2)
        form.addWidget(self.total_label, 3, 3)
        form.addWidget(QLabel("Комментарий"), 4, 0)
        form.addWidget(self.comment_edit, 4, 1, 1, 3)
        root.addWidget(form_group)

        actions = QHBoxLayout()
        self.add_btn = QPushButton("Добавить долг")
        self.add_btn.clicked.connect(self.add_debt)
        self.clear_btn = QPushButton("Очистить")
        self.clear_btn.clicked.connect(self.clear_form)
        self.refresh_btn = QPushButton("Обновить список")
        self.refresh_btn.clicked.connect(self.load_debts)
        self.delete_btn = QPushButton("Удалить выбранное")
        self.delete_btn.clicked.connect(self.delete_selected)
        actions.addWidget(self.add_btn)
        actions.addWidget(self.clear_btn)
        actions.addStretch(1)
        actions.addWidget(self.refresh_btn)
        actions.addWidget(self.delete_btn)
        root.addLayout(actions)

        self.info_label = QLabel("Активные долги точки")
        self.info_label.setStyleSheet("font-size: 13px; color: #cbd5e1;")
        root.addWidget(self.info_label)

        self.table = QTableWidget(0, 7)
        self.table.setHorizontalHeaderLabels(["ID", "Должник", "Товар", "Кол-во", "Цена", "Сумма", "Статус"])
        self.table.setColumnHidden(0, True)
        self.table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        self.table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeMode.Stretch)
        root.addWidget(self.table, 1)

        self.update_operator_choices()
        self.on_target_changed()
        self.update_total()

    def set_operator_enabled(self, enabled: bool):
        self.setEnabled(enabled)
        if enabled:
            self.load_debts()

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
                if isinstance(data, dict) and data.get("id") == current_id:
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

    def set_current_operator(self, operator: dict | None):
        target_id = str(operator.get("operator_id")) if operator and operator.get("operator_id") else None
        if not target_id:
            return
        for index in range(self.operator_box.count()):
            data = self.operator_box.itemData(index)
            if isinstance(data, dict) and str(data.get("id")) == target_id:
                self.operator_box.setCurrentIndex(index)
                break

    def update_total(self):
        total = self.qty_spin.value() * parse_money(self.price_input.text())
        self.total_label.setText(f"{format_money(total)} ₸")

    def debt_payload(self) -> dict | None:
        operator = self.selected_operator()
        operator_id = str(operator.get("id")) if operator and operator.get("id") else None
        client_name = self.manual_name.text().strip()
        if operator:
            client_name = (
                operator.get("full_name")
                or operator.get("name")
                or operator.get("short_name")
                or client_name
            )

        item_name = self.item_name.text().strip()
        quantity = int(self.qty_spin.value())
        unit_price = parse_money(self.price_input.text())
        total_amount = quantity * unit_price

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

    def add_debt(self):
        if not self.main_window.current_operator:
            QMessageBox.warning(self, "Долг", "Сначала войдите как оператор.")
            return

        if not self.main_window.api:
            QMessageBox.warning(self, "Долг", "Сначала подключите точку.")
            return

        payload = self.debt_payload()
        if not payload:
            return

        try:
            self.main_window.api.create_debt(payload)
            QMessageBox.information(self, "Долг", "Долг сохранён в Orda Control.")
            self.clear_form()
            self.load_debts()
        except Exception as error:
            self.main_window.queue.enqueue_debt_action("createDebt", payload)
            self.main_window.refresh_queue_label()
            self.save_draft()
            self.load_debts()
            QMessageBox.warning(
                self,
                "Оффлайн-очередь",
                "Долг сохранён локально и будет отправлен позже.\n\n" + str(error),
            )

    def delete_selected(self):
        row = self.table.currentRow()
        if row < 0:
            QMessageBox.information(self, "Долг", "Выберите запись для удаления.")
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

        if not self.main_window.api:
            QMessageBox.warning(self, "Долг", "Сначала подключите точку.")
            return

        try:
            self.main_window.api.delete_debt(item_id)
            self.load_debts()
            QMessageBox.information(self, "Долг", "Запись удалена.")
        except Exception as error:
            self.main_window.queue.enqueue_debt_action("deleteDebt", {"item_id": item_id})
            self.main_window.refresh_queue_label()
            self.load_debts()
            QMessageBox.warning(
                self,
                "Оффлайн-очередь",
                "Удаление сохранено в очередь и будет выполнено позже.\n\n" + str(error),
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

            qty = int(payload.get("quantity") or 1)
            unit_price = int(payload.get("unit_price") or 0)
            total_amount = int(payload.get("total_amount") or qty * unit_price)
            pending_items.append(
                {
                    "id": f"local-{action['id']}",
                    "debtor_name": str(payload.get("client_name") or "Должник"),
                    "item_name": str(payload.get("item_name") or "Новая запись"),
                    "quantity": qty,
                    "unit_price": unit_price,
                    "total_amount": total_amount,
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
            self.info_label.setText(
                f"Активные долги точки: {len(items)} • В очереди: {len(pending_items)}"
            )
        except Exception as error:
            items = []
            self.info_label.setText(f"Сервер недоступен: {error}")

        filtered = [item for item in items if str(item.get("id")) not in pending_deletes]
        self.items = pending_items + filtered
        self.table.setRowCount(len(self.items))

        for row_index, item in enumerate(self.items):
            self.table.setItem(row_index, 0, QTableWidgetItem(str(item.get("id") or "")))
            self.table.setItem(row_index, 1, QTableWidgetItem(str(item.get("debtor_name") or item.get("client_name") or "")))
            self.table.setItem(row_index, 2, QTableWidgetItem(str(item.get("item_name") or "")))
            self.table.setItem(row_index, 3, QTableWidgetItem(str(item.get("quantity") or 0)))
            self.table.setItem(row_index, 4, QTableWidgetItem(format_money(int(item.get("unit_price") or 0))))
            self.table.setItem(row_index, 5, QTableWidgetItem(f"{format_money(int(item.get('total_amount') or 0))} ₸"))
            self.table.setItem(row_index, 6, QTableWidgetItem("В очереди" if item.get("status") == "pending" else "Активен"))

    def save_draft(self):
        self.main_window.config["debt_draft"] = {
            "selected_operator_id": self.selected_operator_id(),
            "manual_name": self.manual_name.text(),
            "item_name": self.item_name.text(),
            "quantity": self.qty_spin.value(),
            "unit_price": self.price_input.text(),
            "comment": self.comment_edit.toPlainText(),
            "date": self.debt_date.date().toString("yyyy-MM-dd"),
        }
        self.main_window.save_config()

    def load_draft(self):
        draft = self.main_window.config.get("debt_draft") or {}
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

    def clear_form(self):
        self.operator_box.setCurrentIndex(0)
        self.manual_name.clear()
        self.item_name.clear()
        self.qty_spin.setValue(1)
        self.price_input.setText("0")
        self.debt_date.setDate(QDate.currentDate())
        self.comment_edit.clear()
        self.on_target_changed()
        self.update_total()
        self.save_draft()
