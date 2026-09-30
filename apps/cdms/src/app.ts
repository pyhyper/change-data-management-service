import http from "node:http";
import express, { Express } from "express";
import { ChangeController } from "./api/controllers/change.controller.js";
import { ExcelController } from "./api/controllers/excel.controller.js";
import { WebhookController } from "./api/controllers/webhook.controller.js";
import { errorHandlerMiddleware } from "./api/middlewares/error-handler.middleware.js";
import { requestLoggerMiddleware } from "./api/middlewares/request-logger.middleware.js";
import { createRouter } from "./api/routes/index.js";
import { env } from "./config/env.config.js";
import { createDatabaseClient, DatabaseClient, PostgresDatabaseClient } from "./db/index.js";
import { InventoryClient } from "./ingestion/polling/inventory-client.js";
import { PollingScheduler } from "./ingestion/polling/polling-scheduler.js";
import { ChangeDetector } from "./processing/detector/change-detector.js";
import { ChangeProcessor } from "./processing/pipeline/change.processor.js";
import { ChangeRepository } from "./repositories/change.repository.js";
import { CheckpointRepository } from "./repositories/checkpoint.repository.js";
import { IdempotencyRepository } from "./repositories/idempotency.repository.js";
import { logger } from "./utils/logger.js";

export interface AppContext {
  app: Express;
  db: DatabaseClient;
  changeProcessor: ChangeProcessor;
  pollingScheduler: PollingScheduler;
}

export function createApp(customDb?: DatabaseClient): AppContext {
  const app = express();
  const db = customDb || createDatabaseClient();

  const idempotencyRepo = new IdempotencyRepository();
  const changeRepo = new ChangeRepository();
  const checkpointRepo = new CheckpointRepository();
  const detector = new ChangeDetector();

  const changeProcessor = new ChangeProcessor(db, idempotencyRepo, changeRepo, detector);
  const inventoryClient = new InventoryClient(env.INVENTORY_BASE_URL);
  const pollingScheduler = new PollingScheduler(
    db,
    inventoryClient,
    changeProcessor,
    checkpointRepo,
    env.POLLING_INTERVAL_MS
  );

  const webhookController = new WebhookController(changeProcessor);
  const excelController = new ExcelController(changeProcessor);
  const changeController = new ChangeController(db, changeRepo);

  // Middlewares
  app.use(express.json());
  app.use(requestLoggerMiddleware);

  // Routes
  const router = createRouter(webhookController, excelController, changeController);
  app.use(router);

  // Error Handler
  app.use(errorHandlerMiddleware);

  return {
    app,
    db,
    changeProcessor,
    pollingScheduler,
  };
}

async function startServer(): Promise<void> {
  const { app, db, pollingScheduler } = createApp();

  if (db instanceof PostgresDatabaseClient) {
    try {
      await db.initMigrations();
      logger.info("Database migrations executed successfully.");
    } catch (err) {
      logger.error("Failed to run migrations on PostgreSQL startup", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const port = env.PORT || 3000;
  const server = http.createServer(app);

  server.listen(port, () => {
    logger.info(`CDMS Service is running on http://localhost:${port}`, {
      port,
      nodeEnv: env.NODE_ENV,
      pollingEnabled: env.POLLING_ENABLED,
    });

    if (env.POLLING_ENABLED && env.NODE_ENV !== "test") {
      pollingScheduler.start();
    }
  });

  const shutdown = async () => {
    logger.info("Gracefully shutting down CDMS Service...");
    pollingScheduler.stop();
    server.close(async () => {
      await db.close();
      logger.info("CDMS Service stopped cleanly.");
      process.exit(0);
    });
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

// Start if invoked directly
const isMain = process.argv[1] && (
  process.argv[1].endsWith("app.ts") ||
  process.argv[1].endsWith("app.js")
);

if (isMain) {
  startServer().catch((err) => {
    logger.error("Failed to start CDMS server", {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  });
}
