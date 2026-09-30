import logging
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
import uvicorn
from .api.router import create_api_router
from .config import settings
from .db import get_database_client, PostgresDatabaseClient
from .domain.exceptions import AppException
from .ingestion.polling import InventoryClient, PollingScheduler
from .processing.pipeline import ChangeProcessor
from .repositories.change_repo import ChangeRepository
from .repositories.checkpoint_repo import CheckpointRepository
from .repositories.idempotency_repo import IdempotencyRepository

logging.basicConfig(level=settings.log_level, format="%(message)s")
logger = logging.getLogger("cdms-api")

def create_app(custom_db=None) -> FastAPI:
    db = custom_db or get_database_client()
    idempotency_repo = IdempotencyRepository(db)
    change_repo = ChangeRepository(db)
    checkpoint_repo = CheckpointRepository(db)
    change_processor = ChangeProcessor(db, idempotency_repo, change_repo)

    inventory_client = InventoryClient(settings.inventory_base_url)
    scheduler = PollingScheduler(
        db,
        inventory_client,
        change_processor,
        checkpoint_repo,
        interval_seconds=settings.polling_interval_seconds
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if isinstance(db, PostgresDatabaseClient):
            await db.connect()
            await db.init_migrations()
        if settings.polling_enabled and settings.node_env != "test":
            scheduler.start()
        yield
        scheduler.stop()
        await db.close()

    app = FastAPI(title="Change Data Management Service (CDMS)", lifespan=lifespan)

    # Attach context to state
    app.state.db = db
    app.state.change_processor = change_processor
    app.state.change_repo = change_repo
    app.state.scheduler = scheduler

    @app.exception_handler(AppException)
    async def app_exception_handler(request: Request, exc: AppException):
        req_id = request.headers.get("X-Request-Id", f"req-{uuid.uuid4().hex[:8]}")
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "success": False,
                "error": {
                    "code": exc.code,
                    "message": exc.message,
                    "details": exc.details,
                    "requestId": req_id,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                },
            },
        )

    router = create_api_router(change_processor, change_repo, db)
    app.include_router(router)

    return app

app = create_app()

if __name__ == "__main__":
    uvicorn.run("src.cdms.main:app", host="0.0.0.0", port=settings.port, reload=False)
