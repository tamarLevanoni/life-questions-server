class SimpleCache {
  private store = new Map<string, unknown>();

  get<T>(key: string): T | null {
    return this.store.has(key) ? (this.store.get(key) as T) : null;
  }

  set<T>(key: string, value: T): void {
    this.store.set(key, value);
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

export const cache = new SimpleCache();
