import { faker } from "@faker-js/faker";
import { Product, ProductStore } from "../store/product-store.js";

export function seedProducts(store: ProductStore, count: number = 50): Product[] {
  store.clear();
  const seeded: Product[] = [];
  const now = Date.now();

  for (let i = 1; i <= count; i++) {
    const paddedId = String(i).padStart(3, "0");
    // Spread updated time over the last few hours
    const updatedAt = new Date(now - (count - i) * 60000).toISOString();

    const product: Product = {
      id: `PROD-${paddedId}`,
      sku: `SKU-${faker.string.alphanumeric(6).toUpperCase()}`,
      name: faker.commerce.productName(),
      quantity: faker.number.int({ min: 1, max: 200 }),
      price: Number(faker.commerce.price({ min: 10000, max: 2000000, dec: 0 })),
      updatedAt,
    };

    store.add(product);
    seeded.push(product);
  }

  return seeded;
}
