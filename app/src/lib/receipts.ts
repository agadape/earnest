"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

/**
 * What this browser remembers about a wallet's seat. The program closes the pledge account when
 * it pays a refund or when the seat is sold, so afterwards the chain no longer says which seat a
 * wallet held or why it stopped holding it. This note is what lets the page still say "you put
 * in $10.00, you got back $12.50", and keeps it from saying that to someone who sold their seat.
 */
export interface Receipt {
  /** Position in the queue, starting at zero. */
  index: number;
  /** What this wallet paid another backer for the seat, in base units, if it bought it. */
  boughtFor?: string;
  /** What the holder is offering the seat for, in base units, while that offer stands. */
  offeredFor?: string;
  /** What the seat was sold for, in base units. From then on it is someone else's. */
  soldFor?: string;
}

const listeners = new Set<() => void>();
const storageKey = (campaign: string, wallet: string) => `tanda-jadi:pledge:${campaign}:${wallet}`;

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Replaces what is remembered for this wallet's seat in this campaign. */
export function rememberPledge(campaign: string, wallet: string, receipt: Receipt) {
  const key = storageKey(campaign, wallet);
  const raw = JSON.stringify(receipt);
  if (readRaw(key) === raw) return;
  try {
    localStorage.setItem(key, raw);
  } catch {
    // Private windows may refuse. The page then simply forgets after a refund.
    return;
  }
  listeners.forEach((listener) => listener());
}

const amount = (value: unknown) =>
  typeof value === "string" && /^\d+$/.test(value) ? value : undefined;

export function useReceipt(campaign: string, wallet: string | null): Receipt | null {
  const key = wallet ? storageKey(campaign, wallet) : null;
  const raw = useSyncExternalStore(
    subscribe,
    useCallback(() => (key ? readRaw(key) : null), [key]),
    () => null,
  );
  return useMemo(() => {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<Receipt>;
      if (typeof parsed.index !== "number" || !Number.isInteger(parsed.index) || parsed.index < 0) {
        return null;
      }
      return {
        index: parsed.index,
        boughtFor: amount(parsed.boughtFor),
        offeredFor: amount(parsed.offeredFor),
        soldFor: amount(parsed.soldFor),
      };
    } catch {
      return null;
    }
  }, [raw]);
}
