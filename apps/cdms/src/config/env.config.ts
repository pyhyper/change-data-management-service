import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const EnvSchema = z.object({
  PORT: z.coerce.number().default(3000),
  INVENTORY_PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().optional(),
  USE_IN_MEMORY_DB: z.coerce.boolean().default(false),
  INVENTORY_BASE_URL: z.string().default("http://localhost:3001"),
  POLLING_ENABLED: z.coerce.boolean().default(true),
  POLLING_INTERVAL_MS: z.coerce.number().default(10000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["error", "warn", "info", "debug"]).default("info"),
});

export type EnvConfig = z.infer<typeof EnvSchema>;

export function loadEnvConfig(override?: Partial<EnvConfig>): EnvConfig {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const errorDetails = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join(", ");
    throw new Error(`Invalid environment configuration: ${errorDetails}`);
  }

  return {
    ...parsed.data,
    ...(override ?? {}),
  };
}

export const env = loadEnvConfig();
