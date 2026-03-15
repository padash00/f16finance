from __future__ import annotations

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
)


class AdminTerminalTab(QWidget):
    def __init__(self, main_window):
        super().__init__(main_window)
        self.main_window = main_window
        self.devices: list[dict] = []
        self.init_ui()

    def init_ui(self):
        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(16)

        self.info_label = QLabel(
            "Super Admin режим. Здесь можно привязать программу к точке и сохранить device token локально."
        )
        self.info_label.setWordWrap(True)
        self.info_label.setStyleSheet("font-size: 13px; color: #cbd5e1;")
        root.addWidget(self.info_label)

        current = QHBoxLayout()
        self.current_label = QLabel("Текущая точка: не привязана")
        self.current_label.setStyleSheet(
            "font-size: 14px; color: #e2e8f0; background: #111827; border: 1px solid #1f2937; "
            "border-radius: 12px; padding: 10px 14px;"
        )
        current.addWidget(self.current_label, 1)
        root.addLayout(current)

        actions = QHBoxLayout()
        self.refresh_btn = QPushButton("Обновить устройства")
        self.refresh_btn.clicked.connect(self.load_devices)
        self.apply_btn = QPushButton("Привязать выбранную точку")
        self.apply_btn.clicked.connect(self.apply_selected)
        self.clear_btn = QPushButton("Сбросить привязку")
        self.clear_btn.clicked.connect(self.clear_binding)
        actions.addWidget(self.refresh_btn)
        actions.addWidget(self.apply_btn)
        actions.addWidget(self.clear_btn)
        actions.addStretch(1)
        root.addLayout(actions)

        self.table = QTableWidget(0, 6)
        self.table.setHorizontalHeaderLabels(["ID", "Точка", "Устройство", "Режим", "Флаги", "Статус"])
        self.table.setColumnHidden(0, True)
        self.table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        self.table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeMode.Stretch)
        root.addWidget(self.table, 1)

        self.refresh_current_label()

    def refresh_current_label(self):
        company = ((self.main_window.bootstrap_data or {}).get("company") or {}) if self.main_window.bootstrap_data else {}
        device = ((self.main_window.bootstrap_data or {}).get("device") or {}) if self.main_window.bootstrap_data else {}
        token = str(self.main_window.config.get("device_token") or "").strip()
        if company:
            self.current_label.setText(
                f"Текущая точка: {company.get('name', '—')} • {device.get('name', 'device')} • token сохранён"
            )
        elif token:
            self.current_label.setText("Текущая точка: token сохранён, но bootstrap ещё не выполнен")
        else:
            self.current_label.setText("Текущая точка: не привязана")

    def load_devices(self):
        creds = self.main_window.admin_credentials
        if not creds or not self.main_window.api:
            QMessageBox.warning(self, "Super Admin", "Сначала войдите как super-admin.")
            return

        try:
            response = self.main_window.api.list_admin_devices(creds["email"], creds["password"])
            self.devices = ((response.get("data") or {}).get("devices") or [])
        except Exception as error:
            QMessageBox.critical(self, "Super Admin", str(error))
            return

        self.table.setRowCount(len(self.devices))
        for row_index, device in enumerate(self.devices):
            company = device.get("company") or {}
            flags = device.get("feature_flags") or {}
            flags_text = ", ".join(
                label
                for key, label in (
                    ("shift_report", "Смена"),
                    ("income_report", "Доход"),
                    ("debt_report", "Долги"),
                )
                if flags.get(key)
            ) or "Без модулей"
            status = "Активно" if device.get("is_active") else "Выключено"

            self.table.setItem(row_index, 0, QTableWidgetItem(str(device.get("id") or "")))
            self.table.setItem(row_index, 1, QTableWidgetItem(str(company.get("name") or "Точка")))
            self.table.setItem(row_index, 2, QTableWidgetItem(str(device.get("name") or "Устройство")))
            self.table.setItem(row_index, 3, QTableWidgetItem(str(device.get("point_mode") or "—")))
            self.table.setItem(row_index, 4, QTableWidgetItem(flags_text))
            self.table.setItem(row_index, 5, QTableWidgetItem(status))

        self.refresh_current_label()

    def selected_device(self):
        row = self.table.currentRow()
        if row < 0 or row >= len(self.devices):
            return None
        return self.devices[row]

    def apply_selected(self):
        device = self.selected_device()
        if not device:
            QMessageBox.information(self, "Super Admin", "Выберите устройство точки.")
            return

        self.main_window.config["device_token"] = str(device.get("device_token") or "")
        self.main_window.save_config()
        if not self.main_window.bootstrap_if_possible(show_error=False):
            QMessageBox.critical(
                self,
                "Super Admin",
                "Точка выбрана, но bootstrap не выполнился. Проверьте устройство и сервер.",
            )
            return
        self.main_window.build_workspace_for_role()
        self.refresh_current_label()
        QMessageBox.information(
            self,
            "Super Admin",
            f"Программа привязана к точке {device.get('company', {}).get('name') or 'Точка'}.",
        )

    def clear_binding(self):
        self.main_window.config["device_token"] = ""
        self.main_window.save_config()
        self.main_window.bootstrap_data = None
        self.main_window.build_workspace_for_role()
        self.refresh_current_label()
        QMessageBox.information(self, "Super Admin", "Локальная привязка точки сброшена.")
