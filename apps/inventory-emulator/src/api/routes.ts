import { Router } from "express";
import { seedProducts } from "../seed/faker-seed.js";
import { ProductStore } from "../store/product-store.js";

export function createEmulatorRouter(store: ProductStore): Router {
  const router = Router();

  // Failure simulation middleware
  router.use(async (_req, res, next) => {
    if (store.getDelay() > 0) {
      await new Promise((resolve) => setTimeout(resolve, store.getDelay()));
    }

    if (store.shouldFail() && !_req.path.includes("/simulate")) {
      res.status(503).json({
        error: "SIMULATED_SERVICE_UNAVAILABLE",
        message: "Inventory service simulated downtime failure",
      });
      return;
    }

    next();
  });

  // Query products
  router.get("/api/v1/products", (req, res) => {
    const updatedSinceParam = req.query.updatedSince as string | undefined;
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const offset = req.query.offset ? Number(req.query.offset) : 0;

    let updatedSince: Date | null = null;
    if (updatedSinceParam) {
      const parsed = new Date(updatedSinceParam);
      if (!isNaN(parsed.getTime())) {
        updatedSince = parsed;
      }
    }

    const products = store.list({ updatedSince, limit, offset });
    res.status(200).json({
      total: products.length,
      storeSize: store.count(),
      products,
    });
  });

  // Get product by id
  router.get("/api/v1/products/:id", (req, res) => {
    const product = store.getById(req.params.id);
    if (!product) {
      res.status(404).json({ error: "Product not found" });
      return;
    }
    res.status(200).json(product);
  });

  // Create product
  router.post("/api/v1/products", (req, res) => {
    const { id, sku, name, quantity, price, updatedAt } = req.body;
    if (!id) {
      res.status(400).json({ error: "Product id is required" });
      return;
    }

    const newProduct = {
      id: String(id).trim(),
      sku: sku ? String(sku).trim() : `SKU-${Date.now()}`,
      name: name ? String(name).trim() : "Sample Product",
      quantity: quantity !== undefined ? Number(quantity) : 0,
      price: price !== undefined ? Number(price) : 0,
      updatedAt: updatedAt ? new Date(updatedAt).toISOString() : new Date().toISOString(),
    };

    store.add(newProduct);
    res.status(201).json(newProduct);
  });

  // Update product (simulating inventory state change)
  router.patch("/api/v1/products/:id", (req, res) => {
    const updated = store.update(req.params.id, req.body);
    if (!updated) {
      res.status(404).json({ error: "Product not found" });
      return;
    }
    res.status(200).json(updated);
  });

  // Reseed data
  router.post("/api/v1/seed", (req, res) => {
    const count = req.body.count ? Number(req.body.count) : 50;
    const seeded = seedProducts(store, count);
    res.status(200).json({
      message: `Successfully seeded ${seeded.length} products`,
      count: seeded.length,
    });
  });

  // Configure failure injection for testing
  router.post("/api/v1/simulate/error", (req, res) => {
    const { fail, delayMs } = req.body;
    if (fail !== undefined) {
      store.setSimulateFailure(Boolean(fail));
    }
    if (delayMs !== undefined) {
      store.setSimulateDelay(Number(delayMs));
    }
    res.status(200).json({
      simulatedFailure: store.shouldFail(),
      simulatedDelayMs: store.getDelay(),
    });
  });

  // Health check
  router.get("/health", (_req, res) => {
    res.status(200).json({
      status: "UP",
      service: "inventory-emulator",
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}
