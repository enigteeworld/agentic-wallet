type CooldownMap = Map<string, string>;

export class CooldownManager {
  constructor(private readonly store: CooldownMap = new Map()) {}

  isCooldownActive(pair: string, now: Date, cooldownMinutes: number): boolean {
    const last = this.store.get(pair);
    if (!last) return false;

    const diffMs = now.getTime() - new Date(last).getTime();
    return diffMs < cooldownMinutes * 60 * 1000;
  }

  recordTrade(pair: string, now: Date): void {
    this.store.set(pair, now.toISOString());
  }
}

export const cooldownManager = new CooldownManager();