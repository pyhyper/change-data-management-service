import { Router } from "express";
import multer from "multer";
import { ChangeController } from "../controllers/change.controller.js";
import { ExcelController } from "../controllers/excel.controller.js";
import { WebhookController } from "../controllers/webhook.controller.js";

// Limit upload to 10MB memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

export function createRouter(
  webhookController: WebhookController,
  excelController: ExcelController,
  changeController: ChangeController
): Router {
  const router = Router();

  // Webhook ingestion
  router.post("/api/v1/webhooks/products", webhookController.handleWebhook);

  // Excel upload ingestion
  router.post(
    "/api/v1/imports/products/excel",
    upload.single("file"),
    excelController.handleExcelUpload
  );

  // Change queries
  router.get("/api/v1/changes", changeController.getChanges);
  router.get("/api/v1/products/:id/history", changeController.getProductHistory);

  // Health & readiness checks
  router.get("/health", changeController.getHealth);
  router.get("/ready", changeController.getReady);

  return router;
}
