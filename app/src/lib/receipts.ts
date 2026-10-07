"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

/**
 * What this browser remembers about a wallet's pledge. The program closes the pledge account
 * when it pays a refund, so afterwards the chain no longer says which seat a wallet held. This
 * note is what lets the page still say "you put in $10.00, you got back $12.50".
 */
export interface Receipt {
  /** Position in the queue, starting at zero. */
  index: number;
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
      const parsed = JSON.parse(raw) as Receipt;
      return Number.isInteger(parsed.index) && parsed.index >= 0 ? { index: parsed.index } : null;
    } catch {
      return null;
    }
  }, [raw]);
}
