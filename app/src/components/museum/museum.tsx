"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CampaignList, NetworkNotice, SetupNotice } from "@/components/campaign-list";
import { Chamber } from "@/components/museum/chamber";
import type { Direction, MuseumScene } from "@/components/museum/scene";
import { useNow, usePolled, useProgram } from "@/lib/chain";
import { MINT } from "@/lib/env";
import { formatDuration, shortAddress } from "@/lib/format";
import { arrange, type Exhibit, type RoomId, ROOMS, STATUS_WORDS } from "@/lib/museum/plan";
import { buildEnd, fetchCampaigns } from "@/lib/tanda-jadi";

const WIDE = "(min-width: 1024px)";

/** One line under an exhibit's name: what state it is in, in words, and how full it is. */
function caption(exhibit: Exhibit, now: number): string {
  const { campaign, status } = exhibit;
  const seats = `${campaign.backers} of ${campaign.targetBackers} seats`;
  if (status === "funding") {
    return `${STATUS_WORDS[status]} · ${seats} · ${formatDuration(campaign.deadline - now)} left`;
  }
  if (status === "building") {
    return `${STATUS_WORDS[status]} · ${formatDuration(buildEnd(campaign) - now)} of building left`;
  }
  return `${STATUS_WORDS[status]} · ${seats}`;
}

/**
 * The museum: the building in three dimensions, with the things a page can say better than a
 * building laid over it. Everything a visitor can do here can also be done from the list of
 * exhibits beside the building, without a pointer and without the picture.
 */
export function Museum() {
  const program = useProgram();
  const now = useNow();
  const { publicKey } = useWallet();

  const load = useCallback(async () => {
    const campaigns = await fetchCampaigns(program);
    return campaigns.filter((campaign) => MINT !== null && campaign.mint.equals(MINT));
  }, [program]);
  const { data: campaigns, error } = usePolled(MINT ? load : null);

  const museum = useMemo(
    () => (campaigns && now !== null ? arrange(campaigns, now) : null),
    [campaigns, now],
  );
  // The clock ticks every second and the chain is asked every two; the building is only
  // rebuilt when something a visitor could see has changed.
  const signature = museum
    ? museum.exhibits
        .map(({ id, status, x, z, campaign }) => `${id}:${status}:${x}:${z}:${campaign.backers}`)
        .join("|")
    : null;
  // The same list object for as long as the signature holds.
  const hung = useMemo<Exhibit[]>(
    () => museum?.exhibits ?? [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signature],
  );

  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<MuseumScene | null>(null);
  const [ready, setReady] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [room, setRoom] = useState<RoomId>("unmade");
  const [selected, setSelected] = useState<string | null>(null);
  const [near, setNear] = useState<string | null>(null);
  // The plaque at the door: what this place is, for someone who has never heard of it.
  const [atDoor, setAtDoor] = useState(true);

  const select = useCallback((id: string | null) => {
    setSelected(id);
    // The address bar follows, so an open exhibit can be linked to and survives a reload.
    try {
      window.history.replaceState(null, "", id ? `/?exhibit=${id}` : "/");
    } catch {}
  }, []);

  // Start the scene once. Where WebGL is missing the list of campaigns takes its place.
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let cancelled = false;
    let created: MuseumScene | null = null;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    import("@/components/museum/scene")
      .then(({ MuseumScene: Scene }) => {
        if (cancelled) return;
        created = new Scene(
          element,
          {
            // The scene shows its own label beside what is pointed at.
            onHover: () => undefined,
            onSelect: (id) => select(id),
            onRoom: setRoom,
            onNear: setNear,
          },
          calm,
        );
        scene.current = created;
        setReady(true);
        const linked = new URLSearchParams(window.location.search).get("exhibit");
        if (linked) setSelected(linked);
      })
      .catch(() => {
        if (!cancelled) setUnsupported(true);
      });

    return () => {
      cancelled = true;
      created?.dispose();
      scene.current = null;
    };
  }, [select]);

  useEffect(() => {
    if (ready && signature !== null) scene.current?.setExhibits(hung);
  }, [ready, signature, hung]);

  useEffect(() => {
    if (!ready) return;
    const wide = window.matchMedia(WIDE).matches;
    scene.current?.setInsets(
      // The room's name and its list sit over the left of the floor on a wide window.
      wide ? 340 : 0,
      0,
      0,
    );
    scene.current?.setSelected(selected);
    // Depends on the signature too: an open exhibit that changes rooms is followed there.
  }, [ready, selected, signature]);

  useEffect(() => {
    if (ready) scene.current?.setVisitor(publicKey ? shortAddress(publicKey) : null);
  }, [ready, publicKey]);

  // The first look goes to a room with something in it, the main hall if it has anything.
  const greeted = useRef(false);
  useEffect(() => {
    if (!ready || !museum || greeted.current) return;
    greeted.current = true;
    const busiest = ROOMS.find(({ id }) => museum.counts[id] > 0);
    if (busiest && busiest.id !== "unmade" && !selected) scene.current?.focusRoom(busiest.id);
  }, [ready, museum, selected]);

  // Walking is done with the keyboard anywhere on the page, except while something is being
  // typed or a control has the keys: a button's own Enter and a text box's letters come first.
  useEffect(() => {
    const KEYS: Record<string, Direction> = {
      w: "up", a: "left", s: "down", d: "right",
      arrowup: "up", arrowleft: "left", arrowdown: "down", arrowright: "right",
    };
    const busy = (event: KeyboardEvent) => {
      const element = event.target;
      if (!(element instanceof Element) || element === document.body || element === host.current) {
        return false;
      }
      return element.closest("input, textarea, select, button, a, summary, dialog, aside, [contenteditable]") !== null;
    };
    const onDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (selected) select(null);
        else setAtDoor(false);
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey || busy(event) || atDoor) return;
      const direction = KEYS[event.key.toLowerCase()];
      if (direction) {
        event.preventDefault();
        scene.current?.key(direction, true);
      } else if ((event.key === "Enter" || event.key.toLowerCase() === "e") && near && !selected) {
        event.preventDefault();
        select(near);
      } else if (event.key === "+" || event.key === "=") {
        scene.current?.zoomBy(1.2);
      } else if (event.key === "-") {
        scene.current?.zoomBy(1 / 1.2);
      }
    };
    const onUp = (event: KeyboardEvent) => {
      const direction = KEYS[event.key.toLowerCase()];
      if (direction) scene.current?.key(direction, false);
    };
    const onBlur = () => scene.current?.release();
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [selected, select, near, atDoor]);

  if (!MINT) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <SetupNotice />
      </div>
    );
  }

  if (unsupported) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8 sm:px-6">
        <div className="rounded-2xl border border-stone-300 bg-white p-5">
          <h1 className="text-xl font-semibold">The museum needs 3D graphics this browser did not provide</h1>
          <p className="mt-2 text-sm leading-6 text-stone-600">
            Nothing is lost: every exhibit is a campaign, and they are all listed below.
          </p>
        </div>
        <CampaignList />
      </div>
    );
  }

  const here = ROOMS.find((candidate) => candidate.id === room) ?? ROOMS[0];
  const inRoom = museum?.exhibits.filter((exhibit) => exhibit.room === room) ?? [];
  const unhung = museum ? museum.counts[room] - inRoom.length : 0;
  const open = selected ? museum?.exhibits.find((exhibit) => exhibit.id === selected) : undefined;
  const nearby = near ? museum?.exhibits.find((exhibit) => exhibit.id === near) : undefined;

  return (
    <div className="absolute inset-0 overflow-hidden bg-carbon text-paper">
      <div
        ref={host}
        tabIndex={0}
        role="application"
        aria-label="The museum floor. W, A, S, D or the arrow keys walk; Enter opens the exhibit you stand next to; plus and minus zoom. The exhibits are also listed next to the floor."
        className="absolute inset-0 cursor-grab outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-lime"
      />

      {/* A shade behind the words on the left, so they never fight the floor for legibility. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-full bg-gradient-to-r from-carbon via-carbon/85 to-transparent sm:w-[30rem]"
      />
      {/* What a building cannot say: where you are, and what hangs here. */}
      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-4 sm:p-6">
        <div
          className={`pointer-events-auto max-w-sm ${selected ? "hidden lg:block" : ""}`}
        >
          <p className="font-mono text-xs uppercase tracking-widest text-lime">
            Room {here.code} · {museum ? museum.counts[room] : "…"}{" "}
            {museum?.counts[room] === 1 ? "exhibit" : "exhibits"}
          </p>
          <h1 className="mt-1 text-2xl font-semibold uppercase leading-none tracking-tight sm:text-5xl">
            {here.name}
          </h1>
          <p className="mt-3 hidden max-w-xs text-sm leading-6 text-paper/75 sm:block">{here.blurb}</p>

          {museum && inRoom.length === 0 && (
            <p className="mt-4 border-l-2 border-machine pl-3 text-sm text-paper/75">{here.empty}</p>
          )}
          {inRoom.length > 0 && (
            <details open className="group mt-4 max-w-xs">
              <summary className="cursor-pointer list-none font-mono text-xs uppercase tracking-widest text-paper/60 hover:text-paper">
                Exhibits in this room <span className="group-open:hidden">+</span>
                <span className="hidden group-open:inline">−</span>
              </summary>
              <ol className="thin-scroll mt-2 max-h-[19vh] space-y-1 overflow-y-auto pr-2 sm:max-h-[34vh]">
                {inRoom.map((exhibit) => (
                  <li key={exhibit.id}>
                    <button
                      type="button"
                      aria-current={exhibit.id === selected ? "true" : undefined}
                      onClick={() => select(exhibit.id)}
                      onFocus={() => scene.current?.setHot(exhibit.id)}
                      onBlur={() => scene.current?.setHot(null)}
                      onMouseEnter={() => scene.current?.setHot(exhibit.id)}
                      onMouseLeave={() => scene.current?.setHot(null)}
                      className={`block w-full border-l-2 px-3 py-1.5 text-left transition-colors hover:border-lime hover:bg-paper/10 focus-visible:outline-2 focus-visible:outline-lime ${
                        exhibit.id === selected ? "border-lime bg-paper/10" : "border-paper/20"
                      }`}
                    >
                      <span className="font-mono text-[11px] text-lime">{exhibit.code}</span>
                      <span className="block text-sm font-medium leading-5">
                        {exhibit.campaign.title || "Untitled campaign"}
                      </span>
                      <span className="block text-xs text-paper/65">
                        {now === null ? STATUS_WORDS[exhibit.status] : caption(exhibit, now)}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
              {unhung > 0 && (
                <p className="mt-2 text-xs leading-5 text-paper/60">
                  {unhung} more {unhung === 1 ? "is" : "are"} in storage: this room has no floor
                  left. Find {unhung === 1 ? "it" : "them"} in the{" "}
                  <Link href="/catalog" className="text-lime underline underline-offset-2">
                    catalog
                  </Link>
                  .
                </p>
              )}
            </details>
          )}
        </div>

        <div className={`flex flex-wrap items-end justify-between gap-3 ${selected ? "hidden lg:flex" : ""}`}>
          <nav aria-label="Rooms" className="pointer-events-auto">
            <p className="font-mono text-[11px] uppercase tracking-widest text-paper/60">Directory</p>
            <ul className="mt-1.5 flex max-w-[calc(100vw-2rem)] gap-1.5 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
              {ROOMS.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    aria-current={entry.id === room ? "true" : undefined}
                    onClick={() => scene.current?.focusRoom(entry.id)}
                    className={`flex h-9 shrink-0 items-center gap-2 whitespace-nowrap border px-3 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-lime ${
                      entry.id === room
                        ? "border-lime bg-lime text-carbon"
                        : "border-paper/30 bg-carbon/80 text-paper hover:border-paper"
                    }`}
                  >
                    <span className="font-mono text-xs">{entry.code}</span>
                    {entry.name.replace(/^The /, "")}
                    <span className="font-mono text-xs opacity-70">
                      {museum ? museum.counts[entry.id] : "·"}
                    </span>
                  </button>
                </li>
              ))}
              <li>
                <button
                  type="button"
                  onClick={() => scene.current?.overview()}
                  className="flex h-9 shrink-0 items-center whitespace-nowrap border border-paper/30 bg-carbon/80 px-3 text-sm text-paper transition-colors hover:border-paper focus-visible:outline-2 focus-visible:outline-lime"
                >
                  Whole building
                </button>
              </li>
            </ul>
            <p className="mt-2 hidden max-w-md text-xs leading-5 text-paper/60 sm:block">
              {publicKey ? (
                <>
                  You are walking the floor as{" "}
                  <span className="font-mono text-paper">{shortAddress(publicKey)}</span>. Visiting
                  pledges nothing; only taking a seat does. The other figures are scenery: this
                  museum does not track who is in it.
                </>
              ) : (
                "You are walking as a guest. Connect a wallet and your figure carries its address. The other figures are scenery, not people."
              )}
            </p>
          </nav>

          <div className="pointer-events-auto flex items-center gap-1.5">
            <p className="mr-2 hidden bg-carbon/85 px-3 py-2 text-xs text-paper/80 md:block">
              WASD or arrows walk · click the floor to go there · drag to look · scroll to zoom
            </p>
            {(
              [
                ["Zoom out", "−", 1 / 1.25],
                ["Zoom in", "+", 1.25],
              ] as const
            ).map(([label, sign, factor]) => (
              <button
                key={label}
                type="button"
                aria-label={label}
                onClick={() => scene.current?.zoomBy(factor)}
                className="flex h-9 w-9 items-center justify-center border border-paper/30 bg-carbon/80 text-lg leading-none hover:border-paper focus-visible:outline-2 focus-visible:outline-lime"
              >
                {sign}
              </button>
            ))}
            <Link
              href="/catalog"
              className="flex h-9 items-center border border-paper/30 bg-carbon/80 px-3 text-sm hover:border-paper focus-visible:outline-2 focus-visible:outline-lime"
            >
              Catalog
            </Link>
          </div>
        </div>
      </div>

      {nearby && !selected && !atDoor && (
        <div className="pointer-events-none absolute inset-x-0 bottom-24 z-10 flex justify-center px-4 sm:bottom-28">
          <button
            type="button"
            onClick={() => select(nearby.id)}
            className="pointer-events-auto flex max-w-full items-center gap-3 border border-carbon bg-lime px-4 py-2 text-left text-carbon shadow-xl hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime"
          >
            <span className="hidden border border-carbon px-1.5 py-0.5 font-mono text-[11px] sm:inline">
              Enter
            </span>
            <span className="min-w-0">
              <span className="block font-mono text-[11px] uppercase tracking-wider">
                Open exhibit {nearby.code}
              </span>
              <span className="block truncate text-sm font-semibold">
                {nearby.campaign.title || "Untitled campaign"}
              </span>
            </span>
          </button>
        </div>
      )}

      {!museum && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
          {error ? (
            <div className="pointer-events-auto max-w-md">
              <NetworkNotice />
            </div>
          ) : (
            <p aria-busy className="font-mono text-xs uppercase tracking-widest text-paper/70">
              Opening the museum…
            </p>
          )}
        </div>
      )}

      {selected && (
        <Chamber
          address={selected}
          exhibit={open}
          now={now}
          onBack={() => select(null)}
          onMap={() => {
            select(null);
            scene.current?.overview();
          }}
        />
      )}
    </div>
  );
}
