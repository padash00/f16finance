from __future__ import annotations

try:
    import openpyxl
    _OPENPYXL_AVAILABLE = True
except ImportError:
    _OPENPYXL_AVAILABLE = False

from PyQt6.QtGui import QIntValidator
from PyQt6.QtWidgets import (
    QFileDialog,
    QFormLayout,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QLineEdit,
    QMessageBox,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
    QCheckBox,
)


def format_money(value: int) -> str:
    return f"{int(value):,}".replace(",", " ")


class ProductsTab(QWidget):
    def __init__(self, main_window):
        super().__init__(main_window)
        self.main_window = main_window
        self.products: list[dict] = []
        self.editing_id: str | None = None
        self.init_ui()
        self.load_products()

    def init_ui(self):
        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(16)

        self.info_label = QLabel("Каталог товаров текущей точки")
        self.info_label.setStyleSheet("font-size: 13px; color: #cbd5e1;")
        root.addWidget(self.info_label)

        form = QFormLayout()
        self.name_input = QLineEdit()
        self.barcode_input = QLineEdit()
        self.price_input = QLineEdit("0")
        self.price_input.setValidator(QIntValidator(0, 9_999_999))
        self.active_check = QCheckBox("Активный товар")
        self.active_check.setChecked(True)
        form.addRow("Название", self.name_input)
        form.addRow("Штрихкод", self.barcode_input)
        form.addRow("Цена", self.price_input)
        form.addRow("", self.active_check)
        root.addLayout(form)

        actions = QHBoxLayout()
        self.reload_btn = QPushButton("Обновить")
        self.reload_btn.clicked.connect(self.load_products)
        self.import_btn = QPushButton("Импорт Excel")
        self.import_btn.clicked.connect(self.import_from_excel)
        self.save_btn = QPushButton("Сохранить")
        self.save_btn.clicked.connect(self.save_product)
        self.clear_btn = QPushButton("Очистить")
        self.clear_btn.clicked.connect(self.clear_form)
        self.delete_btn = QPushButton("Удалить выбранный")
        self.delete_btn.clicked.connect(self.delete_selected)
        actions.addWidget(self.reload_btn)
        actions.addWidget(self.import_btn)
        actions.addStretch(1)
        actions.addWidget(self.clear_btn)
        actions.addWidget(self.save_btn)
        actions.addWidget(self.delete_btn)
        root.addLayout(actions)

        self.table = QTableWidget(0, 5)
        self.table.setHorizontalHeaderLabels(["ID", "Название", "Штрихкод", "Цена", "Статус"])
        self.table.setColumnHidden(0, True)
        self.table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        self.table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeMode.Stretch)
        self.table.itemSelectionChanged.connect(self.fill_from_selection)
        root.addWidget(self.table, 1)

    def require_admin(self):
        creds = self.main_window.admin_credentials
        if not creds or not self.main_window.current_admin:
            QMessageBox.warning(self, "Товары", "Сначала войдите как super-admin.")
            return None
        return creds

    def load_products(self):
        if not self.main_window.api:
            self.products = []
            self.table.setRowCount(0)
            return
        try:
            response = self.main_window.api.list_products()
            self.products = ((response.get("data") or {}).get("products") or [])
            self.info_label.setText(f"Товаров в каталоге: {len(self.products)}")
        except Exception as error:
            self.products = []
            self.info_label.setText(f"Каталог недоступен: {error}")

        self.table.setRowCount(len(self.products))
        for row_index, item in enumerate(self.products):
            self.table.setItem(row_index, 0, QTableWidgetItem(str(item.get("id") or "")))
            self.table.setItem(row_index, 1, QTableWidgetItem(str(item.get("name") or "")))
            self.table.setItem(row_index, 2, QTableWidgetItem(str(item.get("barcode") or "")))
            self.table.setItem(row_index, 3, QTableWidgetItem(f"{format_money(int(item.get('price') or 0))} ₸"))
            self.table.setItem(row_index, 4, QTableWidgetItem("Активен" if item.get("is_active") else "Выключен"))

    def selected_product(self):
        row = self.table.currentRow()
        if row < 0 or row >= len(self.products):
            return None
        return self.products[row]

    def fill_from_selection(self):
        item = self.selected_product()
        if not item:
            return
        self.editing_id = str(item.get("id") or "")
        self.name_input.setText(str(item.get("name") or ""))
        self.barcode_input.setText(str(item.get("barcode") or ""))
        self.price_input.setText(str(int(item.get("price") or 0)))
        self.active_check.setChecked(item.get("is_active") is not False)

    def clear_form(self):
        self.editing_id = None
        self.name_input.clear()
        self.barcode_input.clear()
        self.price_input.setText("0")
        self.active_check.setChecked(True)
        self.table.clearSelection()

    def save_product(self):
        creds = self.require_admin()
        if not creds or not self.main_window.api:
            return

        name = self.name_input.text().strip()
        barcode = self.barcode_input.text().strip()
        try:
            price = max(0, int((self.price_input.text() or "0").replace(" ", "").replace(",", "")))
        except ValueError:
            price = 0

        if not name:
            QMessageBox.warning(self, "Товары", "Введите название товара.")
            return
        if not barcode:
            QMessageBox.warning(self, "Товары", "Введите штрихкод.")
            return
        if price <= 0:
            QMessageBox.warning(self, "Товары", "Цена должна быть больше нуля.")
            return

        payload = {
            "name": name,
            "barcode": barcode,
            "price": price,
            "is_active": self.active_check.isChecked(),
        }

        try:
            if self.editing_id:
                self.main_window.api.update_product(
                    creds["email"],
                    creds["password"],
                    self.editing_id,
                    payload,
                )
            else:
                self.main_window.api.create_product(
                    creds["email"],
                    creds["password"],
                    payload,
                )
            self.load_products()
            if self.main_window.scanner_tab:
                self.main_window.scanner_tab.load_products()
            self.clear_form()
            QMessageBox.information(self, "Товары", "Каталог обновлён.")
        except Exception as error:
            QMessageBox.critical(self, "Товары", str(error))

    def import_from_excel(self):
        """Import products from an .xlsx file (columns: Название, Штрихкод, Цена)."""
        if not _OPENPYXL_AVAILABLE:
            QMessageBox.critical(
                self, "Excel импорт",
                "Библиотека openpyxl не установлена.\n\nУстановите: pip install openpyxl",
            )
            return

        creds = self.require_admin()
        if not creds or not self.main_window.api:
            return

        path, _ = QFileDialog.getOpenFileName(
            self, "Выберите Excel файл", "", "Excel файлы (*.xlsx *.xls)"
        )
        if not path:
            return

        try:
            wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
            ws = wb.active
        except Exception as error:
            QMessageBox.critical(self, "Excel импорт", f"Не удалось открыть файл:\n{error}")
            return

        rows = list(ws.iter_rows(min_row=2, values_only=True))
        if not rows:
            QMessageBox.warning(self, "Excel импорт", "Файл пустой или содержит только заголовки.")
            return

        added = 0
        skipped = 0
        errors: list[str] = []

        for row_num, row in enumerate(rows, start=2):
            if not row or all(cell is None for cell in row):
                continue

            name = str(row[0] or "").strip() if len(row) > 0 else ""
            barcode = str(row[1] or "").strip() if len(row) > 1 else ""
            try:
                price = max(0, int(float(str(row[2] or 0).replace(" ", "").replace(",", ".")))) if len(row) > 2 else 0
            except (ValueError, TypeError):
                price = 0

            if not name or not barcode or price <= 0:
                skipped += 1
                continue

            try:
                self.main_window.api.create_product(
                    creds["email"],
                    creds["password"],
                    {"name": name, "barcode": barcode, "price": price, "is_active": True},
                )
                added += 1
            except Exception as error:
                errors.append(f"Стр.{row_num} «{name}»: {error}")

        self.load_products()
        if self.main_window.scanner_tab:
            self.main_window.scanner_tab.load_products()

        summary = f"Добавлено: {added}\nПропущено (нет данных): {skipped}"
        if errors:
            summary += f"\nОшибок: {len(errors)}\n" + "\n".join(errors[:5])
        QMessageBox.information(self, "Excel импорт завершён", summary)

    def delete_selected(self):
        creds = self.require_admin()
        item = self.selected_product()
        if not creds or not item or not self.main_window.api:
            return

        if QMessageBox.question(self, "Удаление", "Удалить выбранный товар?") != QMessageBox.StandardButton.Yes:
            return

        try:
            self.main_window.api.delete_product(
                creds["email"],
                creds["password"],
                str(item.get("id") or ""),
            )
            self.load_products()
            if self.main_window.scanner_tab:
                self.main_window.scanner_tab.load_products()
            self.clear_form()
            QMessageBox.information(self, "Товары", "Товар удалён.")
        except Exception as error:
            QMessageBox.critical(self, "Товары", str(error))
