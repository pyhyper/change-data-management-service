import { randomUUID } from "node:crypto";
import { NextFunction, Request, Response } from "express";
import { logger } from "../../utils/logger.js";

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

export function requestLoggerMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = (req.headers["x-request-id"] as string) || `req-${randomUUID().substring(0, 8)}`;
  req.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);

  const startTime = Date.now();

  res.on("finish", () => {
    const durationMs = Date.now() - startTime;
    logger.info("HTTP Request handled", {
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      durationMs,
    }, requestId);
  });

  next();
}
