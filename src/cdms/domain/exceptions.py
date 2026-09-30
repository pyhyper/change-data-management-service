from typing import Any

class AppException(Exception):
    def __init__(self, message: str, status_code: int = 500, code: str = "INTERNAL_ERROR", details: Any = None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code
        self.details = details

class BadRequestException(AppException):
    def __init__(self, message: str, details: Any = None):
        super().__init__(message, status_code=400, code="BAD_REQUEST", details=details)

class ValidationException(AppException):
    def __init__(self, message: str, details: Any = None):
        super().__init__(message, status_code=422, code="VALIDATION_FAILED", details=details)

class ConflictException(AppException):
    def __init__(self, message: str, details: Any = None):
        super().__init__(message, status_code=409, code="CONFLICT", details=details)

class ExternalServiceException(AppException):
    def __init__(self, message: str, details: Any = None):
        super().__init__(message, status_code=502, code="EXTERNAL_SERVICE_ERROR", details=details)
