"""
Дизайн-токены приложения Orda Control Point.
Единственный источник всех цветов, размеров и стилей.
"""

# ── Цвета ─────────────────────────────────────────────────────────────────────
BG          = "#1a1a2e"   # основной фон
CARD        = "#16213e"   # фон карточки
ACCENT      = "#7c3aed"   # фиолетовый акцент
SUCCESS     = "#4ade80"   # зелёный
ERROR       = "#f87171"   # красный
WARNING     = "#fbbf24"   # жёлтый
TEXT        = "#e0e0e0"   # основной текст
TEXT_MUTED  = "#6b7280"   # второстепенный текст
DIVIDER     = "#2d2d5e"   # разделители и границы

# ── Производные ───────────────────────────────────────────────────────────────
ACCENT_DIM  = "#5b21b6"   # акцент при нажатии
INPUT_BG    = CARD        # фон поля ввода
INPUT_FOCUS = ACCENT      # граница поля в фокусе

# ── Типографика ───────────────────────────────────────────────────────────────
FONT_FAMILY = "Segoe UI"
FONT_SCREEN_TITLE   = 22  # заголовок экрана
FONT_LABEL          = 11  # метки полей (ЗАГЛАВНЫЕ)
FONT_VALUE          = 13  # значения в полях
FONT_TOTAL          = 20  # итоговые суммы
FONT_BUTTON         = 13  # текст кнопок

# ── Сетка ─────────────────────────────────────────────────────────────────────
PADDING_OUTER   = 24   # внешние отступы контента
PADDING_CARD    = 16   # внутри карточки
GAP_SECTION     = 16   # между секциями
GAP_FIELD       = 10   # между полями внутри карточки
RADIUS_CARD     = 12   # border-radius карточки
RADIUS_BUTTON   = 8    # border-radius кнопок
RADIUS_INPUT    = 8    # border-radius полей
HEADER_H        = 56   # высота шапки
BUTTON_H        = 44   # высота кнопок

# ── Глобальный stylesheet ──────────────────────────────────────────────────────
APP_STYLE = f"""
/* ── Основа ── */
QWidget {{
    background: {BG};
    color: {TEXT};
    font-family: "{FONT_FAMILY}";
    font-size: {FONT_VALUE}px;
}}

/* ── Поля ввода ── */
QLineEdit, QPlainTextEdit, QSpinBox, QDateEdit {{
    background: {INPUT_BG};
    color: {TEXT};
    border: 1.5px solid {DIVIDER};
    border-radius: {RADIUS_INPUT}px;
    padding: 8px 12px;
    font-size: {FONT_VALUE}px;
    selection-background-color: {ACCENT};
}}
QLineEdit:focus, QPlainTextEdit:focus, QSpinBox:focus, QDateEdit:focus {{
    border: 1.5px solid {INPUT_FOCUS};
}}
QLineEdit[readOnly="true"] {{
    color: {TEXT_MUTED};
    border-color: transparent;
}}

/* ── Кнопки ── */
QPushButton {{
    background: transparent;
    color: {TEXT_MUTED};
    border: 1.5px solid {DIVIDER};
    border-radius: {RADIUS_BUTTON}px;
    padding: 0 20px;
    height: {BUTTON_H}px;
    font-size: {FONT_BUTTON}px;
    font-weight: 600;
}}
QPushButton:hover {{
    color: {TEXT};
    border-color: {TEXT_MUTED};
}}
QPushButton[class="primary"] {{
    background: {ACCENT};
    color: white;
    border: none;
}}
QPushButton[class="primary"]:hover {{
    background: {ACCENT_DIM};
}}
QPushButton[class="primary"]:disabled {{
    background: {DIVIDER};
    color: {TEXT_MUTED};
}}
QPushButton[class="success"] {{
    background: {SUCCESS};
    color: #0f1f0f;
    border: none;
    font-weight: 700;
}}
QPushButton[class="success"]:hover {{
    background: #22c55e;
}}
QPushButton[class="success"]:disabled {{
    background: {DIVIDER};
    color: {TEXT_MUTED};
}}
QPushButton[class="danger"] {{
    background: transparent;
    color: {ERROR};
    border: 1.5px solid {ERROR};
}}
QPushButton[class="danger"]:hover {{
    background: rgba(248,113,113,0.08);
}}
QPushButton[class="ghost"] {{
    background: transparent;
    color: {TEXT_MUTED};
    border: 1.5px solid {DIVIDER};
}}
QPushButton[class="ghost"]:hover {{
    color: {TEXT};
    border-color: {TEXT_MUTED};
}}

/* ── Комбобокс ── */
QComboBox {{
    background: {INPUT_BG};
    color: {TEXT};
    border: 1.5px solid {DIVIDER};
    border-radius: {RADIUS_INPUT}px;
    padding: 0 12px;
    height: 36px;
    font-size: {FONT_VALUE}px;
}}
QComboBox:focus {{
    border-color: {ACCENT};
}}
QComboBox::drop-down {{
    border: none;
    width: 24px;
}}
QComboBox QAbstractItemView {{
    background: {CARD};
    color: {TEXT};
    border: 1px solid {DIVIDER};
    selection-background-color: {ACCENT};
    outline: none;
}}

/* ── Таблица ── */
QTableWidget {{
    background: {BG};
    color: {TEXT};
    border: 1px solid {DIVIDER};
    border-radius: {RADIUS_CARD}px;
    gridline-color: transparent;
    font-size: {FONT_VALUE}px;
}}
QTableWidget::item {{
    padding: 10px 12px;
    border-bottom: 1px solid {DIVIDER};
}}
QTableWidget::item:selected {{
    background: rgba(124,58,237,0.15);
    color: {TEXT};
}}
QTableWidget::item:alternate {{
    background: {CARD};
}}
QHeaderView::section {{
    background: {BG};
    color: {TEXT_MUTED};
    border: none;
    border-bottom: 1px solid {DIVIDER};
    padding: 10px 12px;
    font-size: {FONT_LABEL}px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 1px;
}}

/* ── Scrollbar ── */
QScrollBar:vertical {{
    background: transparent;
    width: 6px;
    margin: 0;
}}
QScrollBar::handle:vertical {{
    background: {DIVIDER};
    border-radius: 3px;
    min-height: 24px;
}}
QScrollBar::handle:vertical:hover {{
    background: {TEXT_MUTED};
}}
QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {{
    height: 0;
}}
QScrollBar:horizontal {{
    background: transparent;
    height: 6px;
}}
QScrollBar::handle:horizontal {{
    background: {DIVIDER};
    border-radius: 3px;
}}

/* ── MessageBox ── */
QMessageBox {{
    background: {CARD};
}}
QMessageBox QLabel {{
    color: {TEXT};
    font-size: {FONT_VALUE}px;
}}

/* ── Tooltip ── */
QToolTip {{
    background: {CARD};
    color: {TEXT};
    border: 1px solid {DIVIDER};
    padding: 6px 10px;
    border-radius: 6px;
    font-size: 12px;
}}
"""


def card_style(border_left_color: str = "") -> str:
    """Стиль карточки. Опционально цветная левая граница."""
    left = f"border-left: 3px solid {border_left_color};" if border_left_color else ""
    return (
        f"background: {CARD};"
        f"border: 1px solid {DIVIDER};"
        f"border-radius: {RADIUS_CARD}px;"
        f"{left}"
    )


def label_style() -> str:
    """Стиль метки поля (мелкий, заглавный, фиолетовый)."""
    return (
        f"font-size: {FONT_LABEL}px;"
        f"font-weight: 600;"
        f"color: {ACCENT};"
        f"letter-spacing: 1px;"
        "text-transform: uppercase;"
        "background: transparent;"
    )


def muted_style(size: int = 12) -> str:
    return f"font-size: {size}px; color: {TEXT_MUTED}; background: transparent;"


def total_style(color: str = TEXT) -> str:
    return (
        f"font-size: {FONT_TOTAL}px;"
        f"font-weight: 700;"
        f"color: {color};"
        "background: transparent;"
    )
