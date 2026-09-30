import os
from dataclasses import dataclass
from dotenv import load_dotenv

load_dotenv()

@dataclass(frozen=True)
class Settings:
    port: int = int(os.getenv("PORT", "3000"))
    inventory_port: int = int(os.getenv("INVENTORY_PORT", "3001"))
    database_url: str | None = os.getenv("DATABASE_URL")
    use_in_memory_db: bool = os.getenv("USE_IN_MEMORY_DB", "false").lower() in ("true", "1")
    inventory_base_url: str = os.getenv("INVENTORY_BASE_URL", "http://localhost:3001")
    polling_enabled: bool = os.getenv("POLLING_ENABLED", "true").lower() in ("true", "1")
    polling_interval_seconds: float = float(os.getenv("POLLING_INTERVAL_SECONDS", "10.0"))
    log_level: str = os.getenv("LOG_LEVEL", "INFO")
    node_env: str = os.getenv("NODE_ENV", "development")

settings = Settings()
