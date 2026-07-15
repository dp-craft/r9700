export type Amount =
  | { readonly kind: "fixed"; readonly value: number }
  | { readonly kind: "percent"; readonly pct: number };

export interface LineItem {
  readonly id: string;
  readonly base: number;
  readonly adjustment: Amount;
}
