import sys
import sqlite3
import hashlib
import requests
import pandas as pd
import json
import time
from datetime import datetime, timedelta
from threading import Thread

from PyQt6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QTabWidget, QVBoxLayout, QHBoxLayout,
    QLabel, QLineEdit, QPushButton, QTableWidget, QTableWidgetItem,
    QComboBox, QMessageBox, QSpinBox, QHeaderView, QFormLayout, QFileDialog,
    QSplitter, QGroupBox, QGridLayout, QTextEdit, QDialog, QAbstractItemView,
    QMenu, QProgressBar, QFrame, QDateEdit, QCompleter
)
from PyQt6.QtCore import Qt, QSize, QThread, pyqtSignal, QTimer, QDate, QStringListModel
from PyQt6.QtGui import QFont, QIntValidator, QAction, QColor, QBrush

# ================= НАСТРОЙКИ ТЕЛЕГРАМА =================
TELEGRAM_BOT_TOKEN = "7343547252:AAEaRWEyX9RwkQz9UREqcFJ1GuCV39WCchg"
TELEGRAM_CHAT_ID = "-4935038728"
# =======================================================

DB_PATH = "debts_v10_pro.db"

# ================ SUPABASE CONFIG ================
SUPABASE_URL = "https://tmudsqgagblmdctaosgw.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRtdWRzcWdhZ2JsbWRjdGFvc2d3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM0MTM4MjcsImV4cCI6MjA3ODk4OTgyN30.XcIy_NBVFoIjvQ0TynpwV-Ehe12Zq17jaO3bdCgVsgU"
SUPABASE_COMPANY_CODE = "ramen"  # "arena", "ramen" или "extra"

_sb_company_cache = None


def supabase_headers() -> dict:
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }


# ================= КЛАСС ДЛЯ РАБОТЫ С САЙТОМ =================

class SupabaseManager:
    @staticmethod
    def get_company_id():
        global _sb_company_cache
        if _sb_company_cache:
            return _sb_company_cache
        try:
            url = f"{SUPABASE_URL}/rest/v1/companies"
            params = {
                "code": f"eq.{SUPABASE_COMPANY_CODE}",
                "select": "id",
                "limit": 1,
            }
            r = requests.get(url, headers=supabase_headers(), params=params, timeout=5)
            r.raise_for_status()
            data = r.json()
            if data:
                _sb_company_cache = data[0]["id"]
                return _sb_company_cache
        except Exception as e:
            print(f"Supabase company error: {e}")
        return None

    @staticmethod
    def fetch_operators():
        """Тянем активных операторов с сайта."""
        try:
            url = f"{SUPABASE_URL}/rest/v1/operators"
            params = {
                "select": "id,name,role,is_active",
                "is_active": "eq.true",
            }
            r = requests.get(url, headers=supabase_headers(), params=params, timeout=5)
            r.raise_for_status()
            return r.json()
        except requests.HTTPError as e:
            try:
                print("Fetch operators HTTP error:", e.response.status_code, e.response.text)
            except Exception:
                print("Fetch operators HTTP error:", e)
            return []
        except Exception as e:
            print(f"Fetch operators error: {e}")
            return []

    @staticmethod
    def send_debt(operator_uuid, operator_name, amount, comment="Auto from App"):
        """
        Копит долг сотрудника в public.debts, одна строка на неделю.
        """
        if not operator_uuid or amount <= 0:
            print("Send debt: пустой operator_uuid или amount <= 0, пропускаю")
            return

        comp_id = SupabaseManager.get_company_id()
        if not comp_id:
            print("Send debt: company_id не найден, пропускаю")
            return

        # понедельник текущей недели
        today = datetime.now().date()
        monday = today - timedelta(days=today.weekday())
        week_start_str = monday.isoformat()

        base_url = f"{SUPABASE_URL}/rest/v1/debts"

        try:
            # Ищем активную строку для этой недели
            params = {
                "select": "id,amount",
                "operator_id": f"eq.{operator_uuid}",
                "company_id": f"eq.{comp_id}",
                "date": f"eq.{week_start_str}",
                "status": "eq.active",
                "limit": 1,
            }
            r = requests.get(base_url, headers=supabase_headers(), params=params, timeout=5)
            r.raise_for_status()
            rows = r.json()

            if rows:
                debt_id = rows[0]["id"]
                current_amount = rows[0]["amount"] or 0
                new_amount = int(current_amount) + int(amount)

                patch_params = {"id": f"eq.{debt_id}"}
                payload = {
                    "amount": new_amount,
                    "comment": comment,
                }
                r2 = requests.patch(
                    base_url,
                    headers=supabase_headers(),
                    params=patch_params,
                    json=payload,
                    timeout=10,
                )
                r2.raise_for_status()
                print(f"Debt updated in Supabase: +{amount} -> {new_amount} ({operator_name})")
            else:
                payload = {
                    "client_name": operator_name,
                    "amount": int(amount),
                    "date": week_start_str,
                    "operator_id": operator_uuid,
                    "company_id": comp_id,
                    "comment": comment,
                    "status": "active",
                    "source": "pyqt",
                }
                r2 = requests.post(
                    base_url,
                    headers=supabase_headers(),
                    json=payload,
                    timeout=10,
                )
                r2.raise_for_status()
                print(f"Debt inserted in Supabase: {amount} ({operator_name})")

        except requests.HTTPError as e:
            try:
                print("Send debt HTTP error:", e.response.status_code, e.response.text)
            except Exception:
                print("Send debt HTTP error:", e)
        except Exception as e:
            print("Send debt error:", e)

    @staticmethod
    def send_shift(operator_uuid, operator_name, shift, cash, kaspi, card, date_iso, comment=""):
        """
        Отправка строки дохода в public.incomes из закрытия смены.
        """
        if not operator_uuid:
            return False, "operator_uuid пустой (нет привязки к сайту)"

        comp_id = SupabaseManager.get_company_id()
        if not comp_id:
            return False, "company_id не найден"

        # дата берётся из формы
        date_str = date_iso

        if SUPABASE_COMPANY_CODE == "arena":
            zone = "pc"
        elif SUPABASE_COMPANY_CODE == "ramen":
            zone = "ramen"
        elif SUPABASE_COMPANY_CODE == "extra":
            zone = "extra"
        else:
            zone = "other"

        base_url = f"{SUPABASE_URL}/rest/v1/incomes"

        payload = {
            "date": date_str,
            "company_id": comp_id,
            "operator_id": operator_uuid,
            "shift": shift,
            "zone": zone,
            "cash_amount": int(cash),   # ТОЛЬКО КУПЮРЫ
            "kaspi_amount": int(kaspi),
            "card_amount": int(card),
            "comment": comment or None,
            "is_virtual": False,
        }

        try:
            r = requests.post(
                base_url,
                headers=supabase_headers(),
                json=payload,
                timeout=10,
            )
            r.raise_for_status()
            print("Income inserted from shift:", payload)
            return True, "Доход сохранён в incomes"
        except requests.HTTPError as e:
            try:
                return False, f"{e.response.status_code}: {e.response.text}"
            except Exception:
                return False, str(e)
        except Exception as e:
            return False, str(e)


# ===================== COLOR PALETTE (Catppuccin Mocha) =====================
C_BG = "#1e1e2e"
C_SURFACE = "#313244"
C_OVERLAY = "#45475a"
C_TEXT = "#cdd6f4"
C_SUBTEXT = "#a6adc8"
C_BLUE = "#89b4fa"
C_GREEN = "#a6e3a1"
C_RED = "#f38ba8"
C_YELLOW = "#f9e2af"
C_LAVENDER = "#b4befe"

STYLESHEET = f"""
QWidget {{
    background-color: {C_BG};
    color: {C_TEXT};
    font-family: "Segoe UI", "Roboto", sans-serif;
    font-size: 14px;
}}

/* Inputs */
QLineEdit, QComboBox, QSpinBox, QTextEdit {{
    background-color: {C_SURFACE};
    border: 1px solid {C_OVERLAY};
    border-radius: 6px;
    padding: 8px;
    color: #ffffff;
    font-size: 14px;
}}
QLineEdit:focus, QComboBox:focus, QSpinBox:focus, QTextEdit:focus {{
    border: 1px solid {C_BLUE};
    background-color: #383a50;
}}

/* Groups */
QGroupBox {{
    border: 1px solid {C_OVERLAY};
    border-radius: 8px;
    margin-top: 22px;
    font-weight: bold;
    color: {C_LAVENDER};
}}
QGroupBox::title {{
    subcontrol-origin: margin;
    left: 10px;
    padding: 0 5px;
    background-color: {C_BG};
}}

/* Tables */
QTableWidget {{
    background-color: {C_SURFACE};
    gridline-color: {C_OVERLAY};
    border: none;
    border-radius: 6px;
    selection-background-color: {C_OVERLAY};
    selection-color: #ffffff;
}}
QHeaderView::section {{
    background-color: #181825;
    color: {C_BLUE};
    padding: 6px;
    border: none;
    border-bottom: 2px solid {C_BLUE};
    font-weight: bold;
}}
QTableCornerButton::section {{ background-color: #181825; }}

/* Buttons */
QPushButton {{
    background-color: {C_SURFACE};
    color: {C_TEXT};
    border: 1px solid {C_OVERLAY};
    padding: 8px 16px;
    border-radius: 6px;
    font-weight: bold;
}}
QPushButton:hover {{ background-color: {C_OVERLAY}; border-color: {C_SUBTEXT}; }}
QPushButton:pressed {{ background-color: #11111b; }}

QPushButton#Primary {{ background-color: {C_BLUE}; color: #1e1e2e; border: none; }}
QPushButton#Primary:hover {{ background-color: {C_LAVENDER}; }}

QPushButton#Success {{ background-color: {C_GREEN}; color: #1e1e2e; border: none; }}
QPushButton#Success:hover {{ background-color: #94e2d5; }}

QPushButton#Danger {{ background-color: {C_RED}; color: #1e1e2e; border: none; }}
QPushButton#Danger:hover {{ background-color: #eba0ac; }}

QPushButton#Excel {{ background-color: #217346; color: white; border: none; }}
QPushButton#Excel:hover {{ background-color: #33a364; }}

/* Tabs */
QTabWidget::pane {{ border: 1px solid {C_OVERLAY}; border-radius: 6px; top: -1px; }}
QTabBar::tab {{
    background: #181825;
    color: {C_SUBTEXT};
    padding: 10px 20px;
    margin-right: 4px;
    border-top-left-radius: 6px;
    border-top-right-radius: 6px;
}}
QTabBar::tab:selected {{ background: {C_SURFACE}; color: {C_BLUE}; border-bottom: 2px solid {C_BLUE}; }}

/* Scrollbars */
QScrollBar:vertical {{ background: {C_BG}; width: 10px; }}
QScrollBar::handle:vertical {{ background: {C_OVERLAY}; border-radius: 5px; }}
QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {{ height: 0px; }}
"""


def _fmt(n: int) -> str:
    return f"{int(n):,}".replace(",", " ")


# ===================== NEW: TG UTILS =====================

def tg_escape(s: str) -> str:
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def iso_to_human(s: str) -> str:
    # "2026-01-11" -> "11.01.2026"
    try:
        y, m, d = s.split("-")
        return f"{d}.{m}.{y}"
    except Exception:
        return s


# ===================== WORKERS (ASYNC) =====================

# 1) TelegramWorker "нормальный": проверяет ok, description, и аккуратно отрабатывает 429
class TelegramWorker(QThread):
    finished = pyqtSignal(bool, str)

    def __init__(self, text: str, chat_id: str | None = None):
        super().__init__()
        self.text = text
        self.chat_id = chat_id or TELEGRAM_CHAT_ID

    def _send(self):
        url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
        payload = {
            "chat_id": self.chat_id,
            "text": self.text,
            "parse_mode": "HTML",
            "disable_web_page_preview": True,
        }
        r = requests.post(url, json=payload, timeout=15)
        return r

    def run(self):
        if not self.chat_id:
            self.finished.emit(False, "chat_id пустой")
            return

        try:
            r = self._send()

            # Telegram почти всегда отдаёт JSON
            try:
                data = r.json()
            except Exception:
                data = None

            # Rate limit -> один спокойный ретрай
            if data and (data.get("error_code") == 429):
                retry_after = None
                try:
                    retry_after = int((data.get("parameters") or {}).get("retry_after") or 1)
                except Exception:
                    retry_after = 1
                time.sleep(min(max(retry_after, 1), 5))
                r = self._send()
                try:
                    data = r.json()
                except Exception:
                    data = None

            if r.status_code != 200:
                if data and data.get("description"):
                    self.finished.emit(False, f"TG {r.status_code}: {data.get('description')}")
                else:
                    self.finished.emit(False, f"TG {r.status_code}: {r.text[:200]}")
                return

            if not data or data.get("ok") is not True:
                desc = (data or {}).get("description") or "Unknown Telegram error"
                self.finished.emit(False, desc[:200])
                return

            # Успех
            self.finished.emit(True, "Отправлено")

        except Exception as e:
            self.finished.emit(False, str(e))


class SyncOperatorsWorker(QThread):
    finished = pyqtSignal(str)

    def __init__(self, db):
        super().__init__()
        self.db = db

    def run(self):
        ops = SupabaseManager.fetch_operators()
        if not ops:
            self.finished.emit("Не удалось получить список с сайта.")
            return

        count = 0
        with self.db.get_conn() as conn:
            for op in ops:
                staff_id = op.get("id")
                if not staff_id:
                    continue

                name = op["name"]

                cur = conn.execute("SELECT id FROM users WHERE name = ?", (name,))
                row = cur.fetchone()
                if row:
                    conn.execute(
                        "UPDATE users SET supabase_id = ? WHERE id = ?",
                        (staff_id, row[0])
                    )
                else:
                    ph = self.db.hash_password("0000")
                    conn.execute(
                        "INSERT INTO users (name, login, password, role, supabase_id) "
                        "VALUES (?, ?, ?, ?, ?)",
                        (name, name, ph, "worker", staff_id)
                    )
                    count += 1
            conn.commit()
        self.finished.emit(f"Синхронизация: добавлено {count} новых, привязка staff_id ок.")


class ShiftSenderWorker(QThread):
    finished = pyqtSignal(bool, str)

    def __init__(self, uuid, name, shift, cash, kaspi, card, date_iso, comment):
        super().__init__()
        self.uuid = uuid
        self.name = name
        self.shift = shift
        self.cash = cash
        self.kaspi = kaspi
        self.card = card
        self.date_iso = date_iso
        self.comment = comment

    def run(self):
        ok, msg = SupabaseManager.send_shift(
            self.uuid,
            self.name,
            self.shift,
            self.cash,
            self.kaspi,
            self.card,
            self.date_iso,
            self.comment,
        )
        self.finished.emit(ok, msg)


# ===================== БАЗА ДАННЫХ =====================

class Database:
    def __init__(self, path: str = DB_PATH) -> None:
        self.path = path
        self.init_db()
        self.check_migrations()
        self.create_default_admin()

    def get_conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path)
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    def hash_password(self, p: str) -> str:
        return hashlib.sha256(p.encode()).hexdigest()

    def init_db(self) -> None:
        conn = self.get_conn()
        cur = conn.cursor()
        cur.executescript("""
            CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                barcode TEXT NOT NULL UNIQUE,
                price INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                login TEXT NOT NULL UNIQUE,
                password TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user',
                supabase_id TEXT
            );
            CREATE TABLE IF NOT EXISTS debts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                product_id INTEGER NOT NULL,
                qty INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'active',
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (product_id) REFERENCES products(id)
            );
            CREATE TABLE IF NOT EXISTS shifts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                operator_name TEXT NOT NULL,
                created_at TEXT NOT NULL,
                wipon INTEGER NOT NULL,
                kaspi INTEGER NOT NULL,
                debts INTEGER NOT NULL,
                cash INTEGER NOT NULL,
                coins INTEGER NOT NULL,
                start_cash INTEGER NOT NULL,
                diff INTEGER NOT NULL,
                comment TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
            CREATE INDEX IF NOT EXISTS idx_debts_status ON debts(status);
        """)
        conn.commit()
        conn.close()

    def check_migrations(self):
        with self.get_conn() as conn:
            try:
                conn.execute("SELECT supabase_id FROM users LIMIT 1")
            except sqlite3.OperationalError:
                print("Миграция: добавляем supabase_id в users")
                conn.execute("ALTER TABLE users ADD COLUMN supabase_id TEXT")
                conn.commit()

    def create_default_admin(self) -> None:
        with self.get_conn() as conn:
            cur = conn.cursor()
            cur.execute("SELECT count(*) FROM users")
            if cur.fetchone()[0] == 0:
                cur.execute(
                    "INSERT INTO users (name, login, password, role) VALUES (?, ?, ?, ?)",
                    ("Владелец", "admin", self.hash_password("admin"), "admin"),
                )

    def authenticate(self, login: str, password: str):
        with self.get_conn() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT id, name, role, supabase_id FROM users WHERE login = ? AND password = ?",
                (login, self.hash_password(password)),
            )
            return cur.fetchone()

    # --- ТОВАРЫ ---
    def add_product(self, name: str, barcode: str, price: int) -> None:
        with self.get_conn() as conn:
            conn.execute(
                "INSERT INTO products (name, barcode, price) VALUES (?, ?, ?)",
                (name, str(barcode), price),
            )

    def get_products(self):
        with self.get_conn() as conn:
            return conn.execute(
                "SELECT id, name, barcode, price FROM products ORDER BY name"
            ).fetchall()

    def delete_product(self, pid: int) -> None:
        with self.get_conn() as conn:
            conn.execute("DELETE FROM products WHERE id = ?", (pid,))

    def import_from_excel(self, file_path: str):
        try:
            df = pd.read_excel(file_path)
            df.columns = df.columns.astype(str).str.lower().str.strip()
            rename_map = {
                "название": "name",
                "name": "name",
                "штрихкод": "barcode",
                "штрих код": "barcode",
                "barcode": "barcode",
                "цена": "price",
                "price": "price",
            }
            df = df.rename(columns=rename_map)

            if not {"name", "barcode", "price"}.issubset(df.columns):
                return False, "В файле нужны колонки: Название, Штрихкод, Цена"

            c, e = 0, 0
            with self.get_conn() as conn:
                for _, row in df.iterrows():
                    try:
                        n = str(row["name"]).strip()
                        b = str(row["barcode"]).replace(".0", "").strip()
                        p = int(row["price"]) if pd.notnull(row["price"]) else 0
                        if n and b:
                            conn.execute(
                                "INSERT OR REPLACE INTO products (name, barcode, price) VALUES (?, ?, ?)",
                                (n, b, p),
                            )
                            c += 1
                    except Exception:
                        e += 1
            return True, f"Загружено: {c}, Ошибок: {e}"
        except Exception as ex:
            return False, f"Ошибка чтения: {ex}"

    # --- ЛЮДИ ---
    def get_users_all(self):
        with self.get_conn() as conn:
            return conn.execute(
                "SELECT id, name, login, role, supabase_id FROM users ORDER BY name"
            ).fetchall()

    def get_workers(self):
        with self.get_conn() as conn:
            return conn.execute(
                "SELECT id, name, login, role FROM users WHERE role IN ('admin', 'worker') ORDER BY name"
            ).fetchall()

    def get_clients(self):
        with self.get_conn() as conn:
            return conn.execute(
                "SELECT id, name, login FROM users WHERE role = 'client' ORDER BY name"
            ).fetchall()

    def add_user(self, n, l, p, r):
        with self.get_conn() as conn:
            conn.execute(
                "INSERT INTO users (name, login, password, role) VALUES (?, ?, ?, ?)",
                (n, l, self.hash_password(p), r),
            )

    def add_client(self, name, phone):
        with self.get_conn() as conn:
            conn.execute(
                "INSERT INTO users (name, login, password, role) VALUES (?, ?, ?, 'client')",
                (name, phone, self.hash_password("0000")),
            )

    def update_user(self, user_id: int, name: str, login: str, password: str | None, role: str):
        fields = []
        params = []

        if name:
            fields.append("name = ?")
            params.append(name)
        if login:
            fields.append("login = ?")
            params.append(login)
        if password:
            fields.append("password = ?")
            params.append(self.hash_password(password))
        if role:
            fields.append("role = ?")
            params.append(role)

        if not fields:
            return

        params.append(user_id)
        with self.get_conn() as conn:
            conn.execute(f"UPDATE users SET {', '.join(fields)} WHERE id = ?", params)

    def delete_user(self, uid):
        with self.get_conn() as conn:
            if (
                conn.execute(
                    "SELECT COUNT(*) FROM debts WHERE user_id = ? AND status='active'",
                    (uid,),
                ).fetchone()[0]
                > 0
            ):
                raise ValueError("Сначала закройте долги пользователя!")
            conn.execute("DELETE FROM users WHERE id = ?", (uid,))

    def get_user(self, uid: int):
        with self.get_conn() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT id, name, role, supabase_id FROM users WHERE id = ?",
                (uid,),
            )
            return cur.fetchone()

    # --- ДОЛГИ ---
    def add_debt(self, uid: int, bc: str, qty: int):
        with self.get_conn() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT id, name, price FROM products WHERE barcode = ?",
                (bc,),
            )
            row = cur.fetchone()
            if not row:
                raise ValueError(f"Товар '{bc}' не найден!")
            pid, pname, price = row
            created_at = datetime.now()
            cur.execute(
                """
                INSERT INTO debts (user_id, product_id, qty, created_at, status)
                VALUES (?, ?, ?, ?, 'active')
                """,
                (
                    uid,
                    pid,
                    qty,
                    created_at.strftime("%Y-%m-%d %H:%M:%S"),
                ),
            )
            total = int(price) * int(qty)
            return {
                "product_name": pname,
                "price": int(price),
                "qty": int(qty),
                "total": total,
                "created_at": created_at,
            }

    def delete_debt_item(self, debt_id: int):
        with self.get_conn() as conn:
            conn.execute("DELETE FROM debts WHERE id = ?", (debt_id,))

    def get_current_debts_all(self):
        q = """SELECT u.name, u.role, SUM(p.price * d.qty) AS total 
               FROM debts d JOIN users u ON d.user_id = u.id JOIN products p ON d.product_id = p.id 
               WHERE d.status = 'active' GROUP BY u.id, u.role ORDER BY u.role, u.name"""
        with self.get_conn() as conn:
            return conn.execute(q).fetchall()

    def get_detailed_debts(self, active_only=False):
        where = "WHERE d.status = 'active'" if active_only else ""
        q = f"""SELECT d.id, u.name, u.role, p.barcode, p.name, p.price, d.qty, (p.price * d.qty), d.created_at, d.status
                FROM debts d JOIN users u ON d.user_id = u.id JOIN products p ON d.product_id = p.id 
                {where} ORDER BY d.created_at DESC"""
        with self.get_conn() as conn:
            return conn.execute(q).fetchall()

    # --- ОТЧЕТЫ ---
    def get_warehouse_report(self):
        q = """SELECT p.barcode, p.name, SUM(d.qty) FROM debts d JOIN products p ON d.product_id = p.id 
               WHERE d.status = 'active' GROUP BY p.barcode ORDER BY p.name"""
        with self.get_conn() as conn:
            return conn.execute(q).fetchall()

    def get_debts_by_role(self, role_type):
        roles = ("admin", "worker") if role_type == "worker" else ("client",)
        ph = ",".join(["?"] * len(roles))
        q = f"""SELECT u.name, SUM(p.price * d.qty) FROM debts d JOIN users u ON d.user_id = u.id JOIN products p ON d.product_id = p.id 
                WHERE d.status = 'active' AND u.role IN ({ph}) GROUP BY u.id ORDER BY u.name"""
        with self.get_conn() as conn:
            return conn.execute(q, roles).fetchall()

    def archive_week(self):
        with self.get_conn() as conn:
            conn.execute("UPDATE debts SET status = 'paid' WHERE status = 'active'")

    def archive_user(self, user_name):
        with self.get_conn() as conn:
            cur = conn.cursor()
            uid = cur.execute(
                "SELECT id FROM users WHERE name = ?", (user_name,),
            ).fetchone()
            if not uid:
                return False
            conn.execute(
                "UPDATE debts SET status = 'paid' WHERE status = 'active' AND user_id = ?",
                (uid[0],),
            )
            return True

    def add_shift_log(self, op, wipon, kaspi, debts, cash, coins, start, diff, comm):
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with self.get_conn() as conn:
            conn.execute(
                """INSERT INTO shifts (operator_name, created_at, wipon, kaspi, debts, cash, coins, start_cash, diff, comment)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (op, now, wipon, kaspi, debts, cash, coins, start, diff, comm),
            )

    def get_shifts_history(self):
        with self.get_conn() as conn:
            return conn.execute(
                "SELECT * FROM shifts ORDER BY id DESC LIMIT 50"
            ).fetchall()

    # 3) История долгов по сотруднику и периоду
    def get_debts_history_for_user(self, user_id: int, date_from_iso: str, date_to_iso: str):
        """
        Возвращает список: (created_at, product_name, price, qty, total)
        created_at хранится как "YYYY-MM-DD HH:MM:SS"
        """
        q = """
        SELECT d.created_at, p.name, p.price, d.qty, (p.price * d.qty) AS total
        FROM debts d
        JOIN products p ON d.product_id = p.id
        WHERE d.user_id = ?
          AND substr(d.created_at, 1, 10) >= ?
          AND substr(d.created_at, 1, 10) <= ?
        ORDER BY d.created_at ASC
        """
        with self.get_conn() as conn:
            return conn.execute(q, (user_id, date_from_iso, date_to_iso)).fetchall()


# ===================== GUI =====================

class LoginWindow(QDialog):
    def __init__(self, db: Database):
        super().__init__()
        self.db = db
        self.setWindowTitle("🔐 Вход")
        self.setFixedSize(300, 220)
        self.setStyleSheet(STYLESHEET)

        self.sync_worker = SyncOperatorsWorker(db)
        self.sync_worker.start()

        l = QVBoxLayout(self)
        l.setSpacing(15)
        l.setContentsMargins(30, 30, 30, 30)

        lbl = QLabel("Вход в систему")
        lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
        lbl.setStyleSheet(
            f"font-size: 18px; font-weight: bold; color: {C_BLUE};"
        )
        l.addWidget(lbl)

        self.u = QLineEdit(placeholderText="Логин")
        self.p = QLineEdit(placeholderText="Пароль")
        self.p.setEchoMode(QLineEdit.EchoMode.Password)

        btn = QPushButton("Войти")
        btn.setObjectName("Primary")
        btn.setMinimumHeight(40)
        btn.setCursor(Qt.CursorShape.PointingHandCursor)
        btn.clicked.connect(self.check)

        l.addWidget(self.u)
        l.addWidget(self.p)
        l.addWidget(btn)
        self.ud = None

    def check(self):
        u = self.db.authenticate(self.u.text(), self.p.text())
        if u:
            self.ud = u
            self.accept()
        else:
            QMessageBox.warning(self, "Ошибка", "Неверный логин или пароль")


class SearchBox(QLineEdit):
    def __init__(self, parent=None, placeholder="🔍 Поиск..."):
        super().__init__(parent)
        self.setPlaceholderText(placeholder)


# --- TABS ---

class CalculatorTab(QWidget):
    def __init__(self, db: Database, user_data):
        super().__init__()
        self.db = db
        self.user_data = user_data
        self.inputs = {}
        self.init_ui()

    def init_ui(self):
        layout = QVBoxLayout(self)

        top_split = QHBoxLayout()

        grp_fact = QGroupBox("💰 Фактические средства (Наличие)")
        g1 = QGridLayout()
        self.inputs["cash"] = self.mk_inp("💵 Наличные (Купюры):", g1, 0)
        self.inputs["coins"] = self.mk_inp("🪙 Мелочь (Монеты):", g1, 1)
        self.inputs["kaspi"] = self.mk_inp("💳 Kaspi (Переводы):", g1, 2)
        self.inputs["debts"] = self.mk_inp("🔗 Долги (Записано):", g1, 3)
        grp_fact.setLayout(g1)

        grp_sys = QGroupBox("📉 Данные системы (Вычет)")
        g2 = QGridLayout()
        self.inputs["start"] = self.mk_inp("🚀 Касса утро:", g2, 0)
        self.inputs["wipon"] = self.mk_inp("🖥️ Wipon (Продажи):", g2, 1)
        grp_sys.setLayout(g2)

        top_split.addWidget(grp_fact)
        top_split.addWidget(grp_sys)
        layout.addLayout(top_split)

        ds_row = QHBoxLayout()

        ds_row.addWidget(QLabel("Дата смены:"))
        self.date_edit = QDateEdit()
        self.date_edit.setCalendarPopup(True)
        self.date_edit.setDisplayFormat("dd.MM.yyyy")
        today = QDate.currentDate()
        self.date_edit.setDate(today)
        self.date_edit.setMinimumDate(QDate(2000, 1, 1))
        self.date_edit.setFixedWidth(140)
        ds_row.addWidget(self.date_edit)

        ds_row.addSpacing(20)

        ds_row.addWidget(QLabel("Смена:"))
        self.shift_box = QComboBox()
        self.shift_box.addItem("— выберите смену —", None)
        self.shift_box.addItem("День ☀️", "day")
        self.shift_box.addItem("Ночь 🌙", "night")
        self.shift_box.setFixedWidth(150)
        ds_row.addWidget(self.shift_box)

        ds_row.addStretch()
        layout.addLayout(ds_row)

        self.comm = QTextEdit()
        self.comm.setPlaceholderText("📝 Комментарий (причины недостачи, размен...)")
        self.comm.setMaximumHeight(70)
        layout.addWidget(self.comm)

        self.lbl_res = QLabel("ИТОГ: 0 ₸")
        self.lbl_res.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.lbl_res.setStyleSheet(
            f"background-color: {C_SURFACE}; border-radius: 8px; padding: 15px; font-size: 24px; font-weight: bold;"
        )
        layout.addWidget(self.lbl_res)

        btns = QHBoxLayout()
        btn_clr = QPushButton("Сброс")
        btn_clr.clicked.connect(self.clr)
        btn_snd = QPushButton("✅ ЗАКРЫТЬ СМЕНУ")
        btn_snd.setObjectName("Success")
        btn_snd.setMinimumHeight(50)
        btn_snd.clicked.connect(self.send)

        btns.addWidget(btn_clr)
        btns.addWidget(btn_snd)
        layout.addLayout(btns)

        self.loading = QProgressBar()
        self.loading.setRange(0, 0)
        self.loading.hide()
        layout.addWidget(self.loading)

    def mk_inp(self, txt, l, r):
        l.addWidget(QLabel(txt), r, 0)
        inp = QLineEdit()
        inp.setPlaceholderText("0")
        inp.setAlignment(Qt.AlignmentFlag.AlignRight)
        inp.setValidator(QIntValidator(0, 100000000))
        inp.textChanged.connect(self.calc)
        l.addWidget(inp, r, 1)
        return inp

    def get_v(self, k):
        try:
            return int(self.inputs[k].text().replace(" ", "") or 0)
        except Exception:
            return 0

    def calc(self):
        wipon = self.get_v("wipon")
        kaspi = self.get_v("kaspi")
        debts = self.get_v("debts")
        cash = self.get_v("cash")
        coins = self.get_v("coins")
        start = self.get_v("start")

        actual_rev = (cash + coins + kaspi + debts) - start
        diff = actual_rev - wipon

        color = C_GREEN if diff > 0 else C_RED if diff < 0 else C_BLUE
        prefix = "+" if diff > 0 else ""
        self.lbl_res.setText(f"ИТОГ: {prefix}{_fmt(diff)} ₸")
        self.lbl_res.setStyleSheet(
            f"background-color:{C_SURFACE};border:2px solid {color};color:{color};"
            f"border-radius:8px;padding:15px;font-size:24px;font-weight:bold;"
        )
        return diff, wipon, kaspi, debts, cash, coins, start

    def send(self):
        shift_value = self.shift_box.currentData()
        if shift_value is None:
            QMessageBox.warning(self, "Смена", "Выберите смену (день/ночь)")
            return

        diff, wipon, kaspi, debts, cash, coins, start = self.calc()
        if wipon == 0 and cash == 0 and kaspi == 0:
            QMessageBox.warning(self, "Пусто", "Заполните данные!")
            return

        if diff < 0:
            if (
                QMessageBox.question(
                    self,
                    "Недостача",
                    f"⚠️ Недостача: {_fmt(diff)} ₸. Закрыть смену?",
                )
                != QMessageBox.StandardButton.Yes
            ):
                return

        comm = self.comm.toPlainText()
        op_name = self.user_data[1]
        op_uuid = self.user_data[3]

        date_q = self.date_edit.date()
        date_str_human = date_q.toString("dd.MM.yyyy")
        date_str_iso = date_q.toString("yyyy-MM-dd")
        time_str = datetime.now().strftime("%H:%M")
        dt = f"{date_str_human} {time_str}"

        try:
            self.db.add_shift_log(
                op_name, wipon, kaspi, debts, cash, coins, start, diff, comm
            )
        except Exception as e:
            QMessageBox.critical(self, "Ошибка БД", str(e))
            return

        status = "✅ Всё четко" if diff >= 0 else "⚠️ НЕДОСТАЧА"
        msg = (
            f"🧾 <b>Отчет: {dt}</b>\n👤 <b>{tg_escape(op_name)}</b>\n\n"
            f"💳 Kaspi: {_fmt(kaspi)}\n💵 Нал: {_fmt(cash)}\n🪙 Мелочь: {_fmt(coins)}\n🔗 Долги: {_fmt(debts)}\n"
            f"------------------\n🖥️ План (Wipon): {_fmt(wipon)}\n🚀 Старт: {_fmt(start)}\n"
            f"------------------\n{status}: <b>{_fmt(diff)} ₸</b>"
        )
        if comm:
            msg += f"\n💬 <i>{tg_escape(comm)}</i>"

        self.toggle_ui(False)

        # Telegram
        self.worker = TelegramWorker(msg)
        self.worker.finished.connect(lambda ok, info: print("TG:", ok, info))
        self.worker.start()

        # === Send only CASH (bills), ignore coins for Supabase ===
        only_bills = cash

        if op_uuid:
            self.sb_worker = ShiftSenderWorker(
                op_uuid,
                op_name,
                shift_value,
                only_bills,
                kaspi,
                0,
                date_str_iso,
                comm,
            )
            self.sb_worker.finished.connect(self.on_sent_sb)
            self.sb_worker.start()
        else:
            self.on_sent_sb(False, "Оператор не привязан к сайту (нет supabase_id)")

    def on_sent_sb(self, success, msg):
        self.toggle_ui(True)
        if success:
            QMessageBox.information(self, "Успех", "Отчет отправлен на сайт и в ТГ!")
        else:
            QMessageBox.warning(self, "Сайт", f"Сохранено локально, но ошибка сайта: {msg}")
        self.clr()

    def toggle_ui(self, enable):
        self.setEnabled(enable)
        self.loading.setVisible(not enable)

    def clr(self):
        for k in self.inputs:
            self.inputs[k].clear()
        self.comm.clear()
        self.date_edit.setDate(QDate.currentDate())
        self.shift_box.setCurrentIndex(0)
        self.calc()


class ScannerTab(QWidget):
    def __init__(self, db: Database, ud):
        super().__init__()
        self.db = db
        self.u = ud
        self.products_map = {}  # "Name (Barcode)" -> Barcode
        self.init_ui()
        self.update_completer()  # Initialize products for search

    def init_ui(self):
        layout = QVBoxLayout(self)

        top_grp = QGroupBox("Сканирование")
        top_l = QHBoxLayout()
        top_grp.setLayout(top_l)

        self.cb = QComboBox()
        self.cb.setMinimumWidth(250)
        top_l.addWidget(QLabel("👤 Кто:"))
        top_l.addWidget(self.cb)

        self.q = QSpinBox()
        self.q.setRange(1, 99)
        self.q.setFixedWidth(70)
        self.q.setAlignment(Qt.AlignmentFlag.AlignCenter)
        top_l.addWidget(QLabel("x"))
        top_l.addWidget(self.q)
        layout.addWidget(top_grp)

        # === PRODUCT SEARCH (Autocomplete) ===
        self.search_inp = QLineEdit()
        self.search_inp.setPlaceholderText("🔎 Поиск товара по названию (автодополнение)...")
        self.search_inp.setStyleSheet(
            f"background-color: {C_SURFACE}; font-size: 14px; border: 1px solid {C_BLUE}; border-radius: 6px; padding: 8px;"
        )

        self.completer = QCompleter([])
        self.completer.setCaseSensitivity(Qt.CaseSensitivity.CaseInsensitive)
        self.completer.setFilterMode(Qt.MatchFlag.MatchContains)
        self.search_inp.setCompleter(self.completer)
        self.completer.activated.connect(self.on_completer_activated)

        layout.addWidget(self.search_inp)

        self.b = QLineEdit()
        self.b.setPlaceholderText("🔍 Штрихкод (Enter)...")
        self.b.setMinimumHeight(60)
        self.b.setStyleSheet(
            f"font-size: 24px; border: 2px solid {C_BLUE}; border-radius: 8px; background-color: #181825;"
        )
        self.b.returnPressed.connect(self.sc)
        layout.addWidget(self.b)

        self.m = QLabel("Ожидание...")
        self.m.setStyleSheet(f"color: {C_SUBTEXT}; font-style: italic;")
        self.m.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(self.m)

        layout.addWidget(QLabel("📋 Текущие активные долги:"))
        self.t = QTableWidget(0, 5)
        self.t.setHorizontalHeaderLabels(
            ["ID (Скрыт)", "Имя", "Товар", "Цена x Кол", "Итог"]
        )
        self.t.horizontalHeader().setSectionResizeMode(
            1, QHeaderView.ResizeMode.Stretch
        )
        self.t.setColumnHidden(0, True)
        self.t.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)
        self.t.customContextMenuRequested.connect(self.ctx_menu)
        layout.addWidget(self.t)

        self.ru()
        self.rh()

    def update_completer(self):
        """Loads all products into memory for the search box."""
        try:
            prods = self.db.get_products()  # (id, name, barcode, price)
            self.products_map = {}
            display_list = []

            for pid, name, barcode, price in prods:
                display_str = f"{name} ({barcode})"
                display_list.append(display_str)
                self.products_map[display_str] = barcode

            self.completer.setModel(QStringListModel(display_list))
        except Exception as e:
            print(f"Error loading products for search: {e}")

    def on_completer_activated(self, text):
        barcode = self.products_map.get(text)
        if barcode:
            self.b.setText(barcode)
            self.sc()
            self.search_inp.clear()

    def ru(self):
        us = self.db.get_users_all()
        self.cb.clear()
        can_see_staff = self.u[2] in ("admin", "worker")
        for user in us:
            uid, name, _, role, sbid = user
            if role == "client":
                self.cb.addItem(f"🟣 {name}", user)
            elif uid == self.u[0]:
                self.cb.addItem(f"🟢 {name} (Я)", user)
            elif can_see_staff and role != "client":
                self.cb.addItem(f"👔 {name}", user)

    def sc(self):
        bc = self.b.text().strip()
        if not bc:
            return

        user_data = self.cb.currentData()
        if user_data is None:
            return

        uid, uname, _, urole, usbid = user_data

        try:
            info = self.db.add_debt(uid, bc, self.q.value())

            if urole in ("admin", "worker") and usbid:
                SupabaseManager.send_debt(usbid, uname, info["total"])

            self.m.setText(f"✅ Добавлено: {bc} (x{self.q.value()})")
            self.m.setStyleSheet(
                f"color: {C_GREEN}; font-weight: bold; font-size: 16px;"
            )
            self.rh()
            self.q.setValue(1)
            self.b.clear()
        except Exception as e:
            self.m.setText(f"❌ {e}")
            self.m.setStyleSheet(f"color: {C_RED}; font-weight: bold;")
            self.b.selectAll()

    def rh(self):
        rs = self.db.get_detailed_debts(active_only=True)
        self.t.setRowCount(len(rs))
        for i, row in enumerate(rs):
            debt_id, uname, _, _, pname, price, qty, total, _, _ = row

            self.t.setItem(i, 0, QTableWidgetItem(str(debt_id)))
            self.t.setItem(i, 1, QTableWidgetItem(uname))
            self.t.setItem(i, 2, QTableWidgetItem(pname))
            self.t.setItem(i, 3, QTableWidgetItem(f"{price} x {qty}"))

            tot_item = QTableWidgetItem(f"{_fmt(total)} ₸")
            tot_item.setForeground(QBrush(QColor(C_RED)))
            tot_item.setFont(QFont("Segoe UI", 10, QFont.Weight.Bold))
            self.t.setItem(i, 4, tot_item)

    def ctx_menu(self, pos):
        row = self.t.rowAt(pos.y())
        if row >= 0:
            menu = QMenu()
            del_act = QAction("🗑 Удалить запись (Ошибка)", self)
            del_act.triggered.connect(lambda: self.del_item(row))
            menu.addAction(del_act)
            menu.exec(self.t.mapToGlobal(pos))

    def del_item(self, row):
        did = int(self.t.item(row, 0).text())
        name = self.t.item(row, 1).text()
        prod = self.t.item(row, 2).text()
        if (
            QMessageBox.question(
                self, "Отмена", f"Удалить запись?\n{name}: {prod}"
            )
            == QMessageBox.StandardButton.Yes
        ):
            self.db.delete_debt_item(did)
            self.rh()


class ProductsTab(QWidget):
    def __init__(self, db: Database):
        super().__init__()
        self.db = db
        l = QVBoxLayout(self)

        tools = QHBoxLayout()
        self.search = SearchBox(placeholder="🔍 Поиск товара...")
        self.search.textChanged.connect(self.filter)

        btn_imp = QPushButton("📂 Импорт Excel")
        btn_imp.setObjectName("Excel")
        btn_imp.clicked.connect(self.imp)

        tools.addWidget(self.search, 3)
        tools.addWidget(btn_imp, 1)
        l.addLayout(tools)

        f = QHBoxLayout()
        self.n = QLineEdit(placeholderText="Название")
        self.b = QLineEdit(placeholderText="Штрихкод")
        self.p = QLineEdit(placeholderText="Цена")
        self.p.setValidator(QIntValidator())
        btn_add = QPushButton("➕")
        btn_add.setObjectName("Primary")
        btn_add.setFixedWidth(50)
        btn_add.clicked.connect(self.add)

        f.addWidget(self.n, 3)
        f.addWidget(self.b, 2)
        f.addWidget(self.p, 1)
        f.addWidget(btn_add)
        l.addLayout(f)

        self.t = QTableWidget(0, 4)
        self.t.setHorizontalHeaderLabels(["ID", "Название", "Штрихкод", "Цена"])
        self.t.horizontalHeader().setSectionResizeMode(
            1, QHeaderView.ResizeMode.Stretch
        )
        self.t.setSelectionBehavior(
            QAbstractItemView.SelectionBehavior.SelectRows
        )
        l.addWidget(self.t)

        d = QPushButton("Удалить выбранный")
        d.setObjectName("Danger")
        d.clicked.connect(self.dele)
        l.addWidget(d)
        self.ref()

    def ref(self):
        rows = self.db.get_products()
        self.t.setRowCount(len(rows))
        for i, row in enumerate(rows):
            for j, v in enumerate(row):
                self.t.setItem(i, j, QTableWidgetItem(str(v)))

    def filter(self, text):
        for i in range(self.t.rowCount()):
            match = False
            for j in [1, 2]:
                item = self.t.item(i, j)
                if item and text.lower() in item.text().lower():
                    match = True
                    break
            self.t.setRowHidden(i, not match)

    def add(self):
        try:
            self.db.add_product(
                self.n.text(), self.b.text(), int(self.p.text() or 0)
            )
            self.n.clear()
            self.b.clear()
            self.p.clear()
            self.ref()
            self.n.setFocus()
        except Exception as e:
            QMessageBox.warning(self, "Ошибка", str(e))

    def dele(self):
        r = self.t.currentRow()
        if (
            r >= 0
            and QMessageBox.question(
                self, "Удалить?", "Точно?"
            )
            == QMessageBox.StandardButton.Yes
        ):
            self.db.delete_product(int(self.t.item(r, 0).text()))
            self.ref()

    def imp(self):
        p, _ = QFileDialog.getOpenFileName(
            self, "Excel", "", "*.xlsx *.xls"
        )
        if p:
            ok, m = self.db.import_from_excel(p)
            QMessageBox.information(self, "Импорт", m)
            self.ref()


class WorkersTab(QWidget):
    def __init__(self, db: Database):
        super().__init__()
        self.db = db
        self.edit_id: int | None = None

        l = QVBoxLayout(self)

        l.addWidget(QLabel("<h3>👤 Сотрудники</h3>"))

        form = QFormLayout()
        self.n = QLineEdit()
        self.lg = QLineEdit()
        self.p = QLineEdit()
        self.p.setEchoMode(QLineEdit.EchoMode.Password)
        self.r = QComboBox()
        self.r.addItems(["worker", "admin"])

        form.addRow("Имя:", self.n)
        form.addRow("Логин:", self.lg)
        form.addRow("Пароль:", self.p)
        form.addRow("Роль:", self.r)
        l.addLayout(form)

        self.btn_save = QPushButton("Добавить")
        self.btn_save.setObjectName("Primary")
        self.btn_save.clicked.connect(self.save_or_add)
        l.addWidget(self.btn_save)

        self.t = QTableWidget(0, 4)
        self.t.setHorizontalHeaderLabels(["ID", "Имя", "Логин", "Роль"])
        self.t.horizontalHeader().setSectionResizeMode(
            QHeaderView.ResizeMode.Stretch
        )
        self.t.setSelectionBehavior(
            QAbstractItemView.SelectionBehavior.SelectRows
        )
        self.t.itemSelectionChanged.connect(self.on_row_select)
        l.addWidget(self.t)

        d = QPushButton("Удалить")
        d.setObjectName("Danger")
        d.clicked.connect(self.rem)
        l.addWidget(d)

        self.ref()

    def ref(self):
        rs = self.db.get_workers()
        self.t.setRowCount(len(rs))
        for i, r in enumerate(rs):
            for j, v in enumerate(r):
                self.t.setItem(i, j, QTableWidgetItem(str(v)))

    def clear_form(self):
        self.edit_id = None
        self.n.clear()
        self.lg.clear()
        self.p.clear()
        self.r.setCurrentIndex(0)
        self.btn_save.setText("Добавить")

    def on_row_select(self):
        row = self.t.currentRow()
        if row < 0:
            return
        self.edit_id = int(self.t.item(row, 0).text())
        name = self.t.item(row, 1).text()
        login = self.t.item(row, 2).text()
        role = self.t.item(row, 3).text()

        self.n.setText(name)
        self.lg.setText(login)
        idx = self.r.findText(role)
        if idx >= 0:
            self.r.setCurrentIndex(idx)
        self.p.clear()
        self.btn_save.setText("Сохранить")

    def save_or_add(self):
        name = self.n.text().strip()
        login = self.lg.text().strip()
        pwd = self.p.text().strip()
        role = self.r.currentText()

        if not name or not login:
            QMessageBox.warning(self, "Ошибка", "Имя и логин обязательны")
            return

        try:
            if self.edit_id is None:
                if not pwd:
                    QMessageBox.warning(self, "Ошибка", "Для нового сотрудника нужен пароль")
                    return
                self.db.add_user(name, login, pwd, role)
            else:
                self.db.update_user(self.edit_id, name, login, pwd or None, role)

            self.ref()
            self.clear_form()
        except Exception as e:
            QMessageBox.warning(self, "Ошибка", str(e))

    def rem(self):
        r = self.t.currentRow()
        if r >= 0:
            uid = int(self.t.item(r, 0).text())
            if (
                QMessageBox.question(
                    self, "Удалить", "Точно удалить сотрудника?"
                )
                == QMessageBox.StandardButton.Yes
            ):
                try:
                    self.db.delete_user(uid)
                    self.ref()
                    self.clear_form()
                except Exception as e:
                    QMessageBox.warning(self, "Стоп", str(e))


class ClientsTab(QWidget):
    def __init__(self, db: Database):
        super().__init__()
        self.db = db
        l = QVBoxLayout(self)

        self.search = SearchBox(placeholder="🔍 Поиск клиента...")
        self.search.textChanged.connect(self.filter)
        l.addWidget(self.search)

        f = QHBoxLayout()
        self.n = QLineEdit(placeholderText="Имя")
        self.ph = QLineEdit(placeholderText="Инфо/Телефон")
        b = QPushButton("➕")
        b.setObjectName("Primary")
        b.clicked.connect(self.add)
        f.addWidget(self.n, 2)
        f.addWidget(self.ph, 2)
        f.addWidget(b)
        l.addLayout(f)

        self.t = QTableWidget(0, 3)
        self.t.setHorizontalHeaderLabels(["ID", "Имя", "Инфо"])
        self.t.horizontalHeader().setSectionResizeMode(
            1, QHeaderView.ResizeMode.Stretch
        )
        self.t.setSelectionBehavior(
            QAbstractItemView.SelectionBehavior.SelectRows
        )
        l.addWidget(self.t)

        d = QPushButton("Удалить")
        d.setObjectName("Danger")
        d.clicked.connect(self.rem)
        l.addWidget(d)
        self.ref()

    def ref(self):
        rs = self.db.get_clients()
        self.t.setRowCount(len(rs))
        for i, r in enumerate(rs):
            for j, v in enumerate(r):
                self.t.setItem(i, j, QTableWidgetItem(str(v)))

    def filter(self, text):
        for i in range(self.t.rowCount()):
            item = self.t.item(i, 1)
            self.t.setRowHidden(
                i, text.lower() not in item.text().lower()
            )

    def add(self):
        if self.n.text():
            try:
                self.db.add_client(self.n.text(), self.ph.text())
                self.ref()
                self.n.clear()
                self.ph.clear()
            except Exception as e:
                QMessageBox.warning(self, "Ошибка", str(e))

    def rem(self):
        r = self.t.currentRow()
        if r >= 0:
            try:
                self.db.delete_user(int(self.t.item(r, 0).text()))
                self.ref()
            except Exception as e:
                QMessageBox.warning(self, "Ошибка", str(e))


class ReportTab(QWidget):
    def __init__(self, db: Database):
        super().__init__()
        self.db = db
        l = QVBoxLayout(self)

        btns = QHBoxLayout()
        btn_ref = QPushButton("🔄 Обновить")
        btn_ref.clicked.connect(self.load)

        btn_xls = QPushButton("💾 Скачать Excel")
        btn_xls.setObjectName("Excel")
        btn_xls.clicked.connect(self.export_excel)

        # 4.1) NEW BUTTON
        btn_send_all = QPushButton("📤 Отправить всем (неделя)")
        btn_send_all.setObjectName("Primary")
        btn_send_all.clicked.connect(self.send_all_week)

        btn_cls = QPushButton("🔥 АРХИВ (Списание)")
        btn_cls.setObjectName("Danger")
        btn_cls.clicked.connect(self.close_w)

        btns.addWidget(btn_ref)
        btns.addWidget(btn_xls)
        btns.addWidget(btn_send_all)
        btns.addStretch()
        btns.addWidget(btn_cls)
        l.addLayout(btns)

        split = QSplitter(Qt.Orientation.Horizontal)
        split.addWidget(self.create_box("📦 Склад (Долги)", 0))
        split.addWidget(self.create_box("💰 Сотрудники", 1))
        split.addWidget(self.create_box("📒 Клиенты", 2))
        l.addWidget(split, 1)

        self.load()

    def create_box(self, title, tid):
        w = QWidget()
        l = QVBoxLayout(w)
        l.setContentsMargins(0, 0, 0, 0)
        l.addWidget(QLabel(f"<b>{title}</b>"))

        t = QTableWidget(0, 2 if tid != 0 else 3)
        cols = ["Код", "Товар", "Шт"] if tid == 0 else ["Имя", "Долг"]
        t.setHorizontalHeaderLabels(cols)
        t.horizontalHeader().setSectionResizeMode(
            1, QHeaderView.ResizeMode.Stretch
        )
        l.addWidget(t)

        if tid == 0:
            self.t_wh = t
        elif tid == 1:
            self.t_sal = t
            self.lbl_sal = QLabel("0 ₸")
            self.lbl_sal.setAlignment(Qt.AlignmentFlag.AlignRight)
            l.addWidget(self.lbl_sal)
            b = QPushButton("✅ Оплатил")
            b.setObjectName("Success")
            b.clicked.connect(self.pay_w)
            l.addWidget(b)
        else:
            self.t_cl = t
            self.lbl_cl = QLabel("0 ₸")
            self.lbl_cl.setAlignment(Qt.AlignmentFlag.AlignRight)
            l.addWidget(self.lbl_cl)
        return w

    def load(self):
        d = self.db.get_warehouse_report()
        self.t_wh.setRowCount(len(d))
        for i, (b, n, q) in enumerate(d):
            self.t_wh.setItem(i, 0, QTableWidgetItem(str(b)))
            self.t_wh.setItem(i, 1, QTableWidgetItem(n))
            self.t_wh.setItem(i, 2, QTableWidgetItem(str(q)))

        d = self.db.get_debts_by_role("worker")
        self.t_sal.setRowCount(len(d))
        s = 0
        for i, (n, v) in enumerate(d):
            self.t_sal.setItem(i, 0, QTableWidgetItem(n))
            self.t_sal.setItem(i, 1, QTableWidgetItem(_fmt(v)))
            s += v
        self.lbl_sal.setText(f"Итого: {_fmt(s)} ₸")

        d = self.db.get_debts_by_role("client")
        self.t_cl.setRowCount(len(d))
        s = 0
        for i, (n, v) in enumerate(d):
            self.t_cl.setItem(i, 0, QTableWidgetItem(n))
            self.t_cl.setItem(i, 1, QTableWidgetItem(_fmt(v)))
            s += v
        self.lbl_cl.setText(f"Итого: {_fmt(s)} ₸")

    def pay_w(self):
        r = self.t_sal.currentRow()
        if r < 0:
            return
        n = self.t_sal.item(r, 0).text()
        if (
            QMessageBox.question(
                self, "Оплата", f"Закрыть долг {n}?"
            )
            == QMessageBox.StandardButton.Yes
        ):
            self.db.archive_user(n)
            self.load()

    def close_w(self):
        if (
            QMessageBox.warning(
                self,
                "Внимание",
                "Списать ВСЕ активные долги в архив?",
                QMessageBox.StandardButton.Yes
                | QMessageBox.StandardButton.No,
            )
            == QMessageBox.StandardButton.Yes
        ):
            self.db.archive_week()
            self.load()

    def export_excel(self):
        p, _ = QFileDialog.getSaveFileName(
            self,
            "Save",
            f"Report_{datetime.now().strftime('%Y%m%d')}.xlsx",
            "*.xlsx",
        )
        if not p:
            return
        try:
            with pd.ExcelWriter(p) as w:
                pd.DataFrame(
                    self.db.get_warehouse_report(),
                    columns=["Штрих", "Товар", "Кол"],
                ).to_excel(w, "Склад", index=False)
                pd.DataFrame(
                    self.db.get_debts_by_role("worker"),
                    columns=["Имя", "Долг"],
                ).to_excel(w, "Сотрудники", index=False)
                pd.DataFrame(
                    self.db.get_debts_by_role("client"),
                    columns=["Имя", "Долг"],
                ).to_excel(w, "Клиенты", index=False)
            QMessageBox.information(self, "OK", "Сохранено!")
        except Exception as e:
            QMessageBox.critical(self, "Ошибка", str(e))

    # 4.2) QUEUE SENDER

    def _build_salary_like_message(self, name: str, date_from: str, date_to: str, rows: list):
        # rows: (created_at, product_name, price, qty, total)
        total_sum = sum(int(r[4] or 0) for r in rows)

        lines = []
        for created_at, pname, price, qty, total in rows:
            dt = str(created_at)  # "YYYY-MM-DD HH:MM:SS"
            dt_h = dt.replace("-", ".")
            lines.append(
                f"• <b>{tg_escape(pname)}</b> x{qty} = <b>{_fmt(total)} ₸</b>  <i>({dt_h})</i>"
            )

        body = "\n".join(lines) if lines else "<i>Нет записей за период</i>"

        msg = (
            f"📌 <b>История долгов</b>\n"
            f"👤 <b>{tg_escape(name)}</b>\n"
            f"📅 Период: <b>{iso_to_human(date_from)} — {iso_to_human(date_to)}</b>\n"
            f"------------------\n"
            f"{body}\n"
            f"------------------\n"
            f"Итого: <b>{_fmt(total_sum)} ₸</b>"
        )
        return msg

    def send_all_week(self):
        """
        Отправка всем сотрудникам (admin/worker), у кого есть telegram_chat_id в Supabase.
        Период: с 11 по 18 января.
        """
        date_from = "2026-01-11"
        date_to = "2026-01-18"

        ops = SupabaseManager.fetch_operators()  # id,name,role,is_active
        if not ops:
            QMessageBox.warning(self, "Telegram", "Не удалось получить список операторов с сайта")
            return

        staff = [o for o in ops if o.get("role") in ("admin", "worker")]

        enriched = []
        for o in staff:
            op_id = o.get("id")
            op_name = o.get("name") or ""
            if not op_id:
                continue
            chat_id = self._fetch_operator_chat_id(op_id)
            if chat_id:
                enriched.append((op_id, op_name, chat_id))

        if not enriched:
            QMessageBox.warning(self, "Telegram", "У сотрудников нет telegram_chat_id на сайте")
            return

        self._tg_queue = list(enriched)
        self._tg_date_from = date_from
        self._tg_date_to = date_to
        self._tg_sent = 0
        self._tg_failed = 0

        self._send_next_from_queue()

    def _fetch_operator_chat_id(self, operator_id: str):
        try:
            url = f"{SUPABASE_URL}/rest/v1/operators"
            params = {"select": "telegram_chat_id", "id": f"eq.{operator_id}", "limit": 1}
            r = requests.get(url, headers=supabase_headers(), params=params, timeout=8)
            r.raise_for_status()
            data = r.json()
            if data and data[0].get("telegram_chat_id"):
                return str(data[0]["telegram_chat_id"])
        except Exception as e:
            print("Fetch telegram_chat_id error:", e)
        return None

    def _send_next_from_queue(self):
        if not getattr(self, "_tg_queue", None):
            QMessageBox.information(
                self,
                "Telegram",
                f"Готово.\nОтправлено: {self._tg_sent}\nОшибок: {self._tg_failed}",
            )
            return

        operator_id, operator_name, chat_id = self._tg_queue.pop(0)

        # 5) Делай правильно: сначала ищем по supabase_id, потом по имени (fallback)
        local_user_id = None
        with self.db.get_conn() as conn:
            row = conn.execute(
                "SELECT id FROM users WHERE supabase_id = ? LIMIT 1",
                (operator_id,),
            ).fetchone()
            if row:
                local_user_id = int(row[0])
            else:
                row2 = conn.execute(
                    "SELECT id FROM users WHERE name = ? LIMIT 1",
                    (operator_name,),
                ).fetchone()
                if row2:
                    local_user_id = int(row2[0])

        if not local_user_id:
            self._tg_failed += 1
            QTimer.singleShot(150, self._send_next_from_queue)
            return

        rows = self.db.get_debts_history_for_user(local_user_id, self._tg_date_from, self._tg_date_to)
        msg = self._build_salary_like_message(operator_name, self._tg_date_from, self._tg_date_to, rows)

        self._tg_worker = TelegramWorker(msg, chat_id=chat_id)
        self._tg_worker.finished.connect(self._on_send_one_done)
        self._tg_worker.start()

    def _on_send_one_done(self, ok: bool, info: str):
        if ok:
            self._tg_sent += 1
        else:
            self._tg_failed += 1
            print("TG send error:", info)

        QTimer.singleShot(350, self._send_next_from_queue)


class HistoryTab(QWidget):
    def __init__(self, db: Database):
        super().__init__()
        self.db = db
        l = QVBoxLayout(self)
        l.addWidget(QLabel("<h3>🕰 История смен (Последние 50)</h3>"))

        btn = QPushButton("🔄 Обновить")
        btn.clicked.connect(self.load)
        l.addWidget(btn)

        self.t = QTableWidget(0, 6)
        self.t.setHorizontalHeaderLabels(
            ["Дата", "Оператор", "Старт", "Выручка (Факт)", "План", "Разница"]
        )
        self.t.horizontalHeader().setSectionResizeMode(
            QHeaderView.ResizeMode.Stretch
        )
        l.addWidget(self.t)
        self.load()

    def load(self):
        rows = self.db.get_shifts_history()
        self.t.setRowCount(len(rows))
        for i, row in enumerate(rows):
            op = row[1]
            date = row[2]
            wipon = row[3]
            kaspi = row[4]
            debts = row[5]
            cash = row[6]
            coins = row[7]
            start = row[8]
            diff = row[9]

            fact = kaspi + debts + cash + coins - start

            self.t.setItem(i, 0, QTableWidgetItem(date))
            self.t.setItem(i, 1, QTableWidgetItem(op))
            self.t.setItem(i, 2, QTableWidgetItem(_fmt(start)))
            self.t.setItem(i, 3, QTableWidgetItem(_fmt(fact)))
            self.t.setItem(i, 4, QTableWidgetItem(_fmt(wipon)))

            item_diff = QTableWidgetItem(_fmt(diff))
            if diff < 0:
                item_diff.setForeground(QBrush(QColor(C_RED)))
            elif diff > 0:
                item_diff.setForeground(QBrush(QColor(C_GREEN)))
            self.t.setItem(i, 5, item_diff)


class MainWindow(QMainWindow):
    def __init__(self, db: Database, ud):
        super().__init__()
        self.setWindowTitle(f"Учет Pro | {ud[1]}")
        self.resize(1280, 800)
        self.setStyleSheet(STYLESHEET)

        tabs = QTabWidget()
        tabs.setDocumentMode(True)
        self.setCentralWidget(tabs)

        tabs.addTab(ScannerTab(db, ud), "🛒 Сканер")
        tabs.addTab(CalculatorTab(db, ud), "🧮 Касса")

        if ud[2] == "admin":
            tabs.addTab(ProductsTab(db), "📦 Товары")
            tabs.addTab(WorkersTab(db), "👔 Персонал")
            tabs.addTab(ClientsTab(db), "📒 Клиенты")
            tabs.addTab(ReportTab(db), "📊 Отчеты")
            tabs.addTab(HistoryTab(db), "🕰 История смен")


if __name__ == "__main__":
    app = QApplication(sys.argv)
    app.setStyle("Fusion")
    db = Database()
    lw = LoginWindow(db)
    if lw.exec() == 1:
        w = MainWindow(db, lw.ud)
        w.show()
        sys.exit(app.exec())
