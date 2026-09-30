import { ExternalServiceError } from "../../domain/errors/app.error.js";
import { logger } from "../../utils/logger.js";

export interface InventoryProductResponse {
  id: string;
  sku?: string;
  name?: string;
  quantity?: number;
  price?: number;
  updatedAt: string;
}

export interface InventoryFetchOptions {
  updatedSince?: Date | null;
  limit?: number;
}

export class InventoryClient {
  private baseUrl: string;
  private timeoutMs: number;
  private maxRetries: number;

  constructor(baseUrl: string, timeoutMs: number = 5000, maxRetries: number = 3) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  public async fetchChangedProducts(options: InventoryFetchOptions = {}): Promise<InventoryProductResponse[]> {
    const url = new URL(`${this.baseUrl}/api/v1/products`);
    if (options.updatedSince) {
      url.searchParams.set("updatedSince", options.updatedSince.toISOString());
    }
    if (options.limit) {
      url.searchParams.set("limit", String(options.limit));
    }

    let attempt = 0;
    let delay = 250;

    while (attempt <= this.maxRetries) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);

        const response = await fetch(url.toString(), {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (!response.ok) {
          throw new Error(`Inventory service returned HTTP ${response.status}: ${response.statusText}`);
        }

        const data = (await response.json()) as { products?: InventoryProductResponse[] } | InventoryProductResponse[];
        if (Array.isArray(data)) {
          return data;
        }
        return data.products || [];
      } catch (err) {
        attempt++;
        if (attempt > this.maxRetries) {
          logger.error("Failed to query Inventory Service after retries", {
            url: url.toString(),
            attempts: attempt,
            error: err instanceof Error ? err.message : String(err),
          });
          throw new ExternalServiceError(
            `Unable to connect to Inventory Service: ${err instanceof Error ? err.message : String(err)}`
          );
        }

        // Exponential backoff with jitter
        const jitter = Math.random() * 100;
        const sleepTime = delay + jitter;
        logger.warn("Inventory fetch failed, retrying...", {
          attempt,
          sleepTimeMs: Math.round(sleepTime),
          error: err instanceof Error ? err.message : String(err),
        });

        await this.sleep(sleepTime);
        delay *= 2;
      }
    }

    return [];
  }
}
