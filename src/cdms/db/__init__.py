from ..config import settings
from .memory_db import MemoryDatabaseClient
from .postgres_db import PostgresDatabaseClient

_db_instance = None

def get_database_client():
    global _db_instance
    if _db_instance is None:
        if settings.use_in_memory_db or not settings.database_url:
            _db_instance = MemoryDatabaseClient()
        else:
            _db_instance = PostgresDatabaseClient(settings.database_url)
    return _db_instance

def set_database_client(instance):
    global _db_instance
    _db_instance = instance
