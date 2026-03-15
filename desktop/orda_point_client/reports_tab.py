from __future__ import annotations

from PyQt6.QtCore import Qt
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
)


def format_money(value: int | float | None) -> str:
    return f"{int(value or 0):,}".replace(",", " ")


class ReportsTab(QWidget):
    def __init__(self, main_window):
        super().__init__(main_window)
        self.main_window = main_window
        self.init_ui()
        self.load_data()

    def init_ui(self):
        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(16)

        top = QHBoxLayout()
        self.info_label = QLabel("Сводки точки")
        self.info_label.setStyleSheet("font-size: 13px; color: #cbd5e1;")
        self.refresh_btn = QPushButton("Обновить")
        self.refresh_btn.clicked.connect(self.load_data)
        top.addWidget(self.info_label)
        top.addStretch(1)
        top.addWidget(self.refresh_btn)
        root.addLayout(top)

        upper = QSplitter(Qt.Orientation.Horizontal)
        self.warehouse_table = self.create_table(["Код", "Товар", "Шт"])
        self.workers_table = self.create_table(["Имя", "Долг"])
        self.clients_table = self.create_table(["Имя", "Долг"])
        upper.addWidget(self.wrap_box("Склад (долги)", self.warehouse_table))
        upper.addWidget(self.wrap_box("Сотрудники", self.workers_table))
        upper.addWidget(self.wrap_box("Клиенты", self.clients_table))
        root.addWidget(upper, 1)

        lower = QSplitter(Qt.Orientation.Horizontal)
        self.history_table = self.create_table(["Дата", "Должник", "Товар", "Штрихкод", "Сумма", "Статус"])
        self.shifts_table = self.create_table(["Дата", "Оператор", "Смена", "Выручка", "Зона", "Комментарий"])
        lower.addWidget(self.wrap_box("История долгов", self.history_table))
        lower.addWidget(self.wrap_box("История смен", self.shifts_table))
        root.addWidget(lower, 1)

    def create_table(self, headers: list[str]):
        table = QTableWidget(0, len(headers))
        table.setHorizontalHeaderLabels(headers)
        table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.ResizeToContents)
        for index in range(1, len(headers)):
            table.horizontalHeader().setSectionResizeMode(index, QHeaderView.ResizeMode.Stretch)
        return table

    def wrap_box(self, title: str, table: QTableWidget):
        wrapper = QWidget()
        layout = QVBoxLayout(wrapper)
        layout.setContentsMargins(0, 0, 0, 0)
        title_label = QLabel(title)
        title_label.setStyleSheet("font-size: 15px; font-weight: 700; color: #e2e8f0;")
        layout.addWidget(title_label)
        layout.addWidget(table, 1)
        return wrapper

    def load_data(self):
        if not self.main_window.api:
            self.info_label.setText("API недоступен")
            return
        try:
            response = self.main_window.api.get_reports()
            data = (response.get("data") or {}) if isinstance(response, dict) else {}
        except Exception as error:
            self.info_label.setText(f"Сводка недоступна: {error}")
            return

        warehouse = data.get("warehouse") or []
        worker_totals = data.get("worker_totals") or []
        client_totals = data.get("client_totals") or []
        debt_history = data.get("debt_history") or []
        shifts = data.get("shifts") or []

        self.info_label.setText(
            f"Склад: {len(warehouse)} • Сотрудники: {len(worker_totals)} • Клиенты: {len(client_totals)} • Смены: {len(shifts)}"
        )

        self.fill_warehouse(warehouse)
        self.fill_totals(self.workers_table, worker_totals)
        self.fill_totals(self.clients_table, client_totals)
        self.fill_debt_history(debt_history)
        self.fill_shifts(shifts)

    def fill_warehouse(self, rows: list[dict]):
        self.warehouse_table.setRowCount(len(rows))
        for index, item in enumerate(rows):
            self.warehouse_table.setItem(index, 0, QTableWidgetItem(str(item.get("barcode") or "—")))
            self.warehouse_table.setItem(index, 1, QTableWidgetItem(str(item.get("item_name") or "")))
            self.warehouse_table.setItem(index, 2, QTableWidgetItem(str(item.get("quantity") or 0)))

    def fill_totals(self, table: QTableWidget, rows: list[dict]):
        table.setRowCount(len(rows))
        for index, item in enumerate(rows):
            table.setItem(index, 0, QTableWidgetItem(str(item.get("name") or "")))
            table.setItem(index, 1, QTableWidgetItem(f"{format_money(item.get('total_amount'))} ₸"))

    def fill_debt_history(self, rows: list[dict]):
        self.history_table.setRowCount(len(rows))
        for index, item in enumerate(rows):
            self.history_table.setItem(index, 0, QTableWidgetItem(str(item.get("created_at") or "")))
            self.history_table.setItem(index, 1, QTableWidgetItem(str(item.get("debtor_name") or "")))
            self.history_table.setItem(index, 2, QTableWidgetItem(str(item.get("item_name") or "")))
            self.history_table.setItem(index, 3, QTableWidgetItem(str(item.get("barcode") or "—")))
            self.history_table.setItem(index, 4, QTableWidgetItem(f"{format_money(item.get('total_amount'))} ₸"))
            self.history_table.setItem(index, 5, QTableWidgetItem("Активен" if item.get("status") == "active" else "Удалён"))

    def fill_shifts(self, rows: list[dict]):
        self.shifts_table.setRowCount(len(rows))
        for index, item in enumerate(rows):
            self.shifts_table.setItem(index, 0, QTableWidgetItem(str(item.get("date") or "")))
            self.shifts_table.setItem(index, 1, QTableWidgetItem(str(item.get("operator_name") or "")))
            self.shifts_table.setItem(index, 2, QTableWidgetItem(str(item.get("shift") or "")))
            self.shifts_table.setItem(index, 3, QTableWidgetItem(f"{format_money(item.get('actual_amount'))} ₸"))
            self.shifts_table.setItem(index, 4, QTableWidgetItem(str(item.get("zone") or "")))
            self.shifts_table.setItem(index, 5, QTableWidgetItem(str(item.get("comment") or "")))
