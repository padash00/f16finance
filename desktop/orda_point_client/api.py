from __future__ import annotations

import json
import logging
import time
from typing import Any, Optional, Callable, TypeVar, ParamSpec
from dataclasses import dataclass
from enum import Enum
from functools import wraps

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# Настройка логирования
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Типы для декораторов
P = ParamSpec('P')
T = TypeVar('T')


class ApiErrorCode(Enum):
    """Коды ошибок API"""
    INVALID_CREDENTIALS = "invalid-credentials"
    OPERATOR_NOT_ASSIGNED = "operator-not-assigned"
    SUPER_ADMIN_ONLY = "super-admin-only"
    DEVICE_NOT_FOUND = "device-not-found"
    DEBT_NOT_FOUND = "debt-item-not-found"
    DEBT_ALREADY_DELETED = "debt-item-already-deleted"
    PRODUCT_NOT_FOUND = "product-not-found"
    NETWORK_ERROR = "network-error"
    TIMEOUT_ERROR = "timeout-error"
    SERVER_ERROR = "server-error"
    UNKNOWN_ERROR = "unknown-error"


@dataclass
class ApiResponse:
    """Стандартизированный ответ API"""
    success: bool
    data: Optional[Any] = None
    error: Optional[str] = None
    error_code: Optional[ApiErrorCode] = None
    status_code: Optional[int] = None


class ApiError(Exception):
    """Кастомное исключение для API"""
    def __init__(self, message: str, code: ApiErrorCode = ApiErrorCode.UNKNOWN_ERROR, status_code: int = 500):
        self.message = message
        self.code = code
        self.status_code = status_code
        super().__init__(f"[{code.value}] {message}")


def handle_api_errors(func: Callable[P, T]) -> Callable[P, T]:
    """Декоратор для обработки ошибок API"""
    @wraps(func)
    def wrapper(*args: P.args, **kwargs: P.kwargs) -> T:
        try:
            return func(*args, **kwargs)
        except requests.exceptions.ConnectionError as e:
            logger.error(f"Network connection error: {e}")
            raise ApiError("Ошибка подключения к серверу", ApiErrorCode.NETWORK_ERROR, 503)
        except requests.exceptions.Timeout as e:
            logger.error(f"Request timeout: {e}")
            raise ApiError("Превышено время ожидания ответа", ApiErrorCode.TIMEOUT_ERROR, 504)
        except requests.exceptions.RequestException as e:
            logger.error(f"Request error: {e}")
            raise ApiError(f"Ошибка запроса: {str(e)}", ApiErrorCode.UNKNOWN_ERROR, 500)
        except Exception as e:
            logger.error(f"Unexpected error: {e}")
            raise
    return wrapper


class PointApiClient:
    """
    Улучшенный клиент для работы с Orda Control API
    
    Особенности:
    - Автоматические retry при временных ошибках
    - Детальное логирование
    - Стандартизированные ответы
    - Обработка специфических ошибок
    - Поддержка таймаутов
    """
    
    # Константы
    DEFAULT_TIMEOUT = 20
    LONG_TIMEOUT = 30
    MAX_RETRIES = 3
    RETRY_BACKOFF_FACTOR = 0.5
    
    def __init__(self, api_base_url: str, device_token: str):
        """
        Инициализация клиента
        
        Args:
            api_base_url: Базовый URL API (например, https://ordaops.kz)
            device_token: Токен устройства
        """
        self.api_base_url = api_base_url.rstrip("/")
        self.device_token = device_token.strip()
        
        # Настройка сессии с retry стратегией
        self.session = self._create_robust_session()
        
        logger.info(f"API Client initialized for {self.api_base_url}")
        
    def _create_robust_session(self) -> requests.Session:
        """Создание сессии с retry стратегией и пулом соединений"""
        session = requests.Session()
        
        # Настройка retry стратегии
        retry_strategy = Retry(
            total=self.MAX_RETRIES,
            backoff_factor=self.RETRY_BACKOFF_FACTOR,
            status_forcelist=[429, 500, 502, 503, 504],
            allowed_methods=["HEAD", "GET", "OPTIONS", "POST"]
        )
        
        # Адаптер для HTTP и HTTPS
        adapter = HTTPAdapter(
            max_retries=retry_strategy,
            pool_connections=10,
            pool_maxsize=20
        )
        
        session.mount("http://", adapter)
        session.mount("https://", adapter)
        
        return session

    def _headers(self, include_device_token: bool = True) -> dict[str, str]:
        """Формирование заголовков запроса"""
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": f"OrdaControlPoint/2.0",
            "X-Client-Version": "2.0.0",
            "X-Client-Time": str(int(time.time()))
        }
        
        if include_device_token and self.device_token:
            headers["x-point-device-token"] = self.device_token
            logger.debug(f"Using device token: {self.device_token[:8]}...")
            
        return headers

    def _parse_error_response(self, response: requests.Response) -> tuple[str, ApiErrorCode]:
        """
        Парсинг ошибки из ответа сервера
        
        Returns:
            Tuple[message, error_code]
        """
        try:
            payload = response.json()
            if isinstance(payload, dict):
                message = payload.get("error") or payload.get("message") or "Unknown error"
                
                # Определение кода ошибки по сообщению
                error_msg = message.lower()
                if "invalid-credentials" in error_msg or "неверный логин" in error_msg:
                    return message, ApiErrorCode.INVALID_CREDENTIALS
                elif "operator-not-assigned" in error_msg:
                    return message, ApiErrorCode.OPERATOR_NOT_ASSIGNED
                elif "super-admin-only" in error_msg:
                    return message, ApiErrorCode.SUPER_ADMIN_ONLY
                elif "debt-item-not-found" in error_msg:
                    return message, ApiErrorCode.DEBT_NOT_FOUND
                elif "debt-item-already-deleted" in error_msg:
                    return message, ApiErrorCode.DEBT_ALREADY_DELETED
                elif "product-not-found" in error_msg:
                    return message, ApiErrorCode.PRODUCT_NOT_FOUND
                
                return message, ApiErrorCode.UNKNOWN_ERROR
                
            elif isinstance(payload, list):
                return json.dumps(payload, ensure_ascii=False), ApiErrorCode.UNKNOWN_ERROR
                
        except Exception as e:
            logger.warning(f"Failed to parse error response: {e}")
            
        # Если не удалось распарсить JSON
        text = response.text.strip() or "No response body"
        return text, ApiErrorCode.UNKNOWN_ERROR

    def _raise_for_status(self, response: requests.Response):
        """Проверка статуса ответа с детальной ошибкой"""
        if response.ok:
            return
            
        message, error_code = self._parse_error_response(response)
        logger.error(f"API Error {response.status_code}: {message}")
        
        raise ApiError(message, error_code, response.status_code)

    @handle_api_errors
    def _make_request(
        self,
        method: str,
        endpoint: str,
        json_data: Optional[dict] = None,
        headers: Optional[dict] = None,
        timeout: int = DEFAULT_TIMEOUT,
        include_device_token: bool = True
    ) -> dict[str, Any]:
        """
        Базовый метод для выполнения HTTP запросов
        
        Args:
            method: HTTP метод (GET, POST, etc.)
            endpoint: Endpoint (например, "/api/point/bootstrap")
            json_data: Данные для отправки
            headers: Дополнительные заголовки
            timeout: Таймаут в секундах
            include_device_token: Включать ли device token в заголовки
            
        Returns:
            JSON ответ от сервера
        """
        url = f"{self.api_base_url}{endpoint}"
        
        request_headers = self._headers(include_device_token)
        if headers:
            request_headers.update(headers)
            
        logger.debug(f"Making {method} request to {url}")
        if json_data:
            logger.debug(f"Request data: {json.dumps(json_data, ensure_ascii=False)[:200]}")
        
        response = self.session.request(
            method=method,
            url=url,
            headers=request_headers,
            json=json_data,
            timeout=timeout
        )
        
        self._raise_for_status(response)
        
        response_data = response.json()
        logger.debug(f"Response received: {json.dumps(response_data, ensure_ascii=False)[:200]}")
        
        return response_data

    # ==================== Публичные методы API ====================

    @handle_api_errors
    def bootstrap(self) -> dict[str, Any]:
        """
        Получение данных о точке (bootstrap)
        
        Returns:
            Данные точки, компании и операторов
            
        Raises:
            ApiError: При ошибке запроса
        """
        logger.info("Fetching bootstrap data")
        
        data = self._make_request(
            method="GET",
            endpoint="/api/point/bootstrap",
            timeout=self.LONG_TIMEOUT
        )
        
        # Логируем результат
        company = data.get("company", {})
        device = data.get("device", {})
        operators_count = len(data.get("operators", []))
        
        logger.info(
            f"Bootstrap successful: "
            f"Company={company.get('name')}, "
            f"Device={device.get('name')}, "
            f"Operators={operators_count}"
        )
        
        return data

    @handle_api_errors
    def send_shift_report(self, payload: dict[str, Any]) -> dict[str, Any]:
        """
        Отправка отчёта о смене
        
        Args:
            payload: Данные отчёта
            
        Returns:
            Ответ сервера
        """
        logger.info(f"Sending shift report for date {payload.get('date')}")
        
        return self._make_request(
            method="POST",
            endpoint="/api/point/shift-report",
            json_data={
                "action": "createShiftReport",
                "payload": payload
            },
            timeout=self.LONG_TIMEOUT
        )

    @handle_api_errors
    def login_operator(self, username: str, password: str) -> dict[str, Any]:
        """
        Вход оператора
        
        Args:
            username: Логин оператора
            password: Пароль
            
        Returns:
            Данные оператора
        """
        logger.info(f"Operator login attempt: {username}")
        
        data = self._make_request(
            method="POST",
            endpoint="/api/point/login",
            json_data={
                "username": username,
                "password": password
            },
            include_device_token=True
        )
        
        operator = data.get("operator", {})
        logger.info(f"Operator login successful: {operator.get('full_name')}")
        
        return data

    @handle_api_errors
    def list_debts(self) -> dict[str, Any]:
        """
        Получение списка долгов точки
        
        Returns:
            Список долгов
        """
        logger.debug("Fetching debts list")
        
        data = self._make_request(
            method="GET",
            endpoint="/api/point/debts"
        )
        
        items = data.get("data", {}).get("items", [])
        logger.debug(f"Retrieved {len(items)} debts")
        
        return data

    @handle_api_errors
    def create_debt(self, payload: dict[str, Any]) -> dict[str, Any]:
        """
        Создание нового долга
        
        Args:
            payload: Данные долга
            
        Returns:
            Созданный долг
        """
        client_name = payload.get("client_name", "Unknown")
        amount = payload.get("total_amount", 0)
        
        logger.info(f"Creating debt for {client_name}, amount={amount}")
        
        return self._make_request(
            method="POST",
            endpoint="/api/point/debts",
            json_data={
                "action": "createDebt",
                "payload": payload
            }
        )

    @handle_api_errors
    def delete_debt(self, item_id: str) -> dict[str, Any]:
        """
        Удаление долга
        
        Args:
            item_id: ID долга
            
        Returns:
            Ответ сервера
        """
        logger.info(f"Deleting debt with ID: {item_id}")
        
        try:
            return self._make_request(
                method="POST",
                endpoint="/api/point/debts",
                json_data={
                    "action": "deleteDebt",
                    "itemId": item_id
                }
            )
        except ApiError as e:
            # Если долг уже удалён - считаем это успехом
            if e.code in [ApiErrorCode.DEBT_NOT_FOUND, ApiErrorCode.DEBT_ALREADY_DELETED]:
                logger.info(f"Debt {item_id} already deleted or not found")
                return {"success": True, "message": "Debt already deleted"}
            raise

    @handle_api_errors
    def list_products(self) -> dict[str, Any]:
        """
        Получение списка товаров
        
        Returns:
            Список товаров
        """
        logger.debug("Fetching products list")
        
        data = self._make_request(
            method="GET",
            endpoint="/api/point/products"
        )
        
        products = data.get("data", {}).get("products", [])
        logger.debug(f"Retrieved {len(products)} products")
        
        return data

    @handle_api_errors
    def create_product(
        self,
        email: str,
        password: str,
        payload: dict[str, Any]
    ) -> dict[str, Any]:
        """
        Создание нового товара
        
        Args:
            email: Email администратора
            password: Пароль администратора
            payload: Данные товара
            
        Returns:
            Созданный товар
        """
        logger.info(f"Creating product: {payload.get('name')}")
        
        return self._make_request(
            method="POST",
            endpoint="/api/point/products",
            json_data={
                "action": "createProduct",
                "email": email.strip(),
                "password": password,
                "payload": payload
            },
            include_device_token=True
        )

    @handle_api_errors
    def update_product(
        self,
        email: str,
        password: str,
        product_id: str,
        payload: dict[str, Any]
    ) -> dict[str, Any]:
        """
        Обновление товара
        
        Args:
            email: Email администратора
            password: Пароль администратора
            product_id: ID товара
            payload: Новые данные товара
            
        Returns:
            Обновлённый товар
        """
        logger.info(f"Updating product {product_id}: {payload.get('name')}")
        
        return self._make_request(
            method="POST",
            endpoint="/api/point/products",
            json_data={
                "action": "updateProduct",
                "email": email.strip(),
                "password": password,
                "productId": product_id,
                "payload": payload
            },
            include_device_token=True
        )

    @handle_api_errors
    def delete_product(
        self,
        email: str,
        password: str,
        product_id: str
    ) -> dict[str, Any]:
        """
        Удаление товара
        
        Args:
            email: Email администратора
            password: Пароль администратора
            product_id: ID товара
            
        Returns:
            Ответ сервера
        """
        logger.info(f"Deleting product {product_id}")
        
        return self._make_request(
            method="POST",
            endpoint="/api/point/products",
            json_data={
                "action": "deleteProduct",
                "email": email.strip(),
                "password": password,
                "productId": product_id
            },
            include_device_token=True
        )

    @handle_api_errors
    def get_reports(self) -> dict[str, Any]:
        """
        Получение отчётов
        
        Returns:
            Отчёты по точке
        """
        logger.debug("Fetching reports")
        
        data = self._make_request(
            method="GET",
            endpoint="/api/point/reports",
            timeout=self.LONG_TIMEOUT
        )
        
        report_data = data.get("data", {})
        logger.debug(
            f"Reports retrieved: "
            f"warehouse={len(report_data.get('warehouse', []))}, "
            f"shifts={len(report_data.get('shifts', []))}"
        )
        
        return data

    @handle_api_errors
    def login_super_admin(self, email: str, password: str) -> dict[str, Any]:
        """
        Вход super-admin
        
        Args:
            email: Email администратора
            password: Пароль
            
        Returns:
            Данные администратора
        """
        logger.info(f"Super-admin login attempt: {email}")
        
        data = self._make_request(
            method="POST",
            endpoint="/api/point/admin-login",
            json_data={
                "email": email.strip(),
                "password": password
            },
            include_device_token=False  # Admin login не требует токена устройства
        )
        
        logger.info(f"Super-admin login successful: {email}")
        
        return data

    @handle_api_errors
    def list_admin_devices(self, email: str, password: str) -> dict[str, Any]:
        """
        Получение списка устройств для super-admin
        
        Args:
            email: Email администратора
            password: Пароль
            
        Returns:
            Список устройств
        """
        logger.info(f"Fetching devices for admin: {email}")
        
        data = self._make_request(
            method="POST",
            endpoint="/api/point/admin-devices",
            json_data={
                "email": email.strip(),
                "password": password
            },
            include_device_token=False
        )
        
        devices = data.get("data", {}).get("devices", [])
        logger.info(f"Retrieved {len(devices)} devices")
        
        return data

    # ==================== Вспомогательные методы ====================

    def check_connection(self) -> bool:
        """
        Проверка соединения с сервером
        
        Returns:
            True если соединение есть
        """
        try:
            self.bootstrap()
            return True
        except Exception as e:
            logger.warning(f"Connection check failed: {e}")
            return False

    def get_device_info(self) -> dict[str, Any]:
        """
        Получение информации об устройстве из bootstrap
        
        Returns:
            Информация об устройстве или пустой словарь
        """
        try:
            data = self.bootstrap()
            return data.get("device", {})
        except Exception:
            return {}

    def get_company_info(self) -> dict[str, Any]:
        """
        Получение информации о компании из bootstrap
        
        Returns:
            Информация о компании или пустой словарь
        """
        try:
            data = self.bootstrap()
            return data.get("company", {})
        except Exception:
            return {}