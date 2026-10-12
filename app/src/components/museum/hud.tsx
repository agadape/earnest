"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

import { Frame } from "@/components/museum/chamber";
import type { Inspector } from "@/components/museum/inspector";
import { NewCampaignForm } from "@/components/new-campaign-form";
import { formatDuration, shortAddress, usd } from "@/lib/format";
import { type Kind, kindOf, STATUS_WORDS } from "@/lib/museum/plan";
import { buildEnd, type Campaign, type Status, statusAt } from "@/lib/tanda-jadi";

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
        {found.map((campaign) => {
          const status = statusAt(campaign, now);
          const address = campaign.address.toBase58();
          return (
            <li key={address}>
              <button
                type="button"
                onClick={() => onOpen(address)}
                className="block h-full w-full border border-paper/20 bg-paper/[0.03] p-3 text-left hover:border-lime hover:bg-lime/10 focus-visible:border-lime focus-visible:outline-none"
              >
                <span className="font-mono text-[10px] uppercase tracking-widest text-lime">
                  {STATUS_WORDS[status]}
                </span>
                <span className="mt-1 block text-sm font-semibold leading-5">
                  {campaign.title || "Untitled campaign"}
                </span>
                <span className="mt-2 block font-mono text-xs text-paper/65">
                  {campaign.backers}/{campaign.targetBackers} seats · {usd(campaign.price)} ·{" "}
                  {status === "funding"
                    ? `${formatDuration(campaign.deadline - now)} left`
                    : status === "building"
                      ? `${formatDuration(buildEnd(campaign) - now)} of building left`
                      : `by ${shortAddress(campaign.creator)}`}
                </span>
              </button>
            </li>
          );
        })}
        {found.length === 0 && (
          <li className="px-1 py-6 font-mono text-sm text-paper/60 sm:col-span-2 lg:col-span-3">
            Nothing on the board matches that.
          </li>
        )}
      </ol>
    </Overlay>
  );
}

/** One stand-in object on a turntable, for showing what a campaign will look like on the floor. */
function Turntable({ kind }: { kind: Kind }) {
  const stage = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    let cancelled = false;
    let created: Inspector | null = null;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    import("@/components/museum/inspector")
      .then(({ Inspector: Make }) => {
        if (!cancelled) created = new Make(element, kind, "funding", calm);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      created?.dispose();
    };
  }, [kind]);
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
  onOpened: (address: string) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const kind = kindOf({ title });

  return (
    <Overlay label="Design mode" kicker="At the curator's desk · design mode" title="Put a new exhibit on the floor" onClose={onClose}>
      <div className="thin-scroll flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        <div className="flex shrink-0 flex-col border-b border-paper/15 lg:w-80 lg:border-b-0 lg:border-r">
          <div className="h-56 lg:h-72">
            <Turntable kind={kind} />
          </div>
          <div className="space-y-3 px-5 pb-5">
            <p className="font-mono text-[11px] uppercase tracking-widest text-lime">On the plinth</p>
            <p className="font-mono text-sm leading-6 text-paper">
              {title.trim() || "Give it a title and it takes shape."}
            </p>
            <p className="text-xs leading-5 text-paper/60">
              The object is a stand-in picked from the title. It goes to the middle of the Unmade
              Hall the moment the campaign opens, with a seat in front of it for every backer you
              ask for.
            </p>
            <p className="border-l-2 border-lime pl-3 text-xs leading-5 text-paper/80">
              <span className="font-mono uppercase tracking-wider text-lime">Curator:</span> Tell me
              what you would build, how many seats it needs, and what you put on the line if they
              stay empty. Nothing can be changed once it is on the floor.
            </p>
          </div>
        </div>
        <div className="chamber chamber-form thin-scroll min-h-0 flex-1 px-5 py-5 lg:overflow-y-auto">
          <NewCampaignForm onOpened={onOpened} onTitle={setTitle} />
        </div>
      </div>
    </Overlay>
  );
}
