"use client";

import { PublicKey } from "@solana/web3.js";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { useCreatorCampaigns } from "@/components/creator-record";
import { Frame } from "@/components/museum/chamber";
import type { Inspector } from "@/components/museum/inspector";
import { NewCampaignForm } from "@/components/new-campaign-form";
import { formatDuration, shortAddress, usd } from "@/lib/format";
import { claimPlotIx, type Plot } from "@/lib/ledger";
import { describeRecord, recordOf } from "@/lib/record";
import { KINDS, type Look, LOOK_TINTS, LOOK_TRIMS, lookOf, PLOTS, ROOM_FLOORS, STATUS_WORDS } from "@/lib/museum/plan";
import { buildEnd, type Campaign, type Status, statusAt } from "@/lib/tanda-jadi";
import { useSend } from "@/lib/transactions";

/** A window over the museum floor: dimmed floor behind, a framed panel in front, Esc to leave. */
function Overlay({
  label,
  title,
  kicker,
  onClose,
  children,
}: {
  label: string;
  title: string;
  kicker: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      className="absolute inset-0 z-20 flex items-stretch justify-center bg-carbon/80 p-3 backdrop-blur-[2px] sm:p-6"
    >
      <Frame className="h-full w-full max-w-6xl">
        <div className="flex h-full flex-col text-paper">
          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-paper/15 px-5 py-4">
            <div className="min-w-0">
              <p className="font-mono text-[11px] uppercase tracking-widest text-paper/60">{kicker}</p>
              <h1 className="mt-0.5 font-mono text-xl font-semibold text-lime sm:text-2xl">{title}</h1>
            </div>
            <button type="button" onClick={onClose} className="hud-button shrink-0">
              Back <span className="hidden font-mono text-[10px] opacity-60 sm:inline">esc</span>
            </button>
          </header>
          {children}
        </div>
      </Frame>
    </section>
  );
}

/** One campaign as a card to press: its state, its name, and the one line that matters now. */
function Card({
  campaign,
  now,
  onOpen,
}: {
  campaign: Campaign;
  now: number;
  onOpen: (address: string) => void;
}) {
  const status = statusAt(campaign, now);
  return (
    <button
      type="button"
      onClick={() => onOpen(campaign.address.toBase58())}
      className="block h-full w-full border border-paper/20 bg-paper/[0.03] p-3 text-left hover:border-lime hover:bg-lime/10 focus-visible:border-lime focus-visible:outline-none"
    >
      <span className="font-mono text-[10px] uppercase tracking-widest text-lime">{STATUS_WORDS[status]}</span>
      <span className="mt-1 block text-sm font-semibold leading-5">{campaign.title || "Untitled campaign"}</span>
      <span className="mt-2 block font-mono text-xs text-paper/65">
        {campaign.backers}/{campaign.targetBackers} seats · {usd(campaign.price)} ·{" "}
        {status === "funding"
          ? `${formatDuration(campaign.deadline - now)} left`
          : status === "building"
            ? `${formatDuration(buildEnd(campaign) - now)} of building left`
            : `by ${shortAddress(campaign.creator)}`}
      </span>
    </button>
  );
}

const FILTERS: { key: "all" | Status; label: string }[] = [
  { key: "all", label: "All" },
  { key: "funding", label: "Taking pledges" },
  { key: "building", label: "Being built" },
  { key: "completed", label: "Completed" },
  { key: "failed", label: "Didn't fill" },
  { key: "braked", label: "Stopped by backers" },
];

/**
 * The campaign board by the door: every campaign there is, including the ones the rooms have no
 * floor for, to search and to open. It is the museum's index.
 */
export function Board({
  campaigns,
  now,
  onOpen,
  onClose,
}: {
  campaigns: Campaign[];
  now: number;
  onOpen: (address: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | Status>("all");
  const words = query.trim().toLowerCase();
  const newest = [...campaigns].sort((a, b) => (a.id === b.id ? 0 : a.id > b.id ? -1 : 1));
  const found = newest.filter(
    (campaign) =>
      (filter === "all" || statusAt(campaign, now) === filter) &&
      (words === "" ||
        campaign.title.toLowerCase().includes(words) ||
        campaign.address.toBase58().toLowerCase().startsWith(words) ||
        campaign.creator.toBase58().toLowerCase().startsWith(words)),
  );

  return (
    <Overlay label="Campaign board" kicker="By the door · every campaign" title="Campaign board" onClose={onClose}>
      <div className="shrink-0 space-y-3 px-5 py-4">
        <input
          type="search"
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search the board"
          placeholder="Search by title, or by the start of an address"
          className="block h-11 w-full border border-paper/30 bg-carbon px-3 font-mono text-sm text-paper placeholder:text-paper/40 focus:border-lime focus:outline-none"
        />
        <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5">
          {FILTERS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
              className={`flex h-8 items-center gap-2 border px-3 font-mono text-xs uppercase tracking-wider ${
                filter === key
                  ? "border-lime bg-lime text-carbon"
                  : "border-paper/30 text-paper hover:border-lime"
              }`}
            >
              {label}
              <span className="opacity-70">
                {key === "all"
                  ? campaigns.length
                  : campaigns.filter((campaign) => statusAt(campaign, now) === key).length}
              </span>
            </button>
          ))}
        </div>
      </div>
      <ol className="thin-scroll grid min-h-0 flex-1 content-start gap-2 overflow-y-auto px-5 pb-5 sm:grid-cols-2 lg:grid-cols-3">
        {found.map((campaign) => (
          <li key={campaign.address.toBase58()}>
            <Card campaign={campaign} now={now} onOpen={onOpen} />
          </li>
        ))}
        {found.length === 0 && (
          <li className="px-1 py-6 font-mono text-sm text-paper/60 sm:col-span-2 lg:col-span-3">
            Nothing on the board matches that.
          </li>
        )}
      </ol>
    </Overlay>
  );
}

/**
 * A creator's file: everything one wallet has opened here and how each ended. Read from the
 * campaigns themselves, so it says what happened and nothing about who the wallet is.
 */
export function CreatorRecord({
  address,
  now,
  onOpen,
  onClose,
}: {
  address: string;
  now: number | null;
  onOpen: (address: string) => void;
  onClose: () => void;
}) {
  const creator = useMemo(() => {
    try {
      return new PublicKey(address);
    } catch {
      return null;
    }
  }, [address]);
  const campaigns = useCreatorCampaigns(creator);
  const record = campaigns && now !== null ? recordOf(campaigns, now) : null;
  const totals: { label: string; value: number; note?: string }[] = record
    ? [
        { label: "Campaigns opened", value: record.opened },
        {
          label: "Ran to the end",
          value: record.completed,
          note: record.earned > 0n ? `${usd(record.earned)} reached the creator` : undefined,
        },
        {
          label: "Didn't fill",
          value: record.failed,
          note: record.bonuses > 0n ? `${usd(record.bonuses)} paid to early backers in bonuses` : undefined,
        },
        {
          label: "Stopped by backers",
          value: record.braked,
          note: record.bondsLost > 0n ? `${usd(record.bondsLost)} of bonds went to backers` : undefined,
        },
      ]
    : [];
  const word = (text: string) => <p className="px-5 py-6 font-mono text-sm text-paper/70">{text}</p>;

  return (
    <Overlay
      label="Creator record"
      kicker="From the archive · a creator's file"
      title={creator ? `Creator ${shortAddress(creator)}` : "Creator record"}
      onClose={onClose}
    >
      {!creator ? (
        word("That is not a wallet address. Check the link and try again.")
      ) : campaigns === null ? (
        word("The network did not answer. Close this and try again in a moment.")
      ) : !campaigns || !record || now === null ? (
        <p aria-busy className="px-5 py-6 font-mono text-sm uppercase tracking-widest text-paper/60">
          Fetching the file…
        </p>
      ) : (
        <div className="thin-scroll min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
          <div>
            <p className="break-all font-mono text-sm text-paper">{address}</p>
            <p className="mt-1 font-mono text-xs uppercase tracking-wider text-lime">
              {campaigns.length === 0 ? "No campaigns from this wallet" : describeRecord(record)}
            </p>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-paper/70">
              Everything here is read from the campaigns this wallet opened. A campaign that
              didn&apos;t fill is not a black mark: it means the creator asked before building,
              and paid the bonus they promised. Two things this cannot tell you: a creator can
              start over with a new wallet, so an empty file says nothing either way, and
              nothing stops a creator from backing a small campaign of their own to the end.
            </p>
          </div>
          {campaigns.length > 0 && (
            <>
              <dl className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                {totals.map(({ label, value, note }) => (
                  <div key={label} className="border border-paper/20 bg-paper/[0.03] p-4">
                    <dt className="font-mono text-[11px] uppercase tracking-widest text-lime">{label}</dt>
                    <dd className="mt-1 font-mono text-3xl font-semibold text-paper">{value}</dd>
                    {note && <dd className="mt-1 text-xs leading-5 text-paper/65">{note}</dd>}
                  </div>
                ))}
              </dl>
              <section aria-labelledby="creator-campaigns">
                <h2 id="creator-campaigns" className="font-mono text-xs uppercase tracking-widest text-paper/60">
                  Their campaigns, newest first
                </h2>
                <ol className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {campaigns.map((campaign) => (
                    <li key={campaign.address.toBase58()}>
                      <Card campaign={campaign} now={now} onOpen={onOpen} />
                    </li>
                  ))}
                </ol>
              </section>
            </>
          )}
        </div>
      )}
    </Overlay>
  );
}

/**
 * Build mode: a creator choosing where in the annex their campaign's room goes. The floor
 * stays in view behind this, with the free plots lit; a plot can be picked there or on the
 * small plan here. Nothing is built until the creator signs.
 */
export function PlotPicker({
  campaign,
  owners,
  current,
  chosen,
  onChoose,
  onDone,
  onCancel,
}: {
  campaign: Campaign;
  /** Which campaign stands on which plot now, by plot number. */
  owners: ReadonlyMap<number, string>;
  current: Plot | undefined;
  chosen: number | null;
  onChoose: (plot: number) => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { send, busy } = useSend();
  const [style, setStyle] = useState(current?.style ?? 0);
  const id = campaign.address.toBase58();
  const claim = async (plot: number) => {
    const sent = await send("plot", {
      pending: plot < 0 ? "Giving the room up" : "Signing for the plot",
      done: plot < 0 ? "The plot is free again" : `Room built on plot E-${String(plot + 1).padStart(2, "0")}`,
      build: async (payer) => [claimPlotIx(payer, campaign.address, plot, style)],
    });
    if (sent) onDone();
  };

  return (
    <section aria-label="Build mode" className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center p-3 sm:p-5">
      <Frame className="pointer-events-auto w-full max-w-4xl">
        <div className="flex flex-col gap-4 p-4 text-paper sm:flex-row sm:items-start sm:gap-6 sm:p-5">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[11px] uppercase tracking-widest text-paper/60">Build mode · the Annex</p>
            <h2 className="mt-0.5 truncate font-mono text-lg font-semibold text-lime">
              A room for {campaign.title || "your campaign"}
            </h2>
            <p className="mt-2 text-xs leading-5 text-paper/70">
              Pick a free plot, on the floor or on the plan, and a colour for the floor. You sign
              one transaction; it costs a network fee and moves no money. The first creator to
              sign for a plot has it, and you can move later.
            </p>
            <div role="group" aria-label="Floor colour" className="mt-3 flex items-center gap-1.5">
              {ROOM_FLOORS.map((color, index) => (
                <button
                  key={color}
                  type="button"
                  aria-label={`Floor colour ${index + 1}`}
                  aria-pressed={style === index}
                  onClick={() => setStyle(index)}
                  style={{ backgroundColor: color }}
                  className={`h-7 w-9 border-2 ${style === index ? "border-lime" : "border-paper/20"}`}
                />
              ))}
            </div>
          </div>
          <div className="shrink-0">
            <div role="group" aria-label="Plots" className="grid grid-cols-6 gap-1">
              {PLOTS.map((_, plot) => {
                const owner = owners.get(plot);
                const mine = owner === id;
                const takenByOther = owner !== undefined && !mine;
                return (
                  <button
                    key={plot}
                    type="button"
                    disabled={takenByOther || mine}
                    aria-pressed={chosen === plot}
                    aria-label={`Plot ${plot + 1}${takenByOther ? ", taken" : mine ? ", yours now" : ", free"}`}
                    onClick={() => onChoose(plot)}
                    className={`h-8 w-10 border font-mono text-xs ${
                      chosen === plot
                        ? "border-lime bg-lime text-carbon"
                        : mine
                          ? "border-lime text-lime"
                          : takenByOther
                            ? "border-paper/10 text-paper/25"
                            : "border-paper/40 text-paper hover:border-lime"
                    }`}
                  >
                    {plot + 1}
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={chosen === null || busy !== null}
                onClick={() => chosen !== null && claim(chosen)}
                className="h-9 bg-lime px-4 font-mono text-xs font-semibold uppercase tracking-wider text-carbon hover:bg-white disabled:opacity-40"
              >
                {chosen === null ? "Pick a plot" : `Sign and build on E-${String(chosen + 1).padStart(2, "0")}`}
              </button>
              {current && (
                <button type="button" disabled={busy !== null} onClick={() => claim(-1)} className="hud-button">
                  Give the room up
                </button>
              )}
              <button type="button" onClick={onCancel} className="hud-button">
                Cancel <span className="hidden font-mono text-[10px] opacity-60 sm:inline">esc</span>
              </button>
            </div>
          </div>
        </div>
      </Frame>
    </section>
  );
}

/** One stand-in object on a turntable, for showing what a campaign will look like on the floor. */
function Turntable({ kind, tint, trim }: Look) {
  const stage = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    let cancelled = false;
    let created: Inspector | null = null;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    import("@/components/museum/inspector")
      .then(({ Inspector: Make }) => {
        if (!cancelled) created = new Make(element, { kind, tint, trim }, "funding", calm);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      created?.dispose();
    };
  }, [kind, tint, trim]);
  return <div ref={stage} aria-hidden className="h-full w-full" />;
}

/**
 * The curator's desk: where a campaign is opened. The same terms and the same checks as
 * before, laid out as a workbench: what is being made turns on the left while it is described
 * on the right.
 */
export function DesignMode({
  onOpened,
  onClose,
}: {
  /** Told the new campaign's address and the look its creator settled on. */
  onOpened: (address: string, look: Look) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  // What the creator picked themselves; whatever they left alone follows the title.
  const [picked, setPicked] = useState<Partial<Look>>({});
  const look: Look = { ...lookOf({ title }), ...picked };
  const chip = (on: boolean) =>
    `border px-2 py-1 font-mono text-[11px] uppercase tracking-wider ${on ? "border-lime bg-lime text-carbon" : "border-paper/30 text-paper hover:border-lime"}`;

  return (
    <Overlay label="Design mode" kicker="At the curator's desk · design mode" title="Put a new exhibit on the floor" onClose={onClose}>
      <div className="thin-scroll flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        <div className="flex shrink-0 flex-col border-b border-paper/15 lg:w-80 lg:border-b-0 lg:border-r">
          <div className="h-56 lg:h-72">
            <Turntable {...look} />
          </div>
          <div className="space-y-3 px-5 pb-5">
            <p className="font-mono text-[11px] uppercase tracking-widest text-lime">On the plinth</p>
            <p className="font-mono text-sm leading-6 text-paper">
              {title.trim() || "Give it a title and it takes shape."}
            </p>
            <div role="group" aria-label="Shape">
              <p className="font-mono text-[11px] uppercase tracking-widest text-paper/60">Shape</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {KINDS.map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    aria-pressed={look.kind === kind}
                    onClick={() => setPicked((current) => ({ ...current, kind }))}
                    className={chip(look.kind === kind)}
                  >
                    {kind}
                  </button>
                ))}
              </div>
            </div>
            <div role="group" aria-label="Colour">
              <p className="font-mono text-[11px] uppercase tracking-widest text-paper/60">Colour</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {LOOK_TINTS.map((color, tint) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={`Colour ${tint + 1}`}
                    aria-pressed={look.tint === tint}
                    onClick={() => setPicked((current) => ({ ...current, tint }))}
                    style={{ backgroundColor: color }}
                    className={`h-6 w-6 border-2 ${look.tint === tint ? "border-paper" : "border-transparent"}`}
                  />
                ))}
              </div>
            </div>
            <div role="group" aria-label="Fittings">
              <p className="font-mono text-[11px] uppercase tracking-widest text-paper/60">Fittings</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {LOOK_TRIMS.map((name, trim) => (
                  <button
                    key={name}
                    type="button"
                    aria-pressed={look.trim === trim}
                    onClick={() => setPicked((current) => ({ ...current, trim }))}
                    className={chip(look.trim === trim)}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-xs leading-5 text-paper/60">
              Campaigns carry no pictures, so this object stands for yours. It goes to the Unmade
              Hall the moment the campaign opens, with a seat in front of it for every backer you
              ask for. Its look is written down in the same transaction.
            </p>
            <p className="border-l-2 border-lime pl-3 text-xs leading-5 text-paper/80">
              <span className="font-mono uppercase tracking-wider text-lime">Curator:</span> Tell me
              what you would build, how many seats it needs, and what you put on the line if they
              stay empty. Nothing can be changed once it is on the floor.
            </p>
          </div>
        </div>
        <div className="chamber chamber-form thin-scroll min-h-0 flex-1 px-5 py-5 lg:overflow-y-auto">
          <NewCampaignForm onOpened={(address) => onOpened(address, look)} onTitle={setTitle} look={look} />
        </div>
      </div>
    </Overlay>
  );
}
