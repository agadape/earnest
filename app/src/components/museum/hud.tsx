"use client";

import { PublicKey } from "@solana/web3.js";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { useCreatorCampaigns } from "@/components/creator-record";
import { Frame } from "@/components/museum/chamber";
import type { Inspector } from "@/components/museum/inspector";
import type { Shelf } from "@/components/museum/shelf";
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
  looks,
  onOpen,
  onClose,
}: {
  address: string;
  now: number | null;
  /** The looks creators chose for their objects, by campaign address. */
  looks: ReadonlyMap<string, Look>;
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
  // The shelf: every object this creator has put in the museum, in the order of the list below.
  const stage = useRef<HTMLDivElement>(null);
  const shelf = useRef<Shelf | null>(null);
  const things =
    campaigns && now !== null
      ? campaigns.map((campaign) => ({
          look: looks.get(campaign.address.toBase58()) ?? lookOf(campaign),
          status: statusAt(campaign, now),
        }))
      : null;
  // As text, so that the shelf is rebuilt when what stands on it changes and not every second.
  const shown = things ? JSON.stringify(things) : null;
  useEffect(() => {
    const element = stage.current;
    if (!element || !shown) return;
    let cancelled = false;
    let created: Shelf | null = null;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let who = 0;
    for (const letter of address) who = (who * 31 + letter.charCodeAt(0)) % 9973;
    import("@/components/museum/shelf")
      .then(({ Shelf: Make }) => {
        if (cancelled) return;
        created = new Make(element, JSON.parse(shown), who, calm);
        shelf.current = created;
      })
      // Without 3D the words and the cards below still say everything.
      .catch(() => undefined);
    return () => {
      cancelled = true;
      created?.dispose();
      shelf.current = null;
    };
  }, [shown, address]);

  const word = (text: string) => (
    <p className="toy-card mx-auto mt-10 w-max max-w-[90%] px-5 py-4 text-sm font-bold">{text}</p>
  );
  const ribbon: Record<Status, string> = {
    funding: "bg-[#b8e86a]",
    building: "bg-[#ffcf5c]",
    completed: "bg-[#8ed1f0]",
    failed: "bg-[#d8d0bd]",
    braked: "bg-[#ff9a7a]",
  };

  return (
    <section
      aria-label="Creator record"
      className="gallery-ground absolute inset-0 z-20 flex flex-col overflow-y-auto text-toy-ink lg:overflow-hidden"
    >
      <header className="flex shrink-0 flex-wrap items-start justify-between gap-3 px-4 pt-4 sm:px-6 sm:pt-5">
        <div className="toy-card min-w-0 max-w-full px-5 py-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-toy-ink/60">A maker and what they made</p>
          <h1 className="mt-0.5 text-2xl font-extrabold leading-tight tracking-tight sm:text-3xl">
            {creator ? `Maker ${shortAddress(creator)}` : "Maker"}
          </h1>
          {record && campaigns && (
            <p className="mt-1 text-sm font-bold text-toy-ink/70">
              {campaigns.length === 0 ? "No campaigns from this wallet" : describeRecord(record)}
            </p>
          )}
        </div>
        <button type="button" onClick={onClose} className="toy-button">
          ← Back <span className="hidden text-[10px] font-bold opacity-50 sm:inline">esc</span>
        </button>
      </header>

      {!creator ? (
        word("That is not a wallet address. Check the link and try again.")
      ) : campaigns === null ? (
        word("The network did not answer. Go back and try again in a moment.")
      ) : !campaigns || !record || now === null ? (
        word("Fetching what this maker made…")
      ) : (
        <>
          {/* The maker and their shelf. Drag it along; a card below brings its object forward. */}
          <div ref={stage} aria-hidden className="h-[34vh] min-h-52 shrink-0 lg:h-[40vh]" />

          <div className="thin-scroll min-h-0 flex-1 px-4 pb-6 sm:px-6 lg:overflow-y-auto">
            <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {totals.map(({ label, value, note }) => (
                <div key={label} className="toy-card px-4 py-3">
                  <dt className="text-[11px] font-bold uppercase tracking-wide text-toy-ink/60">{label}</dt>
                  <dd className="text-3xl font-extrabold leading-tight">{value}</dd>
                  {note && <dd className="mt-0.5 text-xs font-semibold leading-5 text-toy-ink/65">{note}</dd>}
                </div>
              ))}
            </dl>

            {campaigns.length > 0 && (
              <ol aria-label="Their campaigns, newest first" className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {campaigns.map((campaign, index) => {
                  const status = statusAt(campaign, now);
                  return (
                    <li key={campaign.address.toBase58()}>
                      <button
                        type="button"
                        onClick={() => onOpen(campaign.address.toBase58())}
                        onMouseEnter={() => shelf.current?.mark(index)}
                        onMouseLeave={() => shelf.current?.mark(-1)}
                        onFocus={() => shelf.current?.mark(index)}
                        onBlur={() => shelf.current?.mark(-1)}
                        className="toy-card block h-full w-full overflow-hidden text-left transition-transform hover:-translate-y-1 focus-visible:-translate-y-1 focus-visible:outline-none"
                      >
                        <span className={`block border-b-[3px] border-toy-ink px-4 py-1.5 text-xs font-extrabold uppercase tracking-wide ${ribbon[status]}`}>
                          {STATUS_WORDS[status]}
                        </span>
                        <span className="block px-4 py-3">
                          <span className="block text-base font-extrabold leading-snug">
                            {campaign.title || "Untitled campaign"}
                          </span>
                          <span className="mt-1 block text-xs font-bold text-toy-ink/60">
                            {campaign.backers}/{campaign.targetBackers} seats · {usd(campaign.price)} a seat
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}

            <p className="toy-card mt-5 max-w-4xl bg-[#fff3d6] px-5 py-3 text-sm font-medium leading-6">
              All of this is read from the campaigns this wallet opened. A campaign that didn&apos;t fill is
              not a black mark: the maker asked before building, and paid the bonus they promised. Two
              things this cannot tell you: a maker can start over with a new wallet, so an empty shelf
              says nothing either way, and nothing stops a maker from backing a small campaign of their
              own to the end.
            </p>
          </div>
        </>
      )}
    </section>
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
  known,
  chosen,
  onChoose,
  style,
  onStyle,
  onDone,
  onCancel,
}: {
  campaign: Campaign;
  /** Which campaign stands on which plot now, by plot number. */
  owners: ReadonlyMap<number, string>;
  /** Whether it is known yet which plots are taken. Until it is, none can be signed for. */
  known: boolean;
  chosen: number | null;
  onChoose: (plot: number) => void;
  /** The floor colour picked, as a number into the list of floors. */
  style: number;
  onStyle: (style: number) => void;
  /** Told which plot was signed for, and with which floor. */
  onDone: (built: Plot) => void;
  onCancel: () => void;
}) {
  const { send, busy } = useSend();
  const claim = async (plot: number) => {
    const sent = await send("plot", {
      pending: "Signing for the plot",
      done: `Room built on plot E-${String(plot + 1).padStart(2, "0")}`,
      build: async (payer) => [claimPlotIx(payer, campaign.address, plot, style)],
    });
    if (sent) onDone({ plot, style });
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
              sign for a plot has it. A room is built once: it cannot be moved or changed
              afterwards, so choose with care. Without a room it stands in the hall its state
              puts it in.
            </p>
            <div role="group" aria-label="Floor colour" className="mt-3 flex items-center gap-1.5">
              {ROOM_FLOORS.map((color, index) => (
                <button
                  key={color}
                  type="button"
                  aria-label={`Floor colour ${index + 1}`}
                  aria-pressed={style === index}
                  onClick={() => onStyle(index)}
                  style={{ backgroundColor: color }}
                  className={`h-7 w-9 border-2 ${style === index ? "border-lime" : "border-paper/20"}`}
                />
              ))}
            </div>
          </div>
          <div className="shrink-0">
            <div role="group" aria-label="Plots" className="grid grid-cols-6 gap-1">
              {PLOTS.map((_, plot) => {
                const taken = owners.has(plot);
                return (
                  <button
                    key={plot}
                    type="button"
                    disabled={taken || !known}
                    aria-pressed={chosen === plot}
                    aria-label={`Plot ${plot + 1}${taken ? ", taken" : ", free"}`}
                    onClick={() => onChoose(plot)}
                    className={`h-8 w-10 border font-mono text-xs ${
                      chosen === plot
                        ? "border-lime bg-lime text-carbon"
                        : taken
                          ? "border-paper/10 text-paper/25 line-through"
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
                disabled={chosen === null || busy !== null || !known}
                onClick={() => chosen !== null && claim(chosen)}
                className="h-9 bg-lime px-4 font-mono text-xs font-semibold uppercase tracking-wider text-carbon hover:bg-white disabled:opacity-40"
              >
                {!known
                  ? "Checking which plots are free…"
                  : chosen === null
                    ? "Pick a plot"
                    : `Sign and build on E-${String(chosen + 1).padStart(2, "0")}`}
              </button>
              <button type="button" onClick={onCancel} className="hud-button">
                Not now <span className="hidden font-mono text-[10px] opacity-60 sm:inline">esc</span>
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
