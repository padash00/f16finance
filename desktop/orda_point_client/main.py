from __future__ import annotations

import sys

from PyQt6.QtWidgets import QApplication

from window import PointMainWindow


def main():
    app = QApplication(sys.argv)
    app.setApplicationName("Orda Control Point")
    window = PointMainWindow()
    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
