"""
Configuration management for Orda Control Point
"""
from __future__ import annotations

import json
import os
import logging
from pathlib import Path
from typing import Any, Optional, Dict, Union
from dataclasses import dataclass, field, asdict
from datetime import datetime
from enum import Enum
import shutil

# Настройка логирования
logger = logging.getLogger(__name__)


# ==================== Enums и константы ====================

class Environment(Enum):
    """Окружение приложения"""
    DEVELOPMENT = "development"
    PRODUCTION = "production"
    TESTING = "testing"


# ==================== Dataclasses для конфигурации ====================

@dataclass
class DraftData:
    """Черновик формы смены"""
    date: Optional[str] = None
    selected_shift: Optional[str] = None
    comment: str = ""
    inputs: Dict[str, str] = field(default_factory=dict)
    
    @classmethod
    def from_dict(cls, data: Optional[Dict]) -> "DraftData":
        if not data:
            return cls()
        return cls(
            date=data.get("date"),
            selected_shift=data.get("selected_shift"),
            comment=data.get("comment", ""),
            inputs=data.get("inputs", {})
        )


@dataclass
class DebtDraftData:
    """Черновик формы долга"""
    selected_operator_id: Optional[str] = None
    manual_name: str = ""
    item_name: str = ""
    quantity: int = 1
    unit_price: str = "0"
    comment: str = ""
    date: Optional[str] = None
    
    @classmethod
    def from_dict(cls, data: Optional[Dict]) -> "DebtDraftData":
        if not data:
            return cls()
        return cls(
            selected_operator_id=data.get("selected_operator_id"),
            manual_name=data.get("manual_name", ""),
            item_name=data.get("item_name", ""),
            quantity=int(data.get("quantity", 1)),
            unit_price=data.get("unit_price", "0"),
            comment=data.get("comment", ""),
            date=data.get("date")
        )


@dataclass
class ScannerDraftData:
    """Черновик формы сканера"""
    selected_operator_id: Optional[str] = None
    manual_name: str = ""
    barcode: str = ""
    current_index: int = 0
    quantity: int = 1
    price: str = "0"
    
    @classmethod
    def from_dict(cls, data: Optional[Dict]) -> "ScannerDraftData":
        if not data:
            return cls()
        return cls(
            selected_operator_id=data.get("selected_operator_id"),
            manual_name=data.get("manual_name", ""),
            barcode=data.get("barcode", ""),
            current_index=int(data.get("current_index", 0)),
            quantity=int(data.get("quantity", 1)),
            price=data.get("price", "0")
        )


@dataclass
class AppConfig:
    """Основная конфигурация приложения"""
    # Основные настройки
    api_base_url: str = "https://ordaops.kz"
    device_token: str = ""
    last_operator_username: str = ""
    
    # Telegram
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""
    
    # Черновики
    draft: DraftData = field(default_factory=DraftData)
    debt_draft: DebtDraftData = field(default_factory=DebtDraftData)
    scanner_draft: ScannerDraftData = field(default_factory=ScannerDraftData)
    
    # Метаданные
    config_version: str = "2.0"
    last_updated: Optional[str] = None
    environment: str = Environment.PRODUCTION.value
    
    def __post_init__(self):
        """Пост-инициализация для конвертации словарей в dataclasses"""
        if isinstance(self.draft, dict):
            self.draft = DraftData.from_dict(self.draft)
        if isinstance(self.debt_draft, dict):
            self.debt_draft = DebtDraftData.from_dict(self.debt_draft)
        if isinstance(self.scanner_draft, dict):
            self.scanner_draft = ScannerDraftData.from_dict(self.scanner_draft)
    
    def to_dict(self) -> Dict[str, Any]:
        """Конвертация в словарь для сохранения"""
        return {
            "api_base_url": self.api_base_url,
            "device_token": self.device_token,
            "last_operator_username": self.last_operator_username,
            "telegram_bot_token": self.telegram_bot_token,
            "telegram_chat_id": self.telegram_chat_id,
            "draft": asdict(self.draft) if self.draft else {},
            "debt_draft": asdict(self.debt_draft) if self.debt_draft else {},
            "scanner_draft": asdict(self.scanner_draft) if self.scanner_draft else {},
            "config_version": self.config_version,
            "last_updated": datetime.now().isoformat(),
            "environment": self.environment
        }
    
    def update_from_dict(self, data: Dict[str, Any]):
        """Обновление из словаря"""
        self.api_base_url = str(data.get("api_base_url", self.api_base_url)).rstrip("/")
        self.device_token = str(data.get("device_token", self.device_token))
        self.last_operator_username = str(data.get("last_operator_username", self.last_operator_username))
        self.telegram_bot_token = str(data.get("telegram_bot_token", self.telegram_bot_token))
        self.telegram_chat_id = str(data.get("telegram_chat_id", self.telegram_chat_id))
        
        # Обновление черновиков
        draft_data = data.get("draft")
        if draft_data:
            self.draft = DraftData.from_dict(draft_data)
            
        debt_draft_data = data.get("debt_draft")
        if debt_draft_data:
            self.debt_draft = DebtDraftData.from_dict(debt_draft_data)
            
        scanner_draft_data = data.get("scanner_draft")
        if scanner_draft_data:
            self.scanner_draft = ScannerDraftData.from_dict(scanner_draft_data)
        
        # Метаданные
        self.config_version = str(data.get("config_version", self.config_version))
        self.environment = str(data.get("environment", self.environment))
    
    def validate(self) -> tuple[bool, list[str]]:
        """
        Валидация конфигурации
        
        Returns:
            Tuple[is_valid, list_of_errors]
        """
        errors = []
        
        # Проверка API URL
        if self.api_base_url:
            if not self.api_base_url.startswith(("http://", "https://")):
                errors.append("API URL должен начинаться с http:// или https://")
        
        # Проверка Telegram токена (если указан)
        if self.telegram_bot_token and len(self.telegram_bot_token) < 40:
            errors.append("Telegram bot token выглядит некорректным")
        
        # Проверка device token (необязательно)
        if self.device_token and len(self.device_token) < 10:
            errors.append("Device token слишком короткий")
        
        return len(errors) == 0, errors
    
    def mask_sensitive(self) -> Dict[str, Any]:
        """
        Получение словаря с замаскированными чувствительными данными
        (для логирования)
        """
        masked = self.to_dict()
        if masked["device_token"]:
            masked["device_token"] = self._mask_string(masked["device_token"])
        if masked["telegram_bot_token"]:
            masked["telegram_bot_token"] = self._mask_string(masked["telegram_bot_token"])
        return masked
    
    @staticmethod
    def _mask_string(s: str, visible_chars: int = 4) -> str:
        """Маскирование строки"""
        if len(s) <= visible_chars * 2:
            return "*" * len(s)
        return s[:visible_chars] + "..." + s[-visible_chars:]


# ==================== Configuration Manager ====================

class ConfigurationError(Exception):
    """Исключение при работе с конфигурацией"""
    pass


class ConfigManager:
    """
    Менеджер конфигурации с поддержкой:
    - Мультиокружений (dev/prod/testing)
    - Валидации
    - Бэкапов
    - Миграций версий
    """
    
    # Константы
    DEFAULT_API_URL = "https://ordaops.kz"
    BACKUP_SUFFIX = ".backup"
    MAX_BACKUPS = 5
    
    def __init__(self, app_name: str = "OrdaControlPoint"):
        """
        Инициализация менеджера конфигурации
        
        Args:
            app_name: Имя приложения для директории
        """
        self.app_name = app_name
        self.config: Optional[AppConfig] = None
        
        # Определение директории приложения
        self._setup_app_directory()
        
        # Загрузка конфигурации
        self.load()
    
    def _setup_app_directory(self):
        """Настройка директории приложения"""
        # Поддержка множественных инстансов через переменную окружения
        env_dir = os.environ.get("ORDA_APP_DIR", "")
        
        if env_dir:
            self.app_dir = Path(env_dir)
        else:
            # Определение ОС для правильной директории
            if os.name == 'nt':  # Windows
                self.app_dir = Path.home() / "AppData" / "Local" / self.app_name
            else:  # Linux/Mac
                self.app_dir = Path.home() / ".config" / self.app_name.lower()
        
        self.config_path = self.app_dir / "config.json"
        self.backup_dir = self.app_dir / "backups"
        
        logger.info(f"App directory: {self.app_dir}")
    
    def ensure_app_dir(self) -> Path:
        """Создание директории приложения если её нет"""
        self.app_dir.mkdir(parents=True, exist_ok=True)
        self.backup_dir.mkdir(parents=True, exist_ok=True)
        return self.app_dir
    
    def load(self) -> AppConfig:
        """
        Загрузка конфигурации из файла
        
        Returns:
            Загруженная конфигурация
        
        Raises:
            ConfigurationError: При ошибке загрузки
        """
        self.ensure_app_dir()
        
        if not self.config_path.exists():
            logger.info("Config file not found, creating default configuration")
            self.config = AppConfig()
            self.save()
            return self.config
        
        try:
            data = json.loads(self.config_path.read_text(encoding="utf-8"))
            logger.debug(f"Loaded config: {self._mask_sensitive_data(data)}")
            
            # Создание конфигурации
            self.config = AppConfig()
            self.config.update_from_dict(data)
            
            # Валидация
            is_valid, errors = self.config.validate()
            if not is_valid:
                logger.warning(f"Config validation warnings: {errors}")
            
            # Проверка версии и миграция при необходимости
            self._check_version_migration(data)
            
            return self.config
            
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse config file: {e}")
            self._backup_corrupted_config()
            logger.info("Creating new configuration from defaults")
            self.config = AppConfig()
            self.save()
            return self.config
            
        except Exception as e:
            logger.error(f"Unexpected error loading config: {e}")
            raise ConfigurationError(f"Failed to load configuration: {e}")
    
    def save(self) -> bool:
        """
        Сохранение конфигурации в файл
        
        Returns:
            True если сохранение успешно
        """
        if not self.config:
            logger.warning("No configuration to save")
            return False
        
        try:
            self.ensure_app_dir()
            
            # Создание бэкапа перед сохранением
            self._create_backup()
            
            # Подготовка данных
            data = self.config.to_dict()
            
            # Запись во временный файл для атомарности
            temp_path = self.config_path.with_suffix(".tmp")
            temp_path.write_text(
                json.dumps(data, ensure_ascii=False, indent=2),
                encoding="utf-8"
            )
            
            # Атомарная замена
            temp_path.replace(self.config_path)
            
            logger.debug(f"Saved config: {self._mask_sensitive_data(data)}")
            logger.info(f"Configuration saved to {self.config_path}")
            
            # Очистка старых бэкапов
            self._cleanup_old_backups()
            
            return True
            
        except Exception as e:
            logger.error(f"Failed to save configuration: {e}")
            return False
    
    def _check_version_migration(self, data: Dict[str, Any]):
        """Проверка версии и миграция при необходимости"""
        current_version = data.get("config_version", "1.0")
        
        if current_version != self.config.config_version:
            logger.info(f"Config version mismatch: {current_version} -> {self.config.config_version}")
            self._migrate_config(current_version, self.config.config_version)
    
    def _migrate_config(self, from_version: str, to_version: str):
        """Миграция конфигурации между версиями"""
        # Здесь будут правила миграции для будущих версий
        logger.info(f"Migrating config from {from_version} to {to_version}")
        
        # Пример: v1.0 -> v2.0
        if from_version == "1.0" and to_version == "2.0":
            self._migrate_v1_to_v2()
    
    def _migrate_v1_to_v2(self):
        """Миграция с версии 1.0 на 2.0"""
        # Здесь логика миграции старых конфигов
        pass
    
    def _create_backup(self):
        """Создание бэкапа текущего конфига"""
        if not self.config_path.exists():
            return
        
        try:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            backup_name = f"config_{timestamp}.json{self.BACKUP_SUFFIX}"
            backup_path = self.backup_dir / backup_name
            
            shutil.copy2(self.config_path, backup_path)
            logger.debug(f"Created backup: {backup_path}")
            
        except Exception as e:
            logger.warning(f"Failed to create backup: {e}")
    
    def _cleanup_old_backups(self):
        """Очистка старых бэкапов"""
        try:
            backups = sorted(self.backup_dir.glob(f"config_*{self.BACKUP_SUFFIX}"))
            
            # Удаление старых бэкапов
            for backup in backups[:-self.MAX_BACKUPS]:
                backup.unlink()
                logger.debug(f"Removed old backup: {backup}")
                
        except Exception as e:
            logger.warning(f"Failed to cleanup backups: {e}")
    
    def _backup_corrupted_config(self):
        """Бэкап повреждённого конфига"""
        if not self.config_path.exists():
            return
        
        try:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            corrupted_path = self.app_dir / f"config_corrupted_{timestamp}.json"
            shutil.copy2(self.config_path, corrupted_path)
            logger.info(f"Corrupted config backed up to {corrupted_path}")
            
        except Exception as e:
            logger.error(f"Failed to backup corrupted config: {e}")
    
    def _mask_sensitive_data(self, data: Dict) -> Dict:
        """Маскирование чувствительных данных для логов"""
        masked = data.copy()
        
        if "device_token" in masked and masked["device_token"]:
            masked["device_token"] = AppConfig._mask_string(masked["device_token"])
            
        if "telegram_bot_token" in masked and masked["telegram_bot_token"]:
            masked["telegram_bot_token"] = AppConfig._mask_string(masked["telegram_bot_token"])
            
        return masked
    
    # ==================== Удобные методы доступа ====================
    
    @property
    def api_base_url(self) -> str:
        return self.config.api_base_url if self.config else self.DEFAULT_API_URL
    
    @api_base_url.setter
    def api_base_url(self, value: str):
        if self.config:
            self.config.api_base_url = value.rstrip("/")
    
    @property
    def device_token(self) -> str:
        return self.config.device_token if self.config else ""
    
    @device_token.setter
    def device_token(self, value: str):
        if self.config:
            self.config.device_token = value.strip()
    
    @property
    def has_valid_token(self) -> bool:
        """Проверка наличия валидного токена"""
        if not self.config or not self.config.device_token:
            return False
        return len(self.config.device_token) >= 10
    
    def update_draft(self, draft_data: Dict[str, Any]):
        """Обновление черновика смены"""
        if self.config:
            self.config.draft = DraftData.from_dict(draft_data)
    
    def update_debt_draft(self, draft_data: Dict[str, Any]):
        """Обновление черновика долга"""
        if self.config:
            self.config.debt_draft = DebtDraftData.from_dict(draft_data)
    
    def update_scanner_draft(self, draft_data: Dict[str, Any]):
        """Обновление черновика сканера"""
        if self.config:
            self.config.scanner_draft = ScannerDraftData.from_dict(draft_data)
    
    def clear_sensitive_data(self):
        """Очистка чувствительных данных (для логаута)"""
        if self.config:
            self.config.device_token = ""
            self.config.telegram_bot_token = ""
            self.config.telegram_chat_id = ""
            self.save()
    
    def export_for_logging(self) -> Dict:
        """Экспорт конфигурации для логирования (без чувствительных данных)"""
        if not self.config:
            return {}
        return self.config.mask_sensitive()
    
    def reset_to_defaults(self):
        """Сброс к настройкам по умолчанию"""
        self.config = AppConfig()
        self.save()
        logger.info("Configuration reset to defaults")


# ==================== Singleton instance ====================

_config_manager: Optional[ConfigManager] = None


def get_config_manager(app_name: str = "OrdaControlPoint") -> ConfigManager:
    """
    Получение глобального экземпляра менеджера конфигурации (синглтон)
    
    Args:
        app_name: Имя приложения
        
    Returns:
        Экземпляр ConfigManager
    """
    global _config_manager
    if _config_manager is None:
        _config_manager = ConfigManager(app_name)
    return _config_manager


# ==================== Функции обратной совместимости ====================

def ensure_app_dir() -> Path:
    """Обратная совместимость: создание директории приложения"""
    return get_config_manager().ensure_app_dir()


def load_config() -> dict:
    """Обратная совместимость: загрузка конфигурации"""
    manager = get_config_manager()
    manager.load()
    if manager.config:
        return manager.config.to_dict()
    return {}


def save_config(config: dict) -> None:
    """Обратная совместимость: сохранение конфигурации"""
    manager = get_config_manager()
    if manager.config:
        manager.config.update_from_dict(config)
    else:
        manager.config = AppConfig()
        manager.config.update_from_dict(config)
    manager.save()


# ==================== Инициализация при импорте ====================

# Настройка логирования по умолчанию
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

# ==================== Обратная совместимость ====================

# Экспортируем старые имена для обратной совместимости
APP_DIR = get_config_manager().app_dir
CONFIG_PATH = get_config_manager().config_path
# ensure_app_dir определена выше в секции "Функции обратной совместимости"