"use client";

import type { PublicKey } from "@solana/web3.js";
import { useEffect, useState } from "react";

import { useRefresh } from "@/lib/chain";

export type AutoSettleState = "idle" | "sending" | "done" | "unavailable" | "failed";

/** Between asks for the same campaign, also across pages that showed it. */
const ASK_AGAIN_MS = 8_000;
/** How often to ask while the page still sees money owed and the server sends nothing. */
const MAX_ROUNDS = 5;

const lastAsked = new Map<string, number>();

/**
 * Asks the server to send what `campaign` owes, as soon as `wanted` is true, and keeps asking
 * while the server reports more to do. The money arriving is shown by the page's usual polling;
 * this only triggers the sending.
 *
 * "unavailable" means this server holds no key for it, "failed" that it tried and could not.
 * Both are the cue to show the manual buttons instead.
 */
export function useAutoSettle(campaign: PublicKey, wanted: boolean): AutoSettleState {
  const refresh = useRefresh();
  const address = campaign.toBase58();
  const [state, setState] = useState<AutoSettleState>("idle");

  useEffect(() => {
    if (!wanted) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rounds = 0;

    const later = (ms: number) => {
      timer = setTimeout(ask, ms);
    };
    const ask = async () => {
      const since = Date.now() - (lastAsked.get(address) ?? 0);
      if (since < ASK_AGAIN_MS) return later(ASK_AGAIN_MS - since);
      lastAsked.set(address, Date.now());
      rounds += 1;
      setState("sending");
      try {
        const response = await fetch("/api/settle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ campaign: address }),
        });
        if (!active) return;
        if (response.status === 503) return setState("unavailable");
        // Someone else's page is handling this campaign right now.
        if (response.status === 429) return later(ASK_AGAIN_MS);
        if (!response.ok) throw new Error(`settle: ${response.status}`);

        const { sent, remaining } = (await response.json()) as { sent: number; remaining: number };
        if (sent > 0) refresh();
        if (remaining > 0) return later(500);
        // Nothing was owed by the server's clock, which can trail this page's by a few seconds.
        if (sent === 0 && rounds < MAX_ROUNDS) return later(ASK_AGAIN_MS);
        setState(sent > 0 ? "done" : "failed");
      } catch {
        if (active) setState("failed");
      }
    };
    ask();

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [address, wanted, refresh]);

  return state;
}
