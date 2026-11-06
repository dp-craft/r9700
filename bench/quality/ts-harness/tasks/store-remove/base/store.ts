export interface Entry {
  readonly key: string;
  readonly amount: number;
}

export interface Store {
  add(entry: Entry): void;
  total(key: string): number;
  all(): readonly Entry[];
}

class StoreImpl implements Store {
  private readonly entries: Entry[] = [];
  private readonly totals = new Map<string, number>();

  add(entry: Entry): void {
    this.entries.push(entry);
    this.totals.set(entry.key, (this.totals.get(entry.key) ?? 0) + entry.amount);
  }

  total(key: string): number {
    return this.totals.get(key) ?? 0;
  }

  all(): readonly Entry[] {
    return this.entries;
  }
}

export function createStore(): Store {
  return new StoreImpl();
}
