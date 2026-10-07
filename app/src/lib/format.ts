import type { PublicKey } from "@solana/web3.js";

import { formatTokens } from "@/lib/tanda-jadi";

const CENT = 10_000n;

/** `12509999n` → `"$12.50"`. Always two decimals, rounded down, so the UI never overstates. */
export function usd(amount: bigint): string {
  return `$${formatTokens(amount - (amount % CENT))}`;
}

export function shortAddress(address: PublicKey | string): string {
  const text = typeof address === "string" ? address : address.toBase58();
  return `${text.slice(0, 4)}…${text.slice(-4)}`;
}

const UNITS = [
  { size: 86_400, one: "day", many: "days" },
  { size: 3_600, one: "hour", many: "hours" },
  { size: 60, one: "min", many: "min" },
  { size: 1, one: "s", many: "s" },
];

/** `93_784` → `"1 day 2 hours"`. Two units at most, so a countdown stays short. */
export function formatDuration(seconds: number): string {
  let rest = Math.max(0, Math.floor(seconds));
  const parts: string[] = [];
  for (const { size, one, many } of UNITS) {
    const count = Math.floor(rest / size);
    rest -= count * size;
    if (count > 0) parts.push(`${count} ${count === 1 ? one : many}`);
    // Stop one unit after the first that counted, also when that next unit is zero.
    if (parts.length === 2 || (parts.length === 1 && count === 0)) break;
  }
  return parts.length > 0 ? parts.join(" ") : "0 s";
}

const DATE_TIME = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "medium" });

export function formatDate(unixSeconds: number): string {
  return DATE_TIME.format(unixSeconds * 1000);
}

/** `2000` → `"20%"`, `250` → `"2.5%"`. */
export function formatPercent(bps: number): string {
  return `${bps / 100}%`;
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** `"the first 2 backers"`, or `"the first backer"` when there is only one. */
export function firstFew(count: number, one: string, many = `${one}s`): string {
  return count === 1 ? `the first ${one}` : `the first ${count} ${many}`;
}
