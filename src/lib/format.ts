export const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

/** Compact money for headers, e.g. $11.1k. */
export const moneyShort = (n: number) =>
  Math.abs(n) >= 1000 ? `$${(n / 1000).toFixed(1)}k` : money(n);

export const pct = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}%`;
