"""
Orda Control Point — единый файл темы.
Меняй цвета здесь — дизайн обновится во всём приложении.
"""

# ══════════════════════════════════════════════
#  ЦВЕТА  (меняй здесь)
# ══════════════════════════════════════════════

# Фон
BG          = "#0D1117"   # главный фон
SURFACE     = "#161B22"   # карточки, инпуты, шапки
SURFACE_2   = "#21262D"   # приподнятые элементы
SURFACE_3   = "#1C2128"   # ещё один уровень

# Рамки
BORDER      = "#30363D"   # основные рамки
BORDER_2    = "#21262D"   # тонкие внутренние разделители

# Текст
TEXT        = "#E6EDF3"   # основной текст
TEXT_MUTED  = "#8B949E"   # подписи, подсказки
TEXT_DIM    = "#6E7681"   # совсем приглушённый

# Акцентный цвет (синий)
ACCENT      = "#2B7FF5"   # кнопки primary, рамки фокуса
ACCENT_DARK = "#1F4B8E"   # фон кнопки blue
ACCENT_HOVER = "#388BFD"  # hover акцента

# Статусы
SUCCESS     = "#3FB950"   # зелёный
SUCCESS_BG  = "#1A3A28"   # фон зелёного
WARNING     = "#D29922"   # жёлтый
WARNING_BG  = "#2D2009"   # фон жёлтого
DANGER      = "#F85149"   # красный
DANGER_BG   = "#3D1515"   # фон красного

# Дополнительные цвета
VIOLET      = "#8B5CF6"   # фиолетовый (достижения, роли)
VIOLET_BG   = "#2D1A4A"   # фон фиолетового


# ══════════════════════════════════════════════
#  ШРИФТ
# ══════════════════════════════════════════════

FONT_FAMILY = '"Segoe UI", "Inter", sans-serif'
FONT_SIZE   = "13px"


# ══════════════════════════════════════════════
#  РАЗМЕРЫ
# ══════════════════════════════════════════════

RADIUS_SM   = "4px"
RADIUS      = "6px"
RADIUS_LG   = "8px"
RADIUS_XL   = "12px"


# ══════════════════════════════════════════════
#  ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
# ══════════════════════════════════════════════

def card_style(radius: str = RADIUS_LG, bg: str = SURFACE, border: str = BORDER) -> str:
    """Стиль карточки/панели."""
    return (
        f"QFrame {{ background: {bg}; border: 1px solid {border}; "
        f"border-radius: {radius}; }}"
    )


def badge_style(fg: str, bg: str, border: str) -> str:
    """Стиль маленького бейджа."""
    return (
        f"background: {bg}; color: {fg}; border: 1px solid {border}; "
        f"border-radius: 10px; padding: 3px 10px; "
        f"font-size: 12px; font-weight: 600;"
    )


# Готовые стили бейджей
BADGE = {
    "default": badge_style(TEXT_MUTED, SURFACE_2, BORDER),
    "success": badge_style(SUCCESS, f"rgba(63,185,80,0.12)", f"rgba(63,185,80,0.35)"),
    "warning": badge_style(WARNING, f"rgba(210,153,34,0.12)", f"rgba(210,153,34,0.35)"),
    "danger":  badge_style(DANGER,  f"rgba(248,81,73,0.12)",  f"rgba(248,81,73,0.35)"),
    "info":    badge_style(ACCENT,  f"rgba(43,127,245,0.12)", f"rgba(43,127,245,0.35)"),
    "violet":  badge_style(VIOLET,  f"rgba(139,92,246,0.12)", f"rgba(139,92,246,0.35)"),
}


def label_input_style(bg: str = SURFACE, border: str = BORDER) -> str:
    """Стиль поля ввода."""
    return f"""
        QLineEdit, QComboBox, QSpinBox, QDateEdit, QPlainTextEdit, QTextEdit {{
            background: {bg}; color: {TEXT};
            border: 1px solid {border}; border-radius: {RADIUS};
            padding: 8px 12px; font-size: {FONT_SIZE};
        }}
        QLineEdit:focus, QComboBox:focus, QSpinBox:focus,
        QDateEdit:focus, QPlainTextEdit:focus, QTextEdit:focus {{
            border-color: {ACCENT};
        }}
    """


# ══════════════════════════════════════════════
#  ГЛОБАЛЬНЫЙ STYLESHEET
#  (применяется к app через app.setStyleSheet)
# ══════════════════════════════════════════════

STYLESHEET = f"""
/* ─── BASE ─── */
QWidget {{
    background: {BG};
    color: {TEXT};
    font-family: {FONT_FAMILY};
    font-size: {FONT_SIZE};
    font-weight: 400;
}}
QMainWindow, QDialog {{ background: {BG}; }}
QLabel {{ color: {TEXT}; background: transparent; }}

/* ─── TEXT VARIANTS ─── */
QLabel[class="muted"]   {{ color: {TEXT_MUTED}; font-size: 12px; }}
QLabel[class="dim"]     {{ color: {TEXT_DIM};   font-size: 11px; }}
QLabel[class="accent"]  {{ color: {ACCENT};     font-weight: 600; }}
QLabel[class="success"] {{ color: {SUCCESS}; }}
QLabel[class="warning"] {{ color: {WARNING}; }}
QLabel[class="danger"]  {{ color: {DANGER};  }}
QLabel[class="violet"]  {{ color: {VIOLET};  }}

/* ─── INPUTS ─── */
QLineEdit, QComboBox, QSpinBox, QDateEdit, QPlainTextEdit, QTextEdit {{
    background: {SURFACE};
    color: {TEXT};
    border: 1px solid {BORDER};
    border-radius: {RADIUS};
    padding: 8px 12px;
    font-size: {FONT_SIZE};
    selection-background-color: {ACCENT};
    selection-color: #ffffff;
}}
QLineEdit:hover, QComboBox:hover, QSpinBox:hover,
QDateEdit:hover, QPlainTextEdit:hover, QTextEdit:hover {{
    border-color: {TEXT_DIM};
}}
QLineEdit:focus, QComboBox:focus, QSpinBox:focus,
QDateEdit:focus, QPlainTextEdit:focus, QTextEdit:focus {{
    border-color: {ACCENT};
    outline: none;
}}
QComboBox::drop-down {{ border: none; width: 28px; }}
QComboBox QAbstractItemView {{
    background: {SURFACE};
    border: 1px solid {BORDER};
    border-radius: {RADIUS};
    selection-background-color: {SURFACE_2};
    color: {TEXT};
    padding: 4px;
}}

/* ─── BUTTONS ─── */
QPushButton {{
    background: {SURFACE_2};
    color: {TEXT};
    border: 1px solid {BORDER};
    border-radius: {RADIUS};
    padding: 7px 16px;
    font-weight: 500;
    font-size: {FONT_SIZE};
    min-height: 28px;
}}
QPushButton:hover  {{ background: {BORDER};   border-color: {TEXT_DIM}; }}
QPushButton:pressed {{ background: {SURFACE}; }}
QPushButton:disabled {{ background: {SURFACE}; color: {TEXT_DIM}; border-color: {SURFACE_2}; }}

QPushButton[class="primary"] {{
    background: {SUCCESS_BG}; color: {SUCCESS};
    border-color: {SUCCESS}; font-weight: 600;
}}
QPushButton[class="primary"]:hover  {{ background: {SUCCESS}; color: #ffffff; }}
QPushButton[class="primary"]:pressed {{ background: #1a3a28; }}

QPushButton[class="blue"] {{
    background: {ACCENT_DARK}; color: #ffffff;
    border-color: {ACCENT}; font-weight: 600;
}}
QPushButton[class="blue"]:hover  {{ background: {ACCENT}; }}
QPushButton[class="blue"]:pressed {{ background: #163d80; }}

QPushButton[class="danger"] {{
    background: {DANGER_BG}; color: {DANGER}; border-color: {DANGER};
}}
QPushButton[class="danger"]:hover {{ background: #5c1a1a; }}

QPushButton[class="ghost"] {{
    background: transparent; color: {TEXT_MUTED}; border-color: {BORDER};
}}
QPushButton[class="ghost"]:hover {{
    background: {SURFACE_2}; color: {TEXT}; border-color: {TEXT_DIM};
}}

QPushButton[class="success"] {{
    background: {SUCCESS}; color: #ffffff; border-color: {SUCCESS}; font-weight: 600;
}}
QPushButton[class="success"]:hover {{ background: #34c44a; }}

/* ─── TABS ─── */
QTabWidget::pane {{
    border: 1px solid {BORDER};
    border-radius: {RADIUS};
    background: {BG};
    top: -1px;
}}
QTabBar::tab {{
    background: transparent;
    color: {TEXT_MUTED};
    border: 1px solid transparent;
    border-bottom: none;
    border-top-left-radius: {RADIUS};
    border-top-right-radius: {RADIUS};
    padding: 8px 18px;
    margin-right: 2px;
    font-weight: 500;
    font-size: {FONT_SIZE};
}}
QTabBar::tab:selected {{
    background: {BG};
    color: {TEXT};
    border-color: {BORDER};
    border-bottom: 1px solid {BG};
    margin-bottom: -1px;
    font-weight: 600;
}}
QTabBar::tab:hover:!selected {{
    background: {SURFACE};
    color: #C9D1D9;
}}

/* ─── GROUP BOX ─── */
QGroupBox {{
    border: 1px solid {BORDER};
    border-radius: {RADIUS_LG};
    margin-top: 14px;
    font-weight: 600;
    color: {TEXT_MUTED};
    background: transparent;
    padding-top: 8px;
    font-size: 12px;
}}
QGroupBox::title {{
    subcontrol-origin: margin;
    left: 12px;
    padding: 0 6px;
    background: {BG};
}}

/* ─── TABLES ─── */
QTableWidget {{
    background: {BG};
    border: 1px solid {BORDER};
    border-radius: {RADIUS};
    gridline-color: {BORDER_2};
    selection-background-color: {SURFACE_3};
    selection-color: {TEXT};
    alternate-background-color: {SURFACE};
}}
QTableWidget::item {{
    padding: 8px 10px;
    border-bottom: 1px solid {BORDER_2};
    color: {TEXT};
}}
QTableWidget::item:selected {{ background: {SURFACE_3}; color: {TEXT}; }}
QHeaderView::section {{
    background: {SURFACE};
    color: {TEXT_MUTED};
    border: none;
    border-bottom: 1px solid {BORDER};
    border-right: 1px solid {BORDER_2};
    padding: 8px 10px;
    font-weight: 600;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}}

/* ─── SCROLLBARS ─── */
QScrollBar:vertical {{
    background: transparent; width: 6px; margin: 0;
}}
QScrollBar::handle:vertical {{
    background: {BORDER}; min-height: 32px; border-radius: 3px;
}}
QScrollBar::handle:vertical:hover {{ background: {TEXT_DIM}; }}
QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {{ height: 0; }}
QScrollBar:horizontal {{
    background: transparent; height: 6px; margin: 0;
}}
QScrollBar::handle:horizontal {{
    background: {BORDER}; min-width: 32px; border-radius: 3px;
}}
QScrollBar::handle:horizontal:hover {{ background: {TEXT_DIM}; }}
QScrollBar::add-line:horizontal, QScrollBar::sub-line:horizontal {{ width: 0; }}

/* ─── PROGRESS BAR ─── */
QProgressBar {{
    background: {SURFACE_2};
    border: 1px solid {BORDER};
    border-radius: {RADIUS_SM};
    text-align: center;
    color: {TEXT_MUTED};
    font-size: 11px;
    height: 6px;
}}
QProgressBar::chunk {{ background: {ACCENT}; border-radius: {RADIUS_SM}; }}

/* ─── STATUS BAR ─── */
QStatusBar {{
    background: {SURFACE};
    border-top: 1px solid {BORDER};
    color: {TEXT_MUTED};
    font-size: 12px;
    padding: 2px 12px;
}}
QStatusBar QLabel {{ color: {TEXT_MUTED}; }}

/* ─── SPLITTER ─── */
QSplitter::handle {{ background: {BORDER}; }}
QSplitter::handle:horizontal {{ width: 1px; }}
QSplitter::handle:vertical {{ height: 1px; }}

/* ─── MISC ─── */
QMessageBox {{ background: {SURFACE}; }}
QMessageBox QLabel {{ color: {TEXT}; font-size: 13px; }}
QToolTip {{
    background: {SURFACE_2};
    color: {TEXT};
    border: 1px solid {BORDER};
    border-radius: {RADIUS};
    padding: 4px 8px;
    font-size: 12px;
}}
"""
