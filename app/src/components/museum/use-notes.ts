"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { judgeClaims, judgeLooks, type Notes, type Plot, type ReactionCounts, readNotes, signersOf } from "@/lib/ledger";
import { type Look, PLOTS } from "@/lib/museum/plan";
import type { ReactionsAnswer } from "@/lib/reactions";
import type { Campaign } from "@/lib/tanda-jadi";

// Reactions and rooms change far less often than seats do, and reading them is a heavier question.
const EVERY_MS = 12_000;
// Reactions kept in the database are one cheap question, so they are asked for more often.
const REACTIONS_EVERY_MS = 5_000;
const NOTHING_MINE: ReadonlySet<string> = new Set();
const NO_PLOTS: ReadonlyMap<string, Plot> = new Map();
const NO_LOOKS: ReadonlyMap<string, Look> = new Map();
const NO_REACTIONS: ReadonlyMap<string, ReactionCounts> = new Map();

/**
 * The notes kept on chain beside the campaigns: how often each was reacted to, and which annex
 * plot each creator built on. Read now, every twelve seconds, and whenever `reload` is called.
 * A network that does not answer leaves the last good reading in place.
 *
 * Where the site has a database for reactions they come from there, one of each kind per
 * wallet; otherwise they are the reaction notes on chain. Rooms are always read from the chain.
 */
export function useNotes(campaigns: Campaign[] | undefined): {
  reactions: ReadonlyMap<string, ReactionCounts>;
  plots: ReadonlyMap<string, Plot>;
  /** False until the notes have been read once: before that, nobody knows which plots are taken. */
  ready: boolean;
  /** The look each creator chose for their campaign's object. */
  looks: ReadonlyMap<string, Look>;
  /** What the connected wallet reacted with, as `campaign:kind`. Only known with a database. */
  mine: ReadonlySet<string>;
  /** Whether reactions are kept in the database rather than on chain. */
  inDatabase: boolean;
  /** Takes the database's answer to a reaction just given, so the page need not ask again. */
  accept(answer: ReactionsAnswer): void;
  reload(): void;
} {
  const { connection } = useConnection();
  const [read, setRead] = useState<{ notes: Notes; signed: Map<string, string[]> } | null>(null);
  const [turn, setTurn] = useState(0);
  const reload = useCallback(() => setTurn((count) => count + 1), []);
  const { publicKey } = useWallet();
  const wallet = publicKey?.toBase58() ?? null;
  const [kept, setKept] = useState<ReactionsAnswer | null>(null);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      let again = REACTIONS_EVERY_MS;
      try {
        const response = await fetch(`/api/reactions${wallet ? `?wallet=${wallet}` : ""}`);
        if (response.ok) {
          const answer = (await response.json()) as ReactionsAnswer;
          if (active) setKept(answer);
          // No database on this site: there is nothing to keep asking about.
          if (!answer.configured) again = 0;
        }
      } catch {
        // Keep what was read before.
      }
      if (active && again > 0) timer = setTimeout(run, again);
    };
    run();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [wallet, turn]);

  const inDatabase = kept?.configured === true;
  const fromDatabase = useMemo(
    () => new Map(Object.entries(kept?.counts ?? {})) as ReadonlyMap<string, ReactionCounts>,
    [kept],
  );
  const mine = useMemo(() => (kept?.mine.length ? new Set(kept.mine) : NOTHING_MINE), [kept]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      try {
        const notes = await readNotes(connection);
        // A claim only counts if the campaign's creator signed it, so each one is looked up.
        const signed = new Map<string, string[]>();
        for (const claim of [...notes.claims, ...notes.looks]) {
          try {
            signed.set(claim.signature, await signersOf(connection, claim.signature));
          } catch {
            // Not judged this time round; the next reading asks again.
          }
        }
        if (active) setRead({ notes, signed });
        if (active) timer = setTimeout(run, EVERY_MS);
        return;
      } catch {
        // Keep what was read before.
      }
      // A reading that failed is tried again soon: until one succeeds nobody can build a room.
      if (active) timer = setTimeout(run, 3_000);
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

  const looks = useMemo(() => {
    if (!read || !campaigns) return NO_LOOKS;
    const creators = new Map(
      campaigns.map((campaign) => [campaign.address.toBase58(), campaign.creator.toBase58()]),
    );
    return judgeLooks(
      read.notes.looks,
      (campaign) => creators.get(campaign),
      (signature) => read.signed.get(signature),
    );
  }, [read, campaigns]);

  return {
    ready: read !== null,
    looks,
    reactions: inDatabase ? fromDatabase : (read?.notes.reactions ?? NO_REACTIONS),
    plots,
    mine,
    inDatabase,
    accept: setKept,
    reload,
  };
}
