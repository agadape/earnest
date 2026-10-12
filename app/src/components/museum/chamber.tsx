"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { CampaignView } from "@/components/campaign-view";
import type { Inspector } from "@/components/museum/inspector";
import { useToasts } from "@/components/toasts";
import { formatDate, formatDuration, shortAddress, usd } from "@/lib/format";
import { type ReactionCounts, type ReactionKind, reactIx, REACTIONS } from "@/lib/ledger";
import { reactionMessage, type ReactionsAnswer } from "@/lib/reactions";
import { type Exhibit, ROOMS, STATUS_WORDS } from "@/lib/museum/plan";
import { bond, buildEnd } from "@/lib/tanda-jadi";
import { useSend } from "@/lib/transactions";

/** A panel with cut corners and a ruled ground, like a specimen card in a display case. */
export function Frame({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <div className={`hud-frame ${className}`}>
      <div className="hud-frame-inner">{children}</div>
    </div>
  );
}

/** The time a reaction is signed at, which the server checks is recent. */
const rightNow = () => Date.now();

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="font-mono text-[11px] uppercase tracking-widest text-lime">{label}</dt>
      <dd className="mt-0.5 pl-3 font-mono text-sm text-paper">{children}</dd>
    </div>
  );
}

/** The one date that matters for the state an exhibit is in. */
function when(exhibit: Exhibit, now: number): { label: string; value: string } {
  const { campaign, status } = exhibit;
  switch (status) {
    case "funding":
      return { label: "Closes in", value: formatDuration(campaign.deadline - now) };
    case "building":
      return { label: "Build ends in", value: formatDuration(buildEnd(campaign) - now) };
    case "failed":
      return { label: "Closed on", value: formatDate(campaign.deadline) };
    case "braked":
      return { label: "Stopped on", value: formatDate(campaign.brakedAt) };
    case "completed":
      return { label: "Completed on", value: formatDate(buildEnd(campaign)) };
  }
}

/**
 * The commitment chamber: one exhibit taken off the floor and looked at closely. Its object
 * turns in the middle, what it is stands on the left, and on the right is the campaign itself,
 * with everything that can be done to it.
 */
export function Chamber({
  address,
  exhibit,
  now,
  onBack,
  onMap,
  onCreator,
  reactions,
  mine,
  inDatabase,
  onReacted,
  onPlace,
  hasRoom,
}: {
  address: string;
  /** Missing for a campaign the museum has no floor for; it can still be opened by its link. */
  exhibit: Exhibit | undefined;
  now: number | null;
  onBack: () => void;
  onMap: () => void;
  /** Opens the record of the wallet that made this. */
  onCreator: (creator: string) => void;
  /** How often it was reacted to, by kind. Missing until the notes were read. */
  reactions: ReactionCounts | undefined;
  /** What the connected wallet reacted with, as `campaign:kind`. */
  mine: ReadonlySet<string>;
  /** Whether reactions are kept in the database (a signed message) or on chain (a transaction). */
  inDatabase: boolean;
  /** Called after a reaction went through, with the database's answer where there is one. */
  onReacted: (answer?: ReactionsAnswer) => void;
  /** Starts choosing an annex plot for it. Only given to the wallet that created it. */
  onPlace?: () => void;
  hasRoom: boolean;
}) {
  const { send, busy } = useSend();
  const { publicKey, signMessage } = useWallet();
  const toasts = useToasts();
  const [signing, setSigning] = useState<ReactionKind | null>(null);

  /** Adds a reaction, or takes back one this wallet already gave. */
  const react = async (kind: ReactionKind) => {
    if (!inDatabase) {
      const sent = await send(`react-${kind}`, {
        pending: "Signing your reaction",
        done: "Your reaction is on the record",
        build: async (payer) => [reactIx(payer, new PublicKey(address), kind)],
      });
      if (sent) onReacted();
      return;
    }
    if (!publicKey) {
      toasts.show("error", "Connect a wallet first.");
      return;
    }
    if (!signMessage) {
      toasts.show("error", "This wallet cannot sign messages, which a reaction needs.");
      return;
    }
    setSigning(kind);
    try {
      const wallet = publicKey.toBase58();
      const request = { campaign: address, kind, wallet, on: !mine.has(`${address}:${kind}`), at: rightNow() };
      const signature = await signMessage(new TextEncoder().encode(reactionMessage(request)));
      const response = await fetch("/api/reactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...request, signature: btoa(String.fromCharCode(...signature)) }),
      });
      const answer = (await response.json()) as ReactionsAnswer & { error?: string };
      if (!response.ok) throw new Error(answer.error ?? "The reaction could not be saved.");
      onReacted(answer);
    } catch (error) {
      toasts.show("error", error instanceof Error ? error.message : "The reaction could not be saved.");
    } finally {
      setSigning(null);
    }
  };
  const stage = useRef<HTMLDivElement>(null);
  const inspector = useRef<Inspector | null>(null);
  const kind = exhibit?.kind;
  const status = exhibit?.status;

  useEffect(() => {
    const element = stage.current;
    if (!element || !kind || !status) return;
    let cancelled = false;
    let created: Inspector | null = null;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    import("@/components/museum/inspector")
      .then(({ Inspector: Make }) => {
        if (cancelled) return;
        created = new Make(element, kind, status, calm);
        inspector.current = created;
      })
      // Without 3D the chamber still has every word and every button; only the object is missing.
      .catch(() => undefined);
    return () => {
      cancelled = true;
      created?.dispose();
      inspector.current = null;
    };
  }, [kind, status]);

  const campaign = exhibit?.campaign;
  const date = exhibit && now !== null ? when(exhibit, now) : null;

  return (
    <section
      aria-label="Commitment chamber"
      className="chamber-ground absolute inset-0 z-20 flex flex-col overflow-y-auto text-paper lg:block lg:overflow-hidden"
    >
      <header className="shrink-0 px-4 pt-4 sm:px-6 sm:pt-5 lg:absolute lg:left-0 lg:top-0 lg:z-10 lg:max-w-[calc(100%-33rem)]">
        <p className="font-mono text-xs uppercase tracking-widest text-paper/60">
          Commitment chamber
          {exhibit && ` · exhibit ${exhibit.code} · ${ROOMS.find(({ id }) => id === exhibit.room)?.name}`}
        </p>
        <h1 className="mt-1 font-mono text-2xl font-semibold leading-tight text-lime sm:text-3xl">
          {campaign ? campaign.title || "Untitled campaign" : "An exhibit in storage"}
        </h1>
      </header>

      {/* The object, in whatever the two panels leave free. */}
      <div
        ref={stage}
        aria-hidden
        className="h-[38vh] shrink-0 lg:absolute lg:bottom-20 lg:left-72 lg:right-[32rem] lg:top-24 lg:h-auto"
      />

      {exhibit && campaign && (
        <Frame className="mx-4 shrink-0 sm:mx-6 lg:absolute lg:left-6 lg:top-1/2 lg:mx-0 lg:w-64 lg:-translate-y-1/2">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-4 p-5 lg:grid-cols-1">
            <Fact label="State">{STATUS_WORDS[exhibit.status]}</Fact>
            <Fact label="Seats">
              {campaign.backers} of {campaign.targetBackers} taken
            </Fact>
            <Fact label="A seat costs">{usd(campaign.price)}</Fact>
            {date && <Fact label={date.label}>{date.value}</Fact>}
            <Fact label="Creator's bond">{usd(bond(campaign))}</Fact>
            <Fact label="Made by">
              <button
                type="button"
                onClick={() => onCreator(campaign.creator.toBase58())}
                className="underline underline-offset-2 hover:text-lime"
              >
                {shortAddress(campaign.creator)}
              </button>
            </Fact>
          </dl>
          <div className="border-t border-paper/15 px-5 py-4">
            <p className="font-mono text-[11px] uppercase tracking-widest text-lime">Reactions</p>
            <div className="mt-2 flex gap-1.5">
              {REACTIONS.map(({ kind, sign, label }) => (
                <button
                  key={kind}
                  type="button"
                  title={label}
                  aria-label={`${label}: ${reactions?.[kind] ?? 0} so far. React.`}
                  aria-pressed={mine.has(`${address}:${kind}`)}
                  disabled={busy !== null || signing !== null}
                  onClick={() => react(kind)}
                  className={`flex h-9 flex-1 items-center justify-center gap-1.5 border font-mono text-sm hover:border-lime disabled:opacity-50 ${
                    mine.has(`${address}:${kind}`) ? "border-lime bg-lime/15 text-lime" : "border-paper/30 text-paper"
                  }`}
                >
                  <span aria-hidden>{sign}</span>
                  {reactions?.[kind] ?? 0}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-4 text-paper/55">
              {inDatabase
                ? "You sign a message; it costs nothing. One of each kind per wallet, and a second press takes it back. A count is of wallets, not people. "
                : "Each one is a transaction you sign. One wallet can react more than once, so this counts reactions, not people. "}
              They gather a crowd round the exhibit.
            </p>
          </div>
          {onPlace && (
            <div className="border-t border-paper/15 px-5 py-4">
              <button type="button" onClick={onPlace} className="hud-button w-full justify-center">
                {hasRoom ? "Move its room" : "Build it a room in the Annex"}
              </button>
            </div>
          )}
        </Frame>
      )}

      <Frame className="mx-4 mt-4 shrink-0 sm:mx-6 lg:absolute lg:bottom-20 lg:right-6 lg:top-5 lg:mx-0 lg:mt-0 lg:w-[30rem]">
        <div className="flex h-full flex-col">
          <div className="shrink-0 border-b border-paper/15 px-5 py-3">
            <p className="font-mono text-[11px] uppercase tracking-widest text-lime">The commitment</p>
            <p className="mt-0.5 text-xs leading-5 text-paper/60">
              What you can do here, and what each ending pays. The object beside this is a stand-in:
              campaigns carry no pictures.
            </p>
          </div>
          <div className="chamber thin-scroll min-h-0 flex-1 px-5 py-5 lg:overflow-y-auto">
            <CampaignView address={address} compact />
          </div>
        </div>
      </Frame>

      <div className="sticky bottom-0 mt-4 flex shrink-0 items-center justify-between gap-3 bg-carbon/95 px-4 py-3 sm:px-6 lg:absolute lg:inset-x-0 lg:bottom-0 lg:mt-0 lg:bg-transparent lg:py-5">
        <button type="button" onClick={onBack} className="hud-button">
          Back <span className="hidden font-mono text-[10px] opacity-60 sm:inline">esc</span>
        </button>
        <div className="hidden items-center gap-2 font-mono text-xs uppercase tracking-wider text-paper/55 md:flex">
          <span>Drag to turn</span>
          <span aria-hidden>·</span>
          <span>Scroll to zoom</span>
          <button
            type="button"
            aria-label="Move further away"
            onClick={() => inspector.current?.zoomBy(1.2)}
            className="ml-2 flex h-8 w-8 items-center justify-center border border-paper/30 text-base hover:border-lime hover:text-lime"
          >
            −
          </button>
          <button
            type="button"
            aria-label="Move closer"
            onClick={() => inspector.current?.zoomBy(1 / 1.2)}
            className="flex h-8 w-8 items-center justify-center border border-paper/30 text-base hover:border-lime hover:text-lime"
          >
            +
          </button>
        </div>
        <button type="button" onClick={onMap} className="hud-button">
          View map
        </button>
      </div>
    </section>
  );
}
