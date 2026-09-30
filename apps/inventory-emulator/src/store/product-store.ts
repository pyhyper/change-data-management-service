export interface Product {
  id: string;
  sku: string;
  name: string;
  quantity: number;
  price: number;
  updatedAt: string;
}

export class ProductStore {
  private products: Map<string, Product> = new Map();
  private simulateFailure: boolean = false;
  private simulateDelayMs: number = 0;

  public setSimulateFailure(value: boolean): void {
    this.simulateFailure = value;
  }

  public setSimulateDelay(ms: number): void {
    this.simulateDelayMs = ms;
  }

  public shouldFail(): boolean {
    return this.simulateFailure;
  }

  public getDelay(): number {
    return this.simulateDelayMs;
  }

  public clear(): void {
    this.products.clear();
  }

  public add(product: Product): void {
    this.products.set(product.id, { ...product });
  }

  public update(id: string, updates: Partial<Omit<Product, "id">>): Product | null {
    const existing = this.products.get(id);
    if (!existing) {
      return null;
    }

    const updated: Product = {
      ...existing,
      ...updates,
      updatedAt: updates.updatedAt || new Date().toISOString(),
    };

    this.products.set(id, updated);
    return updated;
  }

  public getById(id: string): Product | null {
    return this.products.get(id) || null;
  }

  public list(options: { updatedSince?: Date | null; limit?: number; offset?: number } = {}): Product[] {
    let all = Array.from(this.products.values());

    if (options.updatedSince) {
      const sinceTime = options.updatedSince.getTime();
      all = all.filter((p) => new Date(p.updatedAt).getTime() > sinceTime);
    }

    // Sort by updatedAt ascending
    all.sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());

    const offset = options.offset || 0;
    const limit = options.limit || 100;

    return all.slice(offset, offset + limit);
  }

  public count(): number {
    return this.products.size;
  }
}

export const productStore = new ProductStore();
