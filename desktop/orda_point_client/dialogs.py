from __future__ import annotations

from PyQt6.QtWidgets import QDialog, QFormLayout, QHBoxLayout, QLabel, QLineEdit, QPushButton, QVBoxLayout


class ActivationDialog(QDialog):
    def __init__(self, config: dict, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Подключение точки")
        self.setModal(True)
        self.resize(460, 220)

        layout = QVBoxLayout(self)

        intro = QLabel(
            "Укажите адрес Orda Control и device token этой точки.\n"
            "После подключения программа запросит вход оператора."
        )
        intro.setWordWrap(True)
        intro.setStyleSheet("color: #94a3b8; font-size: 13px;")
        layout.addWidget(intro)

        form = QFormLayout()
        self.api_url = QLineEdit(config.get("api_base_url") or "")
        self.device_token = QLineEdit(config.get("device_token") or "")
        form.addRow("API URL", self.api_url)
        form.addRow("Device token", self.device_token)
        layout.addLayout(form)

        buttons = QHBoxLayout()
        buttons.addStretch(1)
        connect_btn = QPushButton("Подключить")
        connect_btn.clicked.connect(self.accept)
        buttons.addWidget(connect_btn)
        layout.addLayout(buttons)

    def payload(self) -> dict:
        return {
            "api_base_url": self.api_url.text().strip().rstrip("/"),
            "device_token": self.device_token.text().strip(),
        }


class OperatorLoginDialog(QDialog):
    def __init__(self, remembered_username: str | None = None, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Вход оператора")
        self.setModal(True)
        self.resize(420, 220)

        layout = QVBoxLayout(self)

        intro = QLabel(
            "Войдите под логином и паролем оператора.\n"
            "Используются те же данные, что и для операторского кабинета на сайте."
        )
        intro.setWordWrap(True)
        intro.setStyleSheet("color: #94a3b8; font-size: 13px;")
        layout.addWidget(intro)

        form = QFormLayout()
        self.username = QLineEdit(remembered_username or "")
        self.password = QLineEdit()
        self.password.setEchoMode(QLineEdit.EchoMode.Password)
        form.addRow("Логин", self.username)
        form.addRow("Пароль", self.password)
        layout.addLayout(form)

        buttons = QHBoxLayout()
        buttons.addStretch(1)
        login_btn = QPushButton("Войти")
        login_btn.clicked.connect(self.accept)
        buttons.addWidget(login_btn)
        layout.addLayout(buttons)

    def payload(self) -> dict:
        return {
            "username": self.username.text().strip(),
            "password": self.password.text(),
        }
