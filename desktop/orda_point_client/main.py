from __future__ import annotations

import sys

from PyQt6.QtWidgets import QApplication

from window import PointMainWindow

APP_STYLESHEET = """
QWidget {
    background: #07111f;
    color: #e5edf7;
    font-family: "Segoe UI";
    font-size: 14px;
}

QMainWindow, QFrame {
    background: #07111f;
}

QLabel {
    color: #e5edf7;
}

QLineEdit, QComboBox, QSpinBox, QDateEdit, QPlainTextEdit, QTableWidget {
    background: #0d1a2b;
    color: #f8fbff;
    border: 1px solid #1d324b;
    border-radius: 12px;
    padding: 8px 10px;
    selection-background-color: #205d9c;
}

QLineEdit:focus, QComboBox:focus, QSpinBox:focus, QDateEdit:focus, QPlainTextEdit:focus {
    border: 1px solid #4ea4ff;
    background: #102238;
}

QPushButton {
    background: #102238;
    color: #eaf2ff;
    border: 1px solid #203956;
    border-radius: 12px;
    padding: 10px 16px;
    font-weight: 600;
}

QPushButton:hover {
    background: #15304c;
    border-color: #2d5680;
}

QPushButton:pressed {
    background: #0d2237;
}

QPushButton:disabled {
    color: #7a8ba1;
    background: #0b1522;
    border-color: #162638;
}

QTabWidget::pane {
    border: 1px solid #17304a;
    border-radius: 18px;
    background: #081423;
    top: -1px;
}

QTabBar::tab {
    background: #0c1a2c;
    color: #8fa6bf;
    border: 1px solid #17304a;
    border-bottom: none;
    border-top-left-radius: 12px;
    border-top-right-radius: 12px;
    padding: 10px 18px;
    margin-right: 4px;
}

QTabBar::tab:selected {
    background: #12253c;
    color: #f8fbff;
}

QGroupBox {
    border: 1px solid #17304a;
    border-radius: 18px;
    margin-top: 18px;
    font-weight: 700;
    color: #91c9ff;
    background: #081423;
}

QGroupBox::title {
    subcontrol-origin: margin;
    left: 14px;
    padding: 0 6px;
    background: #07111f;
}

QHeaderView::section {
    background: #0e2136;
    color: #8bc3ff;
    border: none;
    border-bottom: 1px solid #17304a;
    padding: 8px;
    font-weight: 700;
}

QTableWidget {
    gridline-color: #13273d;
}

QScrollBar:vertical {
    background: #081423;
    width: 12px;
    border-radius: 6px;
}

QScrollBar::handle:vertical {
    background: #1d3c5e;
    min-height: 28px;
    border-radius: 6px;
}
"""


def main():
    app = QApplication(sys.argv)
    app.setApplicationName("Orda Control Point")
    app.setStyle("Fusion")
    app.setStyleSheet(APP_STYLESHEET)
    window = PointMainWindow()
    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
