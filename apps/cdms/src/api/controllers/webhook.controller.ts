import { NextFunction, Request, Response } from "express";
import { NormalizedChange } from "../../domain/models/change.model.js";
import { computePayloadHash, normalizeProduct } from "../../processing/canonical/canonical.util.js";
import { deriveWebhookIdempotencyKey } from "../../processing/canonical/idempotency.util.js";
import { ChangeProcessor } from "../../processing/pipeline/change.processor.js";
import { logger } from "../../utils/logger.js";

export class WebhookController {
  private changeProcessor: ChangeProcessor;

  constructor(changeProcessor: ChangeProcessor) {
    this.changeProcessor = changeProcessor;
  }

  public handleWebhook = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const rawInput = req.body;
      const normalizedPayload = normalizeProduct(rawInput);
      const payloadHash = computePayloadHash(normalizedPayload);

      const clientKey = req.headers["idempotency-key"] as string | undefined;
      const idempotencyKey = deriveWebhookIdempotencyKey(
        normalizedPayload.id,
        normalizedPayload.updatedAt,
        payloadHash,
        clientKey
      );

      const change: NormalizedChange = {
        productId: normalizedPayload.id,
        source: "WEBHOOK",
        sourceUpdatedAt: new Date(normalizedPayload.updatedAt),
        payload: normalizedPayload,
        payloadHash,
        idempotencyKey,
      };

      const result = await this.changeProcessor.processChange(change);

      logger.info("Webhook processed", {
        productId: result.productId,
        status: result.status,
        idempotencyKey,
      }, req.requestId);

      res.status(200).json({
        requestId: req.requestId,
        status: result.status,
        productId: result.productId,
        idempotencyKey: result.idempotencyKey,
        message: result.message,
      });
    } catch (err) {
      next(err);
    }
  };
}
