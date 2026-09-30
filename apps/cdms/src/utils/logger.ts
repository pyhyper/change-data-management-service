import { env } from "../config/env.config.js";

export type LogLevel = "ERROR" | "WARN" | "INFO" | "DEBUG";

const LOG_PRIORITIES: Record<LogLevel, number> = {
  ERROR: 4,
  WARN: 3,
  INFO: 2,
  DEBUG: 1,
};

export class Logger {
  private service: string;

  constructor(service: string = "cdms-api") {
    this.service = service;
  }

  private shouldLog(level: LogLevel): boolean {
    const configuredLevel = (env.LOG_LEVEL || "info").toUpperCase() as LogLevel;
    const currentPriority = LOG_PRIORITIES[level] || 2;
    const minPriority = LOG_PRIORITIES[configuredLevel] || 2;
    return currentPriority >= minPriority;
  }

  private print(level: LogLevel, message: string, context?: Record<string, unknown>, traceId?: string): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.service,
      traceId: traceId || undefined,
      message,
      context,
    };

    const serialized = JSON.stringify(logEntry);
    if (level === "ERROR") {
      process.stderr.write(serialized + "\n");
    } else {
      process.stdout.write(serialized + "\n");
    }
  }

  public info(message: string, context?: Record<string, unknown>, traceId?: string): void {
    this.print("INFO", message, context, traceId);
  }

  public warn(message: string, context?: Record<string, unknown>, traceId?: string): void {
    this.print("WARN", message, context, traceId);
  }

  public error(message: string, context?: Record<string, unknown>, traceId?: string): void {
    this.print("ERROR", message, context, traceId);
  }

  public debug(message: string, context?: Record<string, unknown>, traceId?: string): void {
    this.print("DEBUG", message, context, traceId);
  }
}

export const logger = new Logger("cdms-api");
