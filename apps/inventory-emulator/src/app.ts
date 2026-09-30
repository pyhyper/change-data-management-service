import http from "node:http";
import express, { Express } from "express";
import { createEmulatorRouter } from "./api/routes.js";
import { seedProducts } from "./seed/faker-seed.js";
import { ProductStore, productStore } from "./store/product-store.js";

export function createEmulatorApp(customStore?: ProductStore): { app: Express; store: ProductStore } {
  const app = express();
  const store = customStore || productStore;

  app.use(express.json());
  app.use(createEmulatorRouter(store));

  return { app, store };
}

async function startServer(): Promise<void> {
  const { app, store } = createEmulatorApp();

  // Seed default 50 products on start
  seedProducts(store, 50);

  const port = process.env.INVENTORY_PORT ? Number(process.env.INVENTORY_PORT) : 3001;
  const server = http.createServer(app);

  server.listen(port, () => {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "INFO",
      service: "inventory-emulator",
      message: `Inventory Emulator is running on http://localhost:${port}`,
      seededProducts: store.count(),
    }));
  });

  const shutdown = () => {
    server.close(() => {
      console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "INFO",
        service: "inventory-emulator",
        message: "Inventory Emulator stopped cleanly.",
      }));
      process.exit(0);
    });
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

const isMain = process.argv[1] && (
  process.argv[1].endsWith("app.ts") ||
  process.argv[1].endsWith("app.js")
);

if (isMain) {
  startServer().catch((err) => {
    console.error("Failed to start Inventory Emulator:", err);
    process.exit(1);
  });
}
