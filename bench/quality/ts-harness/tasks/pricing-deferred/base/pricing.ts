import type { Amount, LineItem } from "./types";

export const PERCENT_BASE = 100;

/** Percentage carried by an amount; non-percent amounts contribute no rate. */
function pctOf(amount: Amount): number {
  return amount.kind === "percent" ? amount.pct : 0;
}

function adjustmentOf(base: number, amount: Amount): number {
  if (amount.kind === "fixed") {
    return amount.value;
  }
  return (base * pctOf(amount)) / PERCENT_BASE;
}

export function lineTotal(item: LineItem): number {
  return item.base + adjustmentOf(item.base, item.adjustment);
}

export function computeTotal(items: readonly LineItem[]): number {
  return items.reduce((sum: number, item: LineItem): number => sum + lineTotal(item), 0);
}
