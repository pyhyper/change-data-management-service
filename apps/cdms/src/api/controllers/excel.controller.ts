import { NextFunction, Request, Response } from "express";
import { BadRequestError } from "../../domain/errors/app.error.js";
import { NormalizedChange } from "../../domain/models/change.model.js";
import { ExcelRowSchema } from "../../domain/schemas/product.schema.js";
import { parseExcelBuffer } from "../../ingestion/excel/excel-parser.js";
import { computePayloadHash, normalizeProduct } from "../../processing/canonical/canonical.util.js";
import { computeBufferHash, deriveExcelIdempotencyKey } from "../../processing/canonical/idempotency.util.js";
import { ChangeProcessor } from "../../processing/pipeline/change.processor.js";
import { logger } from "../../utils/logger.js";

export interface ExcelImportSummary {
  file: string;
  rows: number;
  inserted: number;
  noChange: number;
  stale: number;
  duplicate: number;
  invalid: number;
  errors: Array<{ row: number; error: string }>;
}

export class ExcelController {
  private changeProcessor: ChangeProcessor;

  constructor(changeProcessor: ChangeProcessor) {
    this.changeProcessor = changeProcessor;
  }

  public handleExcelUpload = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.file) {
        throw new BadRequestError("No Excel file uploaded. Please send a multipart file with field name 'file'.");
      }

      const buffer = req.file.buffer;
      const originalName = req.file.originalname || "products.xlsx";
      const fileHash = computeBufferHash(buffer);

      const parsed = parseExcelBuffer(buffer);
      const rows = parsed.rows;

      const summary: ExcelImportSummary = {
        file: originalName,
        rows: rows.length,
        inserted: 0,
        noChange: 0,
        stale: 0,
        duplicate: 0,
        invalid: 0,
        errors: [],
      };

      // Controlled concurrency batch processing (10 rows per batch)
      const BATCH_SIZE = 10;
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);

        await Promise.all(
          batch.map(async (row, batchIdx) => {
            const rowNumber = i + batchIdx + 2; // 1-indexed, row 1 is header
            try {
              // 1. Validate raw Excel row
              const parsedRow = ExcelRowSchema.parse(row);

              // 2. Canonical normalize
              const normalizedPayload = normalizeProduct(parsedRow);
              const payloadHash = computePayloadHash(normalizedPayload);

              // 3. Derive Idempotency key
              const idempotencyKey = deriveExcelIdempotencyKey(
                fileHash,
                rowNumber,
                normalizedPayload.id,
                payloadHash
              );

              const change: NormalizedChange = {
                productId: normalizedPayload.id,
                source: "EXCEL",
                sourceUpdatedAt: new Date(normalizedPayload.updatedAt),
                payload: normalizedPayload,
                payloadHash,
                idempotencyKey,
              };

              // 4. Pass to shared pipeline
              const result = await this.changeProcessor.processChange(change);

              switch (result.status) {
                case "INSERTED":
                  summary.inserted++;
                  break;
                case "NO_CHANGE":
                  summary.noChange++;
                  break;
                case "STALE":
                  summary.stale++;
                  break;
                case "DUPLICATE_EVENT":
                  summary.duplicate++;
                  break;
              }
            } catch (rowErr) {
              summary.invalid++;
              summary.errors.push({
                row: rowNumber,
                error: rowErr instanceof Error ? rowErr.message : "Invalid row data",
              });
            }
          })
        );
      }

      logger.info("Excel import completed", {
        file: originalName,
        totalRows: summary.rows,
        inserted: summary.inserted,
        noChange: summary.noChange,
        stale: summary.stale,
        duplicate: summary.duplicate,
        invalid: summary.invalid,
      }, req.requestId);

      res.status(200).json(summary);
    } catch (err) {
      next(err);
    }
  };
}
