import json
import os
from datetime import datetime
from typing import Any
import asyncpg

class PostgresDatabaseClient:
    def __init__(self, dsn: str):
        self.dsn = dsn
        self.pool: asyncpg.Pool | None = None

    async def connect(self) -> None:
        if self.pool is None:
            self.pool = await asyncpg.create_pool(dsn=self.dsn, min_size=2, max_size=20)

    async def close(self) -> None:
        if self.pool is not None:
            await self.pool.close()
            self.pool = None

    async def is_healthy(self) -> bool:
        if self.pool is None:
            return False
        try:
            val = await self.pool.fetchval("SELECT 1")
            return val == 1
        except Exception:
            return False

    async def init_migrations(self) -> None:
        if self.pool is None:
            await self.connect()
        assert self.pool is not None
        
        migration_path = os.path.join(os.path.dirname(__file__), "migrations", "001_initial_schema.sql")
        if os.path.exists(migration_path):
            with open(migration_path, "r", encoding="utf-8") as f:
                sql = f.read()
            async with self.pool.acquire() as conn:
                await conn.execute(sql)

    async def get_product_lock(self, product_id: str):
        # In asyncpg, advisory lock is called inside transaction
        return None

    async def insert_event_if_absent(
        self,
        idempotency_key: str,
        source: str,
        payload_hash: str,
        status: str = "PROCESSING"
    ) -> bool:
        assert self.pool is not None
        sql = """
            INSERT INTO ingestion_events (idempotency_key, source, payload_hash, status)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (idempotency_key) DO NOTHING
            RETURNING id
        """
        row = await self.pool.fetchrow(sql, idempotency_key, source, payload_hash, status)
        return row is not None

    async def mark_event_processed(
        self,
        idempotency_key: str,
        status: str,
        error_message: str | None = None
    ) -> None:
        assert self.pool is not None
        sql = """
            UPDATE ingestion_events
            SET status = $1, processed_at = NOW(), error_message = $2
            WHERE idempotency_key = $3
        """
        await self.pool.execute(sql, status, error_message, idempotency_key)

    async def get_latest_product_change(self, product_id: str) -> dict[str, Any] | None:
        assert self.pool is not None
        sql = """
            SELECT id, product_id, source, source_updated_at, payload, payload_hash, created_at
            FROM product_changes
            WHERE product_id = $1
            ORDER BY source_updated_at DESC, id DESC
            LIMIT 1
        """
        row = await self.pool.fetchrow(sql, product_id)
        if not row:
            return None
        payload = json.loads(row["payload"]) if isinstance(row["payload"], str) else row["payload"]
        return {
            "id": row["id"],
            "product_id": row["product_id"],
            "source": row["source"],
            "source_updated_at": row["source_updated_at"],
            "payload": payload,
            "payload_hash": row["payload_hash"],
            "created_at": row["created_at"],
        }

    async def insert_product_change(
        self,
        product_id: str,
        source: str,
        source_updated_at: datetime,
        payload: dict[str, Any],
        payload_hash: str
    ) -> bool:
        assert self.pool is not None
        sql = """
            INSERT INTO product_changes (product_id, source, source_updated_at, payload, payload_hash)
            VALUES ($1, $2, $3, $4::jsonb, $5)
            ON CONFLICT (product_id, payload_hash) DO NOTHING
            RETURNING id
        """
        row = await self.pool.fetchrow(
            sql,
            product_id,
            source,
            source_updated_at,
            json.dumps(payload),
            payload_hash
        )
        return row is not None

    async def list_product_changes(self, product_id: str | None = None) -> list[dict[str, Any]]:
        assert self.pool is not None
        if product_id:
            sql = """
                SELECT id, product_id, source, source_updated_at, payload, payload_hash, created_at
                FROM product_changes
                WHERE product_id = $1
                ORDER BY source_updated_at DESC, id DESC
            """
            rows = await self.pool.fetch(sql, product_id)
        else:
            sql = """
                SELECT id, product_id, source, source_updated_at, payload, payload_hash, created_at
                FROM product_changes
                ORDER BY source_updated_at DESC, id DESC
            """
            rows = await self.pool.fetch(sql)

        result = []
        for r in rows:
            payload = json.loads(r["payload"]) if isinstance(r["payload"], str) else r["payload"]
            result.append({
                "id": r["id"],
                "product_id": r["product_id"],
                "source": r["source"],
                "source_updated_at": r["source_updated_at"],
                "payload": payload,
                "payload_hash": r["payload_hash"],
                "created_at": r["created_at"],
            })
        return result

    async def get_checkpoint(self, source: str) -> dict[str, Any] | None:
        assert self.pool is not None
        sql = "SELECT source, last_updated_at, cursor, updated_at FROM polling_checkpoints WHERE source = $1"
        row = await self.pool.fetchrow(sql, source)
        if not row:
            return None
        return {
            "source": row["source"],
            "last_updated_at": row["last_updated_at"],
            "cursor": row["cursor"],
            "updated_at": row["updated_at"],
        }

    async def save_checkpoint(
        self,
        source: str,
        last_updated_at: datetime | None,
        cursor: str | None = None
    ) -> None:
        assert self.pool is not None
        sql = """
            INSERT INTO polling_checkpoints (source, last_updated_at, cursor, updated_at)
            VALUES ($1, $2, $3, NOW())
            ON CONFLICT (source) DO UPDATE
            SET last_updated_at = EXCLUDED.last_updated_at,
                cursor = EXCLUDED.cursor,
                updated_at = NOW()
        """
        await self.pool.execute(sql, source, last_updated_at, cursor)
