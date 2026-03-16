from __future__ import annotations

from PyQt6.QtWidgets import (
    QFormLayout,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMessageBox,
    QPushButton,
    QVBoxLayout,
    QWidget,
)


class SettingsTab(QWidget):
    """Admin-only settings: Telegram notifications + connection."""

    def __init__(self, main_window):
        super().__init__(main_window)
        self.main_window = main_window
        self.init_ui()
        self._load_values()

    def init_ui(self):
        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(20)

        # ── Telegram section ──────────────────────────────────
        tg_group = QGroupBox("Telegram уведомления")
        tg_form = QFormLayout(tg_group)
        tg_form.setSpacing(10)

        hint = QLabel(
            "Бот будет отправлять отчёт о закрытии смены оператору (его personal chat_id "
            "берётся из профиля) и в группу (если указан ниже)."
        )
        hint.setWordWrap(True)
        hint.setStyleSheet("font-size: 12px; color: #4a7a9a;")

        self._tg_token_input = QLineEdit()
        self._tg_token_input.setPlaceholderText("123456789:AABBCCDDEEFFaabbccddeeff...")
        self._tg_token_input.setEchoMode(QLineEdit.EchoMode.Password)

        self._tg_token_show_btn = QPushButton("👁")
        self._tg_token_show_btn.setFixedWidth(36)
        self._tg_token_show_btn.setCheckable(True)
        self._tg_token_show_btn.toggled.connect(self._toggle_token_visibility)

        token_row = QHBoxLayout()
        token_row.setSpacing(6)
        token_row.addWidget(self._tg_token_input, 1)
        token_row.addWidget(self._tg_token_show_btn)

        self._tg_chat_input = QLineEdit()
        self._tg_chat_input.setPlaceholderText("-100xxxxxxxxxx  (group/channel chat_id)")

        tg_form.addRow(hint)
        tg_form.addRow("Bot Token", token_row)
        tg_form.addRow("Групповой chat_id", self._tg_chat_input)

        how_to = QLabel(
            "Как получить: 1) Создайте бота через @BotFather → скопируйте токен. "
            "2) Добавьте бота в группу, отправьте любое сообщение, "
            "затем откройте https://api.telegram.org/bot<TOKEN>/getUpdates — "
            "там будет chat.id группы."
        )
        how_to.setWordWrap(True)
        how_to.setStyleSheet("font-size: 11px; color: #2a4f68;")
        tg_form.addRow(how_to)

        root.addWidget(tg_group)

        # ── Connection section ────────────────────────────────
        conn_group = QGroupBox("Подключение")
        conn_form = QFormLayout(conn_group)
        conn_form.setSpacing(10)

        self._api_url_input = QLineEdit()
        self._api_url_input.setPlaceholderText("https://ordaops.kz")
        conn_form.addRow("API URL", self._api_url_input)

        root.addWidget(conn_group)

        # ── Save button ───────────────────────────────────────
        save_row = QHBoxLayout()
        save_row.addStretch(1)
        self._save_btn = QPushButton("Сохранить настройки")
        self._save_btn.setProperty("class", "primary")
        self._save_btn.clicked.connect(self._save)
        save_row.addWidget(self._save_btn)
        root.addLayout(save_row)

        root.addStretch(1)

    def _toggle_token_visibility(self, visible: bool):
        mode = QLineEdit.EchoMode.Normal if visible else QLineEdit.EchoMode.Password
        self._tg_token_input.setEchoMode(mode)

    def _load_values(self):
        cfg = self.main_window.config
        self._tg_token_input.setText(str(cfg.get("telegram_bot_token") or ""))
        self._tg_chat_input.setText(str(cfg.get("telegram_chat_id") or ""))
        self._api_url_input.setText(
            str(cfg.get("api_base_url") or "https://ordaops.kz")
        )

    def _save(self):
        cfg = self.main_window.config

        bot_token = self._tg_token_input.text().strip()
        chat_id = self._tg_chat_input.text().strip()
        api_url = self._api_url_input.text().strip().rstrip("/") or "https://ordaops.kz"

        cfg["telegram_bot_token"] = bot_token
        cfg["telegram_chat_id"] = chat_id
        cfg["api_base_url"] = api_url

        self.main_window.save_config()
        QMessageBox.information(self, "Настройки", "Настройки сохранены.")
