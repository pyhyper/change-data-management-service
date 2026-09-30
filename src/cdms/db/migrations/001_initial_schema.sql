-- 001_initial_schema.sql — CDMS Schema Definition

CREATE TABLE IF NOT EXISTS ingestion_events (
    id BIGSERIAL PRIMARY KEY,
    idempotency_key TEXT NOT NULL UNIQUE,
    source TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    error_message TEXT
);

CREATE TABLE IF NOT EXISTS product_changes (
    id BIGSERIAL PRIMARY KEY,
    product_id TEXT NOT NULL,
    source TEXT NOT NULL,
    source_updated_at TIMESTAMPTZ NOT NULL,
    payload JSONB NOT NULL,
    payload_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_product_payload
      UNIQUE (product_id, payload_hash)
);

CREATE INDEX IF NOT EXISTS idx_product_changes_latest
ON product_changes(product_id, source_updated_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS polling_checkpoints (
    source TEXT PRIMARY KEY,
    last_updated_at TIMESTAMPTZ,
    cursor TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
