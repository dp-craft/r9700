import type { Amount, LineItem } from "./types";
import { lineTotal } from "./pricing";

const KIND_LABEL: Partial<Record<Amount["kind"], string>> = {
  fixed: "flat",
  percent: "rate",
};
const UNKNOWN_LABEL = "other";

export function amountLabel(amount: Amount): string {
  return KIND_LABEL[amount.kind] ?? UNKNOWN_LABEL;
}

export function reportLine(item: LineItem): string {
  return `${item.id} [${amountLabel(item.adjustment)}]: ${String(lineTotal(item))}`;
}

export function buildReport(items: readonly LineItem[]): readonly string[] {
  return items.map((item: LineItem): string => reportLine(item));
}
