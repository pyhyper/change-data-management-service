import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "../../domain/errors/app.error.js";
import { logger } from "../../utils/logger.js";

export function errorHandlerMiddleware(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const requestId = req.requestId || "unknown";
  const timestamp = new Date().toISOString();

  if (err instanceof ZodError) {
    const details = err.issues.map((issue) => ({
      field: issue.path.join("."),
      issue: issue.message,
    }));

    res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_FAILED",
        message: "Invalid request payload format",
        details,
        requestId,
        timestamp,
      },
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
        requestId,
        timestamp,
      },
    });
    return;
  }

  // Handle express json parsing error
  if (err instanceof SyntaxError && "body" in err) {
    res.status(400).json({
      success: false,
      error: {
        code: "INVALID_JSON",
        message: "Malformed JSON request body",
        requestId,
        timestamp,
      },
    });
    return;
  }

  const errorMessage = err instanceof Error ? err.message : "Internal Server Error";
  logger.error("Unhandled exception caught by error middleware", {
    error: errorMessage,
    stack: err instanceof Error ? err.stack : undefined,
  }, requestId);

  res.status(500).json({
    success: false,
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred while processing the request",
      requestId,
      timestamp,
    },
  });
}
