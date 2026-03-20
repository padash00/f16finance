"""
Offline storage and queue management for Orda Control Point
"""
from __future__ import annotations

import json
import sqlite3
import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, List, Dict, Any, Union
from enum import Enum
from contextlib import contextmanager
import threading

from config import get_config_manager, ensure_app_dir  # Добавляем ensure_app_dir

# Настройка логирования
logger = logging.getLogger(__name__)


# ==================== Константы и перечисления ====================

# Получаем директорию через менеджер конфигурации
config_manager = get_config_manager()
APP_DIR = config_manager.app_dir
DB_PATH = APP_DIR / "point_client.db"
DB_VERSION = 2
MAX_RETRIES = 10
CLEANUP_DAYS = 30


class QueueItemType(Enum):
    """Типы элементов очереди"""
    SHIFT_REPORT = "shift_report"
    DEBT_ACTION = "debt_action"
    
    def table_name(self) -> str:
        names = {
            "shift_report": "offline_reports",
            "debt_action": "offline_debt_actions"
        }
        return names.get(self.value, "")

class DebtActionType(Enum):
    """Типы действий с долгами"""
    CREATE = "createDebt"
    DELETE = "deleteDebt"
    UPDATE = "updateDebt"
    
    def display_name(self) -> str:
        names = {
            "createDebt": "Создание долга",
            "deleteDebt": "Удаление долга",
            "updateDebt": "Обновление долга"
        }
        return names.get(self.value, self.value)


class QueueStatus(Enum):
    """Статус элемента очереди"""
    PENDING = "pending"
    PROCESSING = "processing"
    FAILED = "failed"
    COMPLETED = "completed"
    
    def color(self) -> str:
        colors = {
            "pending": "#F59E0B",
            "processing": "#3B82F6",
            "failed": "#EF4444",
            "completed": "#10B981"
        }
        return colors.get(self.value, "#93A5C1")


# ==================== Модели данных ====================

class QueueItem:
    """Базовый класс для элемента очереди"""
    
    def __init__(self, 
                 id: int,
                 payload: Dict[str, Any],
                 retries: int = 0,
                 last_error: Optional[str] = None,
                 created_at: Optional[datetime] = None,
                 status: str = "pending"):
        
        self.id = id
        self.payload = payload
        self.retries = retries
        self.last_error = last_error
        self.created_at = created_at or datetime.now()
        self.status = status
        
    def to_dict(self) -> Dict[str, Any]:
        """Конвертация в словарь"""
        return {
            "id": self.id,
            "payload": self.payload,
            "retries": self.retries,
            "last_error": self.last_error,
            "created_at": self.created_at.isoformat(),
            "status": self.status
        }
        
    @classmethod
    def from_row(cls, row: sqlite3.Row) -> "QueueItem":
        """Создание из строки БД"""
        return cls(
            id=row["id"],
            payload=json.loads(row["payload"]),
            retries=row["retries"],
            last_error=row["last_error"],
            created_at=datetime.fromisoformat(row["created_at"]),
            status=row.get("status", "pending")
        )


class ShiftQueueItem(QueueItem):
    """Элемент очереди сменных отчётов"""
    
    @property
    def date(self) -> Optional[str]:
        """Дата отчёта"""
        return self.payload.get("date")
        
    @property
    def operator_id(self) -> Optional[str]:
        """ID оператора"""
        return self.payload.get("operator_id")
        
    @property
    def shift_type(self) -> Optional[str]:
        """Тип смены"""
        return self.payload.get("shift")
        
    @property
    def total_amount(self) -> int:
        """Общая сумма"""
        cash = self.payload.get("cash_amount", 0)
        kaspi = self.payload.get("kaspi_amount", 0)
        online = self.payload.get("online_amount", 0)
        return cash + kaspi + online


class DebtQueueItem(QueueItem):
    """Элемент очереди долговых действий"""
    
    def __init__(self, *args, action: Optional[str] = None, **kwargs):
        super().__init__(*args, **kwargs)
        self._action = action
        
    @property
    def action(self) -> str:
        """Тип действия"""
        return self._action or self.payload.get("action", "unknown")
        
    @property
    def action_type(self) -> Optional[DebtActionType]:
        """Тип действия как Enum"""
        try:
            return DebtActionType(self.action)
        except ValueError:
            return None
            
    @property
    def client_name(self) -> Optional[str]:
        """Имя клиента"""
        return self.payload.get("client_name") or self.payload.get("payload", {}).get("client_name")
        
    @property
    def amount(self) -> int:
        """Сумма долга"""
        return self.payload.get("total_amount", 0) or self.payload.get("payload", {}).get("total_amount", 0)
        
    @classmethod
    def from_row(cls, row: sqlite3.Row) -> "DebtQueueItem":
        """Создание из строки БД"""
        return cls(
            id=row["id"],
            payload=json.loads(row["payload"]),
            retries=row["retries"],
            last_error=row["last_error"],
            created_at=datetime.fromisoformat(row["created_at"]),
            status=row.get("status", "pending"),
            action=row["action"]
        )


# ==================== Менеджер очереди ====================

class QueueManager:
    """
    Управление офлайн-очередью для синхронизации данных
    
    Особенности:
    - Поддержка разных типов действий
    - Трекинг статусов
    - Автоматическая очистка старых записей
    - Статистика и мониторинг
    - Безопасная работа с потоками
    """
    
    def __init__(self, db_path: Optional[Path] = None):
        """
        Инициализация менеджера очереди
        
        Args:
            db_path: Путь к файлу БД (опционально)
        """
        ensure_app_dir()
        self.db_path = db_path or DB_PATH
        self._local = threading.local()
        self._init_db()
        
        logger.info(f"QueueManager initialized with DB: {self.db_path}")
        
    @contextmanager
    def _get_connection(self):
        """Получение соединения с БД (thread-local)"""
        if not hasattr(self._local, 'connection'):
            self._local.connection = sqlite3.connect(
                self.db_path,
                timeout=10,
                check_same_thread=False
            )
            self._local.connection.row_factory = sqlite3.Row
            self._local.connection.execute("PRAGMA foreign_keys = ON")
            self._local.connection.execute("PRAGMA journal_mode = WAL")
            
        try:
            yield self._local.connection
        except Exception as e:
            logger.error(f"Database error: {e}")
            self._local.connection.rollback()
            raise
        finally:
            self._local.connection.commit()
            
    def _init_db(self):
        """Инициализация структуры БД"""
        with self._get_connection() as conn:
            # Таблица сменных отчётов
            conn.execute("""
                CREATE TABLE IF NOT EXISTS offline_reports (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    payload TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    retries INTEGER NOT NULL DEFAULT 0,
                    last_error TEXT,
                    status TEXT DEFAULT 'pending',
                    processed_at TEXT,
                    metadata TEXT
                )
            """)
            
            # Таблица долговых действий
            conn.execute("""
                CREATE TABLE IF NOT EXISTS offline_debt_actions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    action TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    retries INTEGER NOT NULL DEFAULT 0,
                    last_error TEXT,
                    status TEXT DEFAULT 'pending',
                    processed_at TEXT,
                    metadata TEXT
                )
            """)
            
            # Индексы для оптимизации
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_reports_status 
                ON offline_reports(status, created_at)
            """)
            
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_debt_status 
                ON offline_debt_actions(status, created_at)
            """)
            
            # Таблица для хранения метаданных
            conn.execute("""
                CREATE TABLE IF NOT EXISTS queue_metadata (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)
            
            # Версия БД
            conn.execute("""
                INSERT OR IGNORE INTO queue_metadata (key, value, updated_at)
                VALUES ('db_version', ?, ?)
            """, (str(DB_VERSION), datetime.now().isoformat()))
            
            conn.commit()
            
        logger.debug("Database initialized")
        
    # ==================== Методы для сменных отчётов ====================

    def enqueue_shift(self, payload: Dict[str, Any]) -> int:
        """
        Добавление сменного отчёта в очередь
        
        Args:
            payload: Данные отчёта
            
        Returns:
            ID созданной записи
        """
        with self._get_connection() as conn:
            cursor = conn.execute(
                """
                INSERT INTO offline_reports (payload, created_at, status, metadata)
                VALUES (?, ?, ?, ?)
                """,
                (
                    json.dumps(payload, ensure_ascii=False),
                    datetime.now().isoformat(),
                    QueueStatus.PENDING.value,
                    json.dumps({
                        "date": payload.get("date"),
                        "operator_id": payload.get("operator_id"),
                        "shift": payload.get("shift")
                    })
                )
            )
            item_id = cursor.lastrowid
            
        logger.info(f"Shift report enqueued with ID: {item_id}")
        return item_id

    def list_pending_shifts(self, limit: int = 50) -> List[ShiftQueueItem]:
        """
        Получение списка ожидающих сменных отчётов
        
        Args:
            limit: Максимальное количество записей
            
        Returns:
            Список элементов очереди
        """
        with self._get_connection() as conn:
            rows = conn.execute(
                """
                SELECT id, payload, retries, last_error, created_at, status
                FROM offline_reports
                WHERE status IN (?, ?)
                ORDER BY created_at ASC
                LIMIT ?
                """,
                (QueueStatus.PENDING.value, QueueStatus.FAILED.value, limit)
            ).fetchall()
            
            return [ShiftQueueItem.from_row(row) for row in rows]

    def get_shift_stats(self) -> Dict[str, Any]:
        """Получение статистики по сменным отчётам"""
        with self._get_connection() as conn:
            # Общее количество
            total = conn.execute(
                "SELECT COUNT(*) as count FROM offline_reports"
            ).fetchone()["count"]
            
            # По статусам
            by_status = {}
            for status in QueueStatus:
                count = conn.execute(
                    "SELECT COUNT(*) as count FROM offline_reports WHERE status = ?",
                    (status.value,)
                ).fetchone()["count"]
                if count > 0:
                    by_status[status.value] = count
                    
            # Общая сумма
            total_amount = 0
            rows = conn.execute(
                "SELECT payload FROM offline_reports WHERE status != ?",
                (QueueStatus.COMPLETED.value,)
            ).fetchall()
            
            for row in rows:
                try:
                    payload = json.loads(row["payload"])
                    item = ShiftQueueItem.from_row(row)
                    total_amount += item.total_amount
                except (json.JSONDecodeError, KeyError, TypeError, ValueError):
                    pass

            return {
                "total": total,
                "by_status": by_status,
                "total_amount": total_amount,
                "oldest": self._get_oldest_item("offline_reports")
            }

    # ==================== Методы для долговых действий ====================

    def enqueue_debt_action(self, action: str, payload: Dict[str, Any]) -> int:
        """
        Добавление долгового действия в очередь
        
        Args:
            action: Тип действия (createDebt, deleteDebt, updateDebt)
            payload: Данные действия
            
        Returns:
            ID созданной записи
        """
        with self._get_connection() as conn:
            cursor = conn.execute(
                """
                INSERT INTO offline_debt_actions (action, payload, created_at, status, metadata)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    action,
                    json.dumps(payload, ensure_ascii=False),
                    datetime.now().isoformat(),
                    QueueStatus.PENDING.value,
                    json.dumps({
                        "client_name": payload.get("client_name") or payload.get("payload", {}).get("client_name"),
                        "amount": payload.get("total_amount") or payload.get("payload", {}).get("total_amount", 0)
                    })
                )
            )
            item_id = cursor.lastrowid
            
        logger.info(f"Debt action '{action}' enqueued with ID: {item_id}")
        return item_id

    def list_pending_debt_actions(self, limit: int = 100) -> List[DebtQueueItem]:
        """
        Получение списка ожидающих долговых действий
        
        Args:
            limit: Максимальное количество записей
            
        Returns:
            Список элементов очереди
        """
        with self._get_connection() as conn:
            rows = conn.execute(
                """
                SELECT id, action, payload, retries, last_error, created_at, status
                FROM offline_debt_actions
                WHERE status IN (?, ?)
                ORDER BY created_at ASC
                LIMIT ?
                """,
                (QueueStatus.PENDING.value, QueueStatus.FAILED.value, limit)
            ).fetchall()
            
            return [DebtQueueItem.from_row(row) for row in rows]

    def get_debt_stats(self) -> Dict[str, Any]:
        """Получение статистики по долговым действиям"""
        with self._get_connection() as conn:
            # Общее количество
            total = conn.execute(
                "SELECT COUNT(*) as count FROM offline_debt_actions"
            ).fetchone()["count"]
            
            # По статусам
            by_status = {}
            for status in QueueStatus:
                count = conn.execute(
                    "SELECT COUNT(*) as count FROM offline_debt_actions WHERE status = ?",
                    (status.value,)
                ).fetchone()["count"]
                if count > 0:
                    by_status[status.value] = count
                    
            # По типам действий
            by_action = {}
            rows = conn.execute(
                """
                SELECT action, COUNT(*) as count 
                FROM offline_debt_actions 
                GROUP BY action
                """
            ).fetchall()
            
            for row in rows:
                by_action[row["action"]] = row["count"]
                
            # Общая сумма
            total_amount = 0
            rows = conn.execute(
                "SELECT payload FROM offline_debt_actions WHERE status != ?",
                (QueueStatus.COMPLETED.value,)
            ).fetchall()
            
            for row in rows:
                try:
                    item = DebtQueueItem.from_row(row)
                    total_amount += item.amount
                except (json.JSONDecodeError, KeyError, TypeError, ValueError):
                    pass
                    
            return {
                "total": total,
                "by_status": by_status,
                "by_action": by_action,
                "total_amount": total_amount,
                "oldest": self._get_oldest_item("offline_debt_actions")
            }

    # ==================== Общие методы ====================

    def mark_shift_failed(self, item_id: int, error: str):
        """
        Отметить сменный отчёт как неудавшийся
        
        Args:
            item_id: ID записи
            error: Сообщение об ошибке
        """
        with self._get_connection() as conn:
            conn.execute(
                """
                UPDATE offline_reports 
                SET retries = retries + 1, 
                    last_error = ?,
                    status = ?,
                    processed_at = ?
                WHERE id = ?
                """,
                (
                    error[:500],
                    QueueStatus.FAILED.value,
                    datetime.now().isoformat(),
                    item_id
                )
            )
            
        logger.warning(f"Shift report {item_id} marked as failed: {error[:100]}")

    def mark_debt_failed(self, item_id: int, error: str):
        """
        Отметить долговое действие как неудавшееся
        
        Args:
            item_id: ID записи
            error: Сообщение об ошибке
        """
        with self._get_connection() as conn:
            conn.execute(
                """
                UPDATE offline_debt_actions 
                SET retries = retries + 1, 
                    last_error = ?,
                    status = ?,
                    processed_at = ?
                WHERE id = ?
                """,
                (
                    error[:500],
                    QueueStatus.FAILED.value,
                    datetime.now().isoformat(),
                    item_id
                )
            )
            
        logger.warning(f"Debt action {item_id} marked as failed: {error[:100]}")

    def mark_shift_completed(self, item_id: int):
        """Отметить сменный отчёт как выполненный"""
        with self._get_connection() as conn:
            conn.execute(
                """
                UPDATE offline_reports 
                SET status = ?,
                    processed_at = ?,
                    last_error = NULL
                WHERE id = ?
                """,
                (QueueStatus.COMPLETED.value, datetime.now().isoformat(), item_id)
            )
            
        logger.info(f"Shift report {item_id} marked as completed")

    def mark_debt_completed(self, item_id: int):
        """Отметить долговое действие как выполненное"""
        with self._get_connection() as conn:
            conn.execute(
                """
                UPDATE offline_debt_actions 
                SET status = ?,
                    processed_at = ?,
                    last_error = NULL
                WHERE id = ?
                """,
                (QueueStatus.COMPLETED.value, datetime.now().isoformat(), item_id)
            )
            
        logger.info(f"Debt action {item_id} marked as completed")

    def remove_shift(self, item_id: int):
        """Удаление сменного отчёта"""
        with self._get_connection() as conn:
            conn.execute("DELETE FROM offline_reports WHERE id = ?", (item_id,))
            
        logger.info(f"Shift report {item_id} removed from queue")

    def remove_debt_action(self, item_id: int):
        """Удаление долгового действия"""
        with self._get_connection() as conn:
            conn.execute("DELETE FROM offline_debt_actions WHERE id = ?", (item_id,))
            
        logger.info(f"Debt action {item_id} removed from queue")

    def get_item(self, item_type: QueueItemType, item_id: int) -> Optional[Union[ShiftQueueItem, DebtQueueItem]]:
        """
        Получение элемента очереди по ID
        
        Args:
            item_type: Тип элемента
            item_id: ID записи
            
        Returns:
            Элемент очереди или None
        """
        table = item_type.table_name()
        if not table:
            return None
            
        with self._get_connection() as conn:
            if item_type == QueueItemType.SHIFT_REPORT:
                row = conn.execute(
                    "SELECT id, payload, retries, last_error, created_at, status FROM offline_reports WHERE id = ?",
                    (item_id,)
                ).fetchone()
                return ShiftQueueItem.from_row(row) if row else None
                
            elif item_type == QueueItemType.DEBT_ACTION:
                row = conn.execute(
                    "SELECT id, action, payload, retries, last_error, created_at, status FROM offline_debt_actions WHERE id = ?",
                    (item_id,)
                ).fetchone()
                return DebtQueueItem.from_row(row) if row else None
                
        return None

    def count_shifts(self) -> int:
        """Количество ожидающих сменных отчётов"""
        with self._get_connection() as conn:
            row = conn.execute(
                "SELECT COUNT(*) as total FROM offline_reports WHERE status IN (?, ?)",
                (QueueStatus.PENDING.value, QueueStatus.FAILED.value)
            ).fetchone()
            return int(row["total"] or 0)

    def count_debt_actions(self) -> int:
        """Количество ожидающих долговых действий"""
        with self._get_connection() as conn:
            row = conn.execute(
                "SELECT COUNT(*) as total FROM offline_debt_actions WHERE status IN (?, ?)",
                (QueueStatus.PENDING.value, QueueStatus.FAILED.value)
            ).fetchone()
            return int(row["total"] or 0)

    def get_total_count(self) -> int:
        """Общее количество элементов в очереди"""
        return self.count_shifts() + self.count_debt_actions()

    def get_summary(self) -> Dict[str, Any]:
        """
        Получение сводки по очереди
        
        Returns:
            Словарь со статистикой
        """
        return {
            "shifts": self.get_shift_stats(),
            "debts": self.get_debt_stats(),
            "total": self.get_total_count(),
            "last_updated": datetime.now().isoformat()
        }

    def _get_oldest_item(self, table: str) -> Optional[str]:
        """Получение даты самого старого элемента"""
        with self._get_connection() as conn:
            row = conn.execute(
                f"SELECT created_at FROM {table} WHERE status != ? ORDER BY created_at ASC LIMIT 1",
                (QueueStatus.COMPLETED.value,)
            ).fetchone()
            
            return row["created_at"] if row else None

    def cleanup_old_items(self, days: int = CLEANUP_DAYS) -> int:
        """
        Очистка старых завершённых элементов
        
        Args:
            days: Удалять элементы старше N дней
            
        Returns:
            Количество удалённых элементов
        """
        cutoff = (datetime.now() - timedelta(days=days)).isoformat()
        
        with self._get_connection() as conn:
            # Удаление старых сменных отчётов
            shifts_deleted = conn.execute(
                "DELETE FROM offline_reports WHERE status = ? AND created_at < ?",
                (QueueStatus.COMPLETED.value, cutoff)
            ).rowcount
            
            # Удаление старых долговых действий
            debts_deleted = conn.execute(
                "DELETE FROM offline_debt_actions WHERE status = ? AND created_at < ?",
                (QueueStatus.COMPLETED.value, cutoff)
            ).rowcount
            
            total = shifts_deleted + debts_deleted
            
        if total > 0:
            logger.info(f"Cleaned up {total} old items from queue")
            
        return total

    def reset_stuck_items(self, hours: int = 24) -> int:
        """
        Сброс зависших элементов (processing > N часов)
        
        Args:
            hours: Считать зависшими элементы в статусе processing дольше N часов
            
        Returns:
            Количество сброшенных элементов
        """
        cutoff = (datetime.now() - timedelta(hours=hours)).isoformat()
        
        with self._get_connection() as conn:
            # Сброс сменных отчётов
            shifts_reset = conn.execute(
                """
                UPDATE offline_reports 
                SET status = ?, last_error = ?
                WHERE status = ? AND created_at < ?
                """,
                (QueueStatus.PENDING.value, "Reset due to timeout", QueueStatus.PROCESSING.value, cutoff)
            ).rowcount
            
            # Сброс долговых действий
            debts_reset = conn.execute(
                """
                UPDATE offline_debt_actions 
                SET status = ?, last_error = ?
                WHERE status = ? AND created_at < ?
                """,
                (QueueStatus.PENDING.value, "Reset due to timeout", QueueStatus.PROCESSING.value, cutoff)
            ).rowcount
            
            total = shifts_reset + debts_reset
            
        if total > 0:
            logger.info(f"Reset {total} stuck items in queue")
            
        return total

    def export_queue(self) -> Dict[str, Any]:
        """Экспорт всей очереди для отладки"""
        return {
            "shifts": [item.to_dict() for item in self.list_pending_shifts(1000)],
            "debts": [item.to_dict() for item in self.list_pending_debt_actions(1000)],
            "stats": self.get_summary(),
            "exported_at": datetime.now().isoformat()
        }

    def vacuum(self):
        """Оптимизация БД"""
        with self._get_connection() as conn:
            conn.execute("VACUUM")
            logger.info("Database vacuum completed")


# ==================== Обратная совместимость ====================

class OfflineQueue:
    """
    Класс для обратной совместимости с существующим кодом
    
    Delegates to QueueManager
    """
    
    def __init__(self, path: Optional[Path] = None):
        self._manager = QueueManager(path)
        
    def enqueue(self, payload: dict):
        self._manager.enqueue_shift(payload)
        
    def enqueue_shift(self, payload: dict):
        self._manager.enqueue_shift(payload)
        
    def list_pending(self, limit: int = 20) -> list[dict]:
        return [item.to_dict() for item in self._manager.list_pending_shifts(limit)]
        
    def list_pending_shifts(self, limit: int = 20) -> list[dict]:
        return [item.to_dict() for item in self._manager.list_pending_shifts(limit)]
        
    def mark_failed(self, item_id: int, error: str):
        self._manager.mark_shift_failed(item_id, error)
        
    def mark_failed_shift(self, item_id: int, error: str):
        self._manager.mark_shift_failed(item_id, error)
        
    def remove(self, item_id: int):
        self._manager.remove_shift(item_id)
        
    def remove_shift(self, item_id: int):
        self._manager.remove_shift(item_id)
        
    def count(self) -> int:
        return self._manager.count_shifts()
        
    def count_shifts(self) -> int:
        return self._manager.count_shifts()
        
    def enqueue_debt_action(self, action: str, payload: dict):
        self._manager.enqueue_debt_action(action, payload)
        
    def list_pending_debt_actions(self, limit: int = 100) -> list[dict]:
        return [item.to_dict() for item in self._manager.list_pending_debt_actions(limit)]
        
    def mark_failed_debt_action(self, item_id: int, error: str):
        self._manager.mark_debt_failed(item_id, error)
        
    def remove_debt_action(self, item_id: int):
        self._manager.remove_debt_action(item_id)
        
    def count_debt_actions(self) -> int:
        return self._manager.count_debt_actions()
        
    # Новые методы для расширенной функциональности
    def get_stats(self) -> dict:
        """Получение статистики очереди"""
        return self._manager.get_summary()
        
    def cleanup_old(self, days: int = 30) -> int:
        """Очистка старых записей"""
        return self._manager.cleanup_old_items(days)