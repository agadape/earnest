"use client";

import { useConnection } from "@solana/wallet-adapter-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { judgeClaims, type Notes, type Plot, type ReactionCounts, readNotes, signersOf } from "@/lib/ledger";
import { PLOTS } from "@/lib/museum/plan";
import type { Campaign } from "@/lib/tanda-jadi";

// Reactions and rooms change far less often than seats do, and reading them is a heavier question.
const EVERY_MS = 12_000;
const NO_PLOTS: ReadonlyMap<string, Plot> = new Map();
const NO_REACTIONS: ReadonlyMap<string, ReactionCounts> = new Map();

/**
 * The notes kept on chain beside the campaigns: how often each was reacted to, and which annex
 * plot each creator built on. Read now, every twelve seconds, and whenever `reload` is called.
 * A network that does not answer leaves the last good reading in place.
 */
export function useNotes(campaigns: Campaign[] | undefined): {
  reactions: ReadonlyMap<string, ReactionCounts>;
  plots: ReadonlyMap<string, Plot>;
  reload(): void;
} {
  const { connection } = useConnection();
  const [read, setRead] = useState<{ notes: Notes; signed: Map<string, string[]> } | null>(null);
  const [turn, setTurn] = useState(0);
  const reload = useCallback(() => setTurn((count) => count + 1), []);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      try {
        const notes = await readNotes(connection);
        // A claim only counts if the campaign's creator signed it, so each one is looked up.
        const signed = new Map<string, string[]>();
        for (const claim of notes.claims) {
          try {
            signed.set(claim.signature, await signersOf(connection, claim.signature));
          } catch {
            // Not judged this time round; the next reading asks again.
          }
        }
        if (active) setRead({ notes, signed });
      } catch {
        // Keep what was read before.
      }
      if (active) timer = setTimeout(run, EVERY_MS);
    };
    run();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [connection, turn]);

  const plots = useMemo(() => {
    if (!read || !campaigns) return NO_PLOTS;
    const creators = new Map(
      campaigns.map((campaign) => [campaign.address.toBase58(), campaign.creator.toBase58()]),
    );
    return judgeClaims(
      read.notes.claims,
      (campaign) => creators.get(campaign),
      (signature) => read.signed.get(signature),
      PLOTS.length,
    );
  }, [read, campaigns]);

  return { reactions: read?.notes.reactions ?? NO_REACTIONS, plots, reload };
}
