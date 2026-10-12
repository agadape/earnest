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
    <div className="rounded-xl border-2 border-toy-ink/15 bg-white px-3 py-2">
      <dt className="text-[11px] font-bold uppercase tracking-wide text-toy-ink/60">{label}</dt>
      <dd className="mt-0.5 text-base font-extrabold leading-tight text-toy-ink">{children}</dd>
    </div>
  );
}

// The colour of the ribbon over an exhibit's card, by the state it is in.
const RIBBON: Record<Exhibit["status"], string> = {
  funding: "bg-lime",
  building: "bg-[#ffcf5c]",
  completed: "bg-white",
  failed: "bg-[#cfc7b4]",
  braked: "bg-signal",
};

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
  const tint = exhibit?.tint;
  const trim = exhibit?.trim;
  const status = exhibit?.status;

  useEffect(() => {
    const element = stage.current;
    if (!element || !kind || !status || tint === undefined || trim === undefined) return;
    let cancelled = false;
    let created: Inspector | null = null;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    import("@/components/museum/inspector")
      .then(({ Inspector: Make }) => {
        if (cancelled) return;
        created = new Make(element, { kind, tint, trim }, status, calm);
        inspector.current = created;
      })
      // Without 3D the chamber still has every word and every button; only the object is missing.
      .catch(() => undefined);
    return () => {
      cancelled = true;
      created?.dispose();
      inspector.current = null;
    };
  }, [kind, tint, trim, status]);

  const campaign = exhibit?.campaign;
  const date = exhibit && now !== null ? when(exhibit, now) : null;

  const seats = campaign ? Math.min(campaign.targetBackers, 24) : 0;

  return (
    <section
      aria-label="Commitment chamber"
      className="gallery-ground absolute inset-0 z-20 flex flex-col overflow-y-auto text-toy-ink lg:block lg:overflow-hidden"
    >
      {/* The exhibit's name, on a sign hung at the top of the wall. */}
      <header className="shrink-0 px-4 pt-4 sm:px-6 sm:pt-5 lg:absolute lg:left-6 lg:top-5 lg:z-10 lg:max-w-[calc(100%-35rem)] lg:p-0">
        <div className="toy-card inline-block max-w-full px-5 py-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-toy-ink/60">
            {exhibit ? `Exhibit ${exhibit.code} · ${ROOMS.find(({ id }) => id === exhibit.room)?.name}` : "Exhibit"}
          </p>
          <h1 className="mt-0.5 text-2xl font-extrabold leading-tight tracking-tight sm:text-3xl">
            {campaign ? campaign.title || "Untitled campaign" : "An exhibit in storage"}
          </h1>
        </div>
      </header>

      {/* The object on its plinth, in whatever the two cards leave free. */}
      <div
        ref={stage}
        aria-hidden
        className="h-[38vh] shrink-0 lg:absolute lg:bottom-0 lg:left-72 lg:right-[33rem] lg:top-24 lg:h-auto"
      />

      {exhibit && campaign && (
        <div className="toy-card thin-scroll mx-4 shrink-0 overflow-hidden sm:mx-6 lg:absolute lg:bottom-24 lg:left-6 lg:top-32 lg:mx-0 lg:w-64 lg:overflow-y-auto">
          <p className={`border-b-2 border-toy-ink px-4 py-2 text-sm font-extrabold uppercase tracking-wide ${RIBBON[exhibit.status]}`}>
            {STATUS_WORDS[exhibit.status]}
          </p>
          <div className="space-y-2 p-3">
            <div className="rounded-xl border-2 border-toy-ink/15 bg-white px-3 py-2">
              <p className="text-[11px] font-bold uppercase tracking-wide text-toy-ink/60">Seats</p>
              <p className="text-base font-extrabold leading-tight">
                {campaign.backers} of {campaign.targetBackers} taken
              </p>
              <div aria-hidden className="mt-1.5 flex flex-wrap gap-1">
                {Array.from({ length: seats }, (_, index) => (
                  <span
                    key={index}
                    className={`h-3.5 w-3.5 rounded-[4px] border-2 border-toy-ink ${
                      index < Math.round((campaign.backers * seats) / campaign.targetBackers) ? "bg-lime" : "bg-white"
                    }`}
                  />
                ))}
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-2">
              <Fact label="A seat">{usd(campaign.price)}</Fact>
              <Fact label="Maker's bond">{usd(bond(campaign))}</Fact>
              {date && (
                <div className="col-span-2">
                  <Fact label={date.label}>{date.value}</Fact>
                </div>
              )}
              <div className="col-span-2">
                <Fact label="Made by">
                  <button
                    type="button"
                    onClick={() => onCreator(campaign.creator.toBase58())}
                    className="font-mono text-sm underline decoration-2 underline-offset-2 hover:text-accent"
                  >
                    {shortAddress(campaign.creator)}
                  </button>
                </Fact>
              </div>
            </dl>
          </div>
          <div className="border-t-2 border-toy-ink bg-[#e6e3d5] px-3 py-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-toy-ink/60">Reactions</p>
            <div className="mt-1.5 flex gap-2">
              {REACTIONS.map(({ kind, sign, label }) => (
                <button
                  key={kind}
                  type="button"
                  title={label}
                  aria-label={`${label}: ${reactions?.[kind] ?? 0} so far. React.`}
                  aria-pressed={mine.has(`${address}:${kind}`)}
                  disabled={busy !== null || signing !== null}
                  onClick={() => react(kind)}
                  className={`toy-button toy-button-fit h-11 flex-1 gap-1.5 text-base ${mine.has(`${address}:${kind}`) ? "toy-button-on" : ""}`}
                >
                  <span aria-hidden>{sign}</span>
                  {reactions?.[kind] ?? 0}
                </button>
              ))}
            </div>
            <p className="mt-2.5 text-[11px] leading-4 text-toy-ink/60">
              {inDatabase
                ? "Free: you sign a message. One of each per wallet; press again to take it back. Counts wallets, not people."
                : "Each is a transaction you sign. One wallet can react more than once, so this counts reactions, not people."}
            </p>
          </div>
          {onPlace && !hasRoom && (
            <div className="border-t-2 border-toy-ink p-3">
              <button type="button" onClick={onPlace} className="toy-button toy-button-on w-full">
                Build it a room
              </button>
              <p className="mt-2 text-[11px] leading-4 text-toy-ink/60">
                Yours to place, once: a room cannot be moved afterwards.
              </p>
            </div>
          )}
        </div>
      )}

      <div className="toy-card mx-4 mt-4 flex shrink-0 flex-col overflow-hidden sm:mx-6 lg:absolute lg:bottom-20 lg:right-6 lg:top-5 lg:mx-0 lg:mt-0 lg:w-[31rem]">
        <div className="shrink-0 border-b-2 border-toy-ink bg-[#e6e3d5] px-5 py-3">
          <p className="text-sm font-extrabold uppercase tracking-wide">Take a seat</p>
          <p className="mt-0.5 text-xs leading-5 text-toy-ink/65">
            What you can do here, and what each ending pays. The object is a stand-in: campaigns carry no pictures.
          </p>
        </div>
        <div className="gallery thin-scroll min-h-0 flex-1 bg-paper px-5 py-5 lg:overflow-y-auto">
          <CampaignView address={address} compact />
        </div>
      </div>

      <div className="sticky bottom-0 mt-4 flex shrink-0 items-center justify-between gap-3 bg-paper/95 px-4 py-3 sm:px-6 lg:absolute lg:inset-x-0 lg:bottom-0 lg:mt-0 lg:bg-transparent lg:py-4">
        <button type="button" onClick={onBack} className="toy-button">
          ← Back <span className="hidden text-[10px] font-bold opacity-50 sm:inline">esc</span>
        </button>
        <div className="hidden items-center gap-2 text-xs font-bold uppercase tracking-wide text-toy-ink/60 md:flex">
          <span>Drag to turn · scroll to zoom</span>
          <button
            type="button"
            aria-label="Move further away"
            onClick={() => inspector.current?.zoomBy(1.2)}
            className="toy-button toy-button-fit ml-2 h-9 w-9 text-lg"
          >
            −
          </button>
          <button
            type="button"
            aria-label="Move closer"
            onClick={() => inspector.current?.zoomBy(1 / 1.2)}
            className="toy-button toy-button-fit h-9 w-9 text-lg"
          >
            +
          </button>
        </div>
        <button type="button" onClick={onMap} className="toy-button">
          View map
        </button>
      </div>
    </section>
  );
}
