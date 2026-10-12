"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CampaignList, NetworkNotice, SetupNotice } from "@/components/campaign-list";
import { CampaignView } from "@/components/campaign-view";
import { useToasts } from "@/components/toasts";
import { Chamber } from "@/components/museum/chamber";
import { Board, CreatorRecord, DesignMode, PlotPicker } from "@/components/museum/hud";
import type { Direction, MuseumScene } from "@/components/museum/scene";
import type { Plot } from "@/lib/ledger";
import { Cutscene, SCENES } from "@/components/museum/cutscene";
import { useNotes } from "@/components/museum/use-notes";
import { useNow, usePolled, useProgram } from "@/lib/chain";
import { MINT } from "@/lib/env";
import { formatDuration, shortAddress } from "@/lib/format";
import { arrange, type Exhibit, type Look, ROOM_FLOORS, type RoomId, ROOMS, STATIONS, STATUS_WORDS, stored } from "@/lib/museum/plan";
import { buildEnd, fetchCampaigns } from "@/lib/tanda-jadi";

const WIDE = "(min-width: 1024px)";
type Panel = "board" | "design" | "record";
// What `select` is given to open a creator's file: this, then the wallet's address.
const CREATOR = "@creator:";
// Set in this browser once the introduction has played, so it plays once.
const INTRO_SEEN = "earnest:intro-seen";
// Set once the line of controls has been shown.
const HINTED = "earnest:hinted";
const PANEL_OF: Record<string, Panel> = { "@board": "board", "@desk": "design" };

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

/** A name for this browser tab among the visitors: random, and forgotten when the tab closes. */
function visitorId(): string {
  const fresh = () => crypto.randomUUID().replace(/-/g, "").slice(0, 24);
  try {
    const kept = window.sessionStorage.getItem("earnest:visitor");
    if (kept) return kept;
    const made = fresh();
    window.sessionStorage.setItem("earnest:visitor", made);
    return made;
  } catch {
    return fresh();
  }
}

/**
 * The museum: the building in three dimensions, with the things a page can say better than a
 * building laid over it. Everything a visitor can do here can also be done from the lists
 * beside the floor, without a pointer and without the picture.
 */
export function Museum({ exhibit: givenExhibit, creator: givenCreator }: { exhibit?: string; creator?: string }) {
  const program = useProgram();
  const now = useNow();
  const { publicKey } = useWallet();
  const params = useSearchParams();

  const load = useCallback(async () => {
    const campaigns = await fetchCampaigns(program);
    return campaigns.filter((campaign) => MINT !== null && campaign.mint.equals(MINT));
  }, [program]);
  const { data: campaigns, error } = usePolled(MINT ? load : null);

  // What is written on chain beside the campaigns: reactions, and the rooms creators built.
  const toasts = useToasts();
  const { reactions, plots: readPlots, ready: plotsKnown, looks: readLooks, mine: reactedByMe, inDatabase, accept, reload: reloadNotes } = useNotes(campaigns);
  // A campaign opened a moment ago wears the look its creator just chose, without waiting for
  // the note about it to be read back from the chain.
  const [justMade, setJustMade] = useState<Record<string, Look>>({});
  const looks = useMemo(
    () => new Map<string, Look>([...Object.entries(justMade), ...readLooks]),
    [justMade, readLooks],
  );
  // A room signed for a moment ago stands at once, without waiting for the claim to be read
  // back from the chain. If the reading then says someone else signed for that plot first,
  // it is taken down again and its creator is told.
  const [justBuilt, setJustBuilt] = useState<Record<string, Plot>>({});
  const plots = useMemo(() => {
    const all = new Map(readPlots);
    const takenBy = new Map<number, string>();
    for (const [id, built] of readPlots) takenBy.set(built.plot, id);
    for (const [id, built] of Object.entries(justBuilt)) {
      if (all.has(id) || takenBy.has(built.plot)) continue;
      all.set(id, built);
    }
    return all;
  }, [readPlots, justBuilt]);
  // A room this browser built that the chain gave to another campaign.
  const beaten = Object.entries(justBuilt).find(([id, built]) => {
    if (readPlots.has(id)) return false;
    return [...readPlots].some(([other, theirs]) => other !== id && theirs.plot === built.plot);
  })?.[0];
  const reacted = useMemo(() => {
    const totals = new Map<string, number>();
    for (const [id, counts] of reactions) totals.set(id, counts.want + counts.clever + counts.watching);
    return totals;
  }, [reactions]);
  /** Reads the notes again now, and once more when the network has surely caught up. */
  const noted = useCallback(() => {
    reloadNotes();
    setTimeout(reloadNotes, 3500);
  }, [reloadNotes]);

  const museum = useMemo(
    () => (campaigns && now !== null ? arrange(campaigns, now, plots, reacted, looks) : null),
    [campaigns, now, plots, reacted, looks],
  );
  // The clock ticks every second and the chain is asked every two; the building is only
  // rebuilt when something a visitor could see has changed.
  const signature = museum
    ? museum.exhibits
        .map(
          ({ id, status, x, z, campaign, style, kind, tint, trim, reactions: given }) =>
            `${id}:${status}:${x}:${z}:${campaign.backers}:${style ?? ""}:${Math.min(given, 10)}:${kind}:${tint}:${trim}`,
        )
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
  // Counts the scenes made so far; zero while there is none. Coming back to this page makes a
  // new scene, and everything the scene has to be told is told again because this changed.
  const [sceneId, setSceneId] = useState(0);
  const [unsupported, setUnsupported] = useState(false);
  const [room, setRoom] = useState<RoomId>("unmade");
  const [selected, setSelected] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [creator, setCreator] = useState<string | null>(null);
  const [untouched, setUntouched] = useState(true);
  // Whether the words about the room are laid over the left of the floor. Folded away, only
  // the room's name is left, and the floor is all picture.
  const [notes, setNotes] = useState(false);
  // The dock's two small panels, and the line of controls shown to a first-time visitor.
  const [help, setHelp] = useState(false);
  const [more, setMore] = useState(false);
  const [hint, setHint] = useState(false);
  const dismissHint = useCallback(() => {
    setHint(false);
    try {
      window.localStorage.setItem(HINTED, "1");
    } catch {}
  }, []);
  useEffect(() => {
    let seen = true;
    try {
      seen = window.localStorage.getItem(HINTED) !== null;
    } catch {}
    if (seen) return;
    // Shown once: it goes after a few seconds, or at the first key or click on the floor.
    const show = setTimeout(() => setHint(true), 0);
    const hide = setTimeout(dismissHint, 9000);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [dismissHint]);
  // The reminder that one of the visitor's campaigns has no room yet, until they wave it away.
  const [reminded, setReminded] = useState(true);
  // The introduction: which scene it is at, or `null` when it is not playing.
  const [intro, setIntro] = useState<number | null>(null);
  // Build mode: the campaign whose creator is choosing a plot, and the plot picked so far.
  const [placing, setPlacing] = useState<string | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [near, setNear] = useState<string | null>(null);
  const [here, setHere] = useState<number | null>(null);
  // The plaque at the door: what this place is, for someone who has never heard of it.
  const [atDoor, setAtDoor] = useState(true);

  /** Opens an exhibit, a station's panel, a creator's file, or nothing. The address bar follows. */
  const select = useCallback((id: string | null) => {
    const who = id?.startsWith(CREATOR) ? id.slice(CREATOR.length) : null;
    const station: Panel | undefined = who ? "record" : id ? PANEL_OF[id] : undefined;
    setSelected(station ? null : id);
    setPanel(station ?? null);
    setCreator(who);
    setUntouched(false);
    try {
      window.history.replaceState(
        null,
        "",
        who ? `/?creator=${who}` : station ? `/?${station}=1` : id ? `/?exhibit=${id}` : "/",
      );
    } catch {}
  }, []);

  // What a click on the floor means depends on whether a plot is being chosen. The scene
  // outlives that, so it is handed a way to ask instead of the answer.
  useEffect(() => {
    if (!beaten) return;
    const timer = setTimeout(() => {
      setJustBuilt((made) => Object.fromEntries(Object.entries(made).filter(([id]) => id !== beaten)));
      toasts.show("error", "Someone signed for that plot just before you. Pick another one.");
      setChosen(null);
      setPlacing(beaten);
    }, 0);
    return () => clearTimeout(timer);
  }, [beaten, toasts]);

  const picked = useRef<(id: string | null) => void>(select);
  useEffect(() => {
    picked.current = (id) => {
      if (id?.startsWith("@plot:")) setChosen(Number(id.slice(6)));
      else if (!placing) select(id);
    };
  }, [placing, select]);

  const owners = useMemo(() => {
    const byPlot = new Map<number, string>();
    for (const [id, built] of plots) byPlot.set(built.plot, id);
    return byPlot;
  }, [plots]);
  const free = ROOMS[ROOMS.length - 1].slots.map((_, plot) => plot).filter((plot) => !owners.has(plot));
  const freeKey = free.join(",");
  // A plot picked a moment ago may have been taken since; then nothing is picked.
  const pick = chosen !== null && !owners.has(chosen) ? chosen : null;
  const [floor, setFloor] = useState(0);
  useEffect(() => {
    if (!sceneId) return;
    scene.current?.setPlacing(
      // Until the plots have been read once, none is offered: any of them might be taken.
      placing && plotsKnown ? freeKey.split(",").filter(Boolean).map(Number) : null,
      pick,
      ROOM_FLOORS[floor],
    );
  }, [sceneId, placing, plotsKnown, freeKey, pick, floor]);
  // In build mode the camera looks at the annex, raised clear of the panel at the foot of
  // the window. The visitor stays where they are.
  useEffect(() => {
    if (!sceneId || !placing) return;
    scene.current?.setInsets(0, 0, 250);
    scene.current?.lookAt("annex");
  }, [sceneId, placing]);

  /** Starts build mode for a campaign: the chamber closes and the view goes to the annex. */
  const place = useCallback(
    (id: string) => {
      select(null);
      setAtDoor(false);
      setPlacing(id);
      setChosen(null);
    },
    [select],
  );

  // A link can ask for an exhibit, a creator's file, the board or the desk. Links in the
  // header do, and so do the addresses that used to be pages of their own.
  // What the address itself named counts until the visitor opens or closes something.
  const linkedExhibit = params.get("exhibit") ?? (untouched ? givenExhibit : null) ?? null;
  const linkedCreator = params.get("creator") ?? (untouched ? givenCreator : null) ?? null;
  const linkedPanel: Panel | null = linkedCreator
    ? "record"
    : params.has("board")
      ? "board"
      : params.has("design")
        ? "design"
        : null;
  useEffect(() => {
    if (!linkedExhibit && !linkedPanel) return;
    // Arriving by a link is past the door already.
    const timer = setTimeout(() => {
      setAtDoor(false);
      setSelected(linkedExhibit);
      setPanel(linkedExhibit ? null : linkedPanel);
      setCreator(linkedExhibit ? null : linkedCreator);
    }, 0);
    return () => clearTimeout(timer);
  }, [linkedExhibit, linkedPanel, linkedCreator]);

  // Start the scene. Where WebGL is missing the list of campaigns takes its place.
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
            onSelect: (id) => picked.current(id),
            onRoom: setRoom,
            onNear: setNear,
          },
          calm,
        );
        scene.current = created;
        setSceneId((count) => count + 1);
        // Coming back to this page by a plain link to it means the floor, not whatever was
        // open when it was left.
        // An address that names an exhibit or a creator keeps what it named.
        if (window.location.pathname !== "/") return;
        const asked = new URLSearchParams(window.location.search);
        if (!asked.has("exhibit")) setSelected(null);
        if (!asked.has("board") && !asked.has("design") && !asked.has("creator")) setPanel(null);
      })
      .catch(() => {
        if (!cancelled) setUnsupported(true);
      });

    return () => {
      cancelled = true;
      created?.dispose();
      scene.current = null;
      // This page is kept alive in the background when another is opened. Its scene is not:
      // say so, or the next scene would never be given the exhibits.
      setSceneId(0);
    };
  }, [select]);

  useEffect(() => {
    if (sceneId && signature !== null) scene.current?.setExhibits(hung);
  }, [sceneId, signature, hung]);

  useEffect(() => {
    if (!sceneId) return;
    // The room's name and its list sit over the left of the floor on a wide window.
    // During the introduction the lower black bar is the taller one; what is looked at sits above it.
    if (!placing) {
      scene.current?.setInsets(
        intro === null && notes && window.matchMedia(WIDE).matches ? 340 : 0,
        0,
        intro === null ? 0 : 110,
      );
    }
    scene.current?.setSelected(selected);
    // The chamber covers the whole floor; there is no point drawing what cannot be seen.
    scene.current?.setPaused(selected !== null);
    // Depends on the signature too: an open exhibit that changes rooms is followed there.
  }, [sceneId, selected, signature, intro, notes, placing]);

  useEffect(() => {
    if (sceneId) scene.current?.setVisitor(publicKey ? shortAddress(publicKey) : null);
  }, [sceneId, publicKey]);

  // The first look goes to a room with something in it, the main hall if it has anything.
  const greeted = useRef(false);
  useEffect(() => {
    if (!sceneId || !museum || greeted.current) return;
    greeted.current = true;
    const busiest = ROOMS.find(({ id }) => museum.counts[id] > 0);
    if (busiest && busiest.id !== "unmade" && !selected) scene.current?.focusRoom(busiest.id);
  }, [sceneId, museum, selected]);

  // Tell the others where this visitor stands, once a second, and learn where they are.
  const name = publicKey ? shortAddress(publicKey) : "Guest";
  const hasWallet = publicKey !== null;
  useEffect(() => {
    if (!sceneId) return;
    const id = visitorId();
    let stopped = false;
    const beat = async () => {
      const at = scene.current?.whereabouts();
      // A tab nobody is looking at stops reporting, and so drops out of the museum for the others.
      if (!at || document.hidden) return;
      try {
        const response = await fetch("/api/presence", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, name, wallet: hasWallet, x: at.x, z: at.z }),
        });
        if (!response.ok || stopped) return;
        const result = (await response.json()) as {
          others: { id: string; name: string; wallet: boolean; x: number; z: number }[];
          here: number;
        };
        scene.current?.setOthers(result.others);
        setHere(result.here);
      } catch {
        // Alone is a fine way to visit a museum; the next beat tries again.
      }
    };
    beat();
    const timer = setInterval(beat, 1000);
    return () => {
      stopped = true;
      clearInterval(timer);
      try {
        navigator.sendBeacon?.("/api/presence", JSON.stringify({ id, leave: true }));
      } catch {}
    };
  }, [sceneId, name, hasWallet]);

  // The wallets that came before stroll the rooms. This one is written down as having come.
  const [strollers, setStrollers] = useState<string[]>([]);
  const visitor = publicKey?.toBase58() ?? null;
  useEffect(() => {
    let active = true;
    const ask = async (wallet: string | null) => {
      try {
        const response = await fetch(
          "/api/visitors",
          wallet
            ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wallet }) }
            : undefined,
        );
        const { wallets } = (await response.json()) as { wallets?: string[] };
        if (active && Array.isArray(wallets)) setStrollers(wallets);
      } catch {
        // An empty museum is still a museum.
      }
    };
    ask(visitor);
    const timer = setInterval(() => ask(null), 60_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [visitor]);
  const strollerKey = strollers.filter((wallet) => wallet !== visitor).join(",");
  useEffect(() => {
    if (!sceneId) return;
    scene.current?.setWanderers(
      strollerKey
        .split(",")
        .filter(Boolean)
        .map((wallet) => ({ id: wallet, name: `${wallet.slice(0, 4)}…${wallet.slice(-4)}` })),
    );
  }, [sceneId, strollerKey]);

  // Each scene of the introduction looks at a room. Only the camera goes; the visitor stays.
  useEffect(() => {
    if (!sceneId || intro === null) return;
    scene.current?.lookAt(SCENES[intro]?.room ?? null);
  }, [sceneId, intro]);

  // While it plays, signposts stand on the floor at what each scene talks about. They belong
  // to the introduction alone and go when it ends.
  const signposts = useMemo(() => {
    if (intro === null) return "[]";
    const first = (id: RoomId) => museum?.exhibits.find((exhibit) => exhibit.room === id);
    const centre = (id: RoomId) => ROOMS.find((entry) => entry.id === id) ?? ROOMS[0];
    const at = (id: RoomId, text: string) => {
      const spot = first(id) ?? centre(id);
      return { x: spot.x, z: spot.z, text };
    };
    const idea = first("unmade");
    const scenes: { x: number; z: number; text: string; high?: boolean }[][] = [
      [
        { ...centre("unmade"), text: "Ideas waiting", high: true },
        { ...centre("workshop"), text: "Being made", high: true },
        { ...centre("realized"), text: "Made", high: true },
        { ...centre("almost"), text: "Didn't make it", high: true },
        { ...centre("annex"), text: "Makers' rooms", high: true },
      ].map(({ x, z, text, high }) => ({ x, z, text, high })),
      idea
        ? [
            { x: idea.x, z: idea.z, text: "An idea", high: true },
            { x: idea.x, z: idea.z + 1.3, text: "Its seats" },
          ]
        : [at("unmade", "Ideas wait here")],
      [at("workshop", "Being made")],
      [at("almost", "Deposits went back")],
      [at("annex", first("annex") ? "A maker's room" : "Makers build here")],
      [
        { x: STATIONS[0].x, z: STATIONS[0].z, text: "All ideas", high: true },
        { x: STATIONS[1].x, z: STATIONS[1].z, text: "Start your own", high: true },
      ],
    ];
    return JSON.stringify(scenes[intro] ?? []);
    // The signature stands for the exhibits: the signposts move only when they do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intro, signature]);
  useEffect(() => {
    if (sceneId) scene.current?.setMarks(JSON.parse(signposts));
  }, [sceneId, signposts]);

  // The introduction plays by itself the first time a wallet connects in this browser.
  const connected = publicKey !== null;
  useEffect(() => {
    if (!connected || !sceneId) return;
    let seen = true;
    try {
      seen = window.localStorage.getItem(INTRO_SEEN) !== null;
      window.localStorage.setItem(INTRO_SEEN, "1");
    } catch {
      // Without storage there is no telling a first visit from a tenth; do not replay it forever.
    }
    // Someone who came by a link to an exhibit or a panel came for that, not for a film.
    if (seen || window.location.pathname !== "/" || window.location.search !== "") return;
    const timer = setTimeout(() => {
      setAtDoor(false);
      setIntro(0);
    }, 0);
    return () => clearTimeout(timer);
  }, [connected, sceneId]);

  /** Ends the introduction: the view goes back to the visitor, wherever they stand. */
  const endIntro = useCallback(() => {
    setIntro(null);
    scene.current?.focusRoom("unmade");
  }, []);

  // Walking is done with the keyboard anywhere on the page, except while something is being
  // typed or a control has the keys: a button's own Enter and a text box's letters come first.
  // Build mode is for choosing a plot and nothing else: no walking off, no opening exhibits.
  const covered = selected !== null || panel !== null || atDoor || intro !== null || placing !== null;
  useEffect(() => {
    const KEYS: Record<string, Direction> = {
      w: "up",
      a: "left",
      s: "down",
      d: "right",
      arrowup: "up",
      arrowleft: "left",
      arrowdown: "down",
      arrowright: "right",
    };
    const busy = (event: KeyboardEvent) => {
      const element = event.target;
      if (!(element instanceof Element) || element === document.body || element === host.current) {
        return false;
      }
      return (
        element.closest("input, textarea, select, button, a, summary, dialog, [contenteditable]") !== null
      );
    };
    const onDown = (event: KeyboardEvent) => {
      // While the introduction plays, the keys only turn its pages.
      if (intro !== null) {
        if (event.key === "Escape") endIntro();
        // A button that has the keys answers to the space bar itself.
        else if (event.target instanceof HTMLButtonElement && event.key === " ") return;
        else if (event.key === " " || event.key === "ArrowRight") {
          event.preventDefault();
          if (intro < SCENES.length - 1) setIntro(intro + 1);
        } else if (event.key === "ArrowLeft" && intro > 0) setIntro(intro - 1);
        return;
      }
      if (event.key === "Escape") {
        if (placing) setPlacing(null);
        else if (selected || panel) select(null);
        else setAtDoor(false);
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey || busy(event) || covered) return;
      const direction = KEYS[event.key.toLowerCase()];
      if (direction) {
        event.preventDefault();
        scene.current?.key(direction, true);
      } else if ((event.key === "Enter" || event.key.toLowerCase() === "e") && near) {
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
  }, [selected, panel, select, near, covered, placing, intro, endIntro]);

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
        <div className="rounded-md border border-stone-300 bg-white p-5 text-stone-900">
          <h1 className="text-xl font-semibold">The museum needs 3D graphics this browser did not provide</h1>
          <p className="mt-2 text-sm leading-6 text-stone-600">
            Nothing is lost: every exhibit is a campaign, and they are all listed below.
          </p>
        </div>
        {selected ? (
          <>
            <button type="button" onClick={() => select(null)} className="text-sm font-medium underline underline-offset-2">
              Back to every campaign
            </button>
            <CampaignView address={selected} />
          </>
        ) : (
          <CampaignList searchable />
        )}
        {panel === "record" && creator && (
          <CreatorRecord address={creator} now={now} looks={looks} onOpen={select} onClose={() => select(null)} />
        )}
        {panel === "design" && <DesignMode onOpened={select} onClose={() => select(null)} />}
      </div>
    );
  }

  const current = ROOMS.find((candidate) => candidate.id === room) ?? ROOMS[0];
  const inRoom = museum?.exhibits.filter((exhibit) => exhibit.room === room) ?? [];
  const unhung = museum ? museum.counts[room] - inRoom.length : 0;
  const shown = selected ? museum?.exhibits.find((exhibit) => exhibit.id === selected) : undefined;
  const kept = selected && !shown ? campaigns?.find((campaign) => campaign.address.toBase58() === selected) : undefined;
  // An exhibit the rooms have no floor for can still be opened, and given a room.
  const open = shown ?? (kept && now !== null ? stored(kept, now, reacted.get(selected ?? "") ?? 0, looks.get(selected ?? "")) : undefined);
  const viewer = publicKey?.toBase58();
  // Something to show at the end of the introduction: an idea that is still taking pledges.
  const firstIdea = museum?.exhibits.find((exhibit) => exhibit.status === "funding")?.id;
  const mine = viewer ? (campaigns ?? []).filter((campaign) => campaign.creator.toBase58() === viewer) : [];
  // The newest of the visitor's own campaigns that stands in no room of its own.
  const roomless = [...mine]
    .sort((a, b) => (a.id === b.id ? 0 : a.id > b.id ? -1 : 1))
    .find((campaign) => !plots.has(campaign.address.toBase58()));
  const beingPlaced = placing ? campaigns?.find((campaign) => campaign.address.toBase58() === placing) : undefined;
  // Only the wallet that made a campaign can sign for its room, so only it is shown the plan.
  const mayPlace = beingPlaced !== undefined && viewer === beingPlaced.creator.toBase58();
  const homeless = mine.filter((campaign) => !plots.has(campaign.address.toBase58()));
  const nearby = near ? museum?.exhibits.find((exhibit) => exhibit.id === near) : undefined;
  const station = near ? STATIONS.find((entry) => entry.id === near) : undefined;

  return (
    <div className="absolute inset-0 overflow-hidden bg-carbon text-paper">
      <div
        ref={host}
        tabIndex={0}
        role="application"
        aria-label="The museum floor. W, A, S, D or the arrow keys walk; Enter opens what you stand next to; plus and minus zoom. Everything on the floor is also listed next to it."
        className="museum-floor absolute inset-0 cursor-grab outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-lime"
      />

      {/* The corners of the picture fall off a little, the way a photograph's do. */}
      <div aria-hidden className="museum-vignette pointer-events-none absolute inset-0" />
      {/* The far and the near edge go a little soft, which makes a small world look small. */}
      <div aria-hidden className="museum-soft museum-soft-far pointer-events-none absolute inset-x-0 top-0" />
      <div aria-hidden className="museum-soft museum-soft-near pointer-events-none absolute inset-x-0 bottom-0" />
      {/* A shade behind the words on the left, so they never fight the floor for legibility. */}
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-y-0 left-0 w-full bg-gradient-to-r from-carbon via-carbon/85 to-transparent sm:w-[30rem] ${intro !== null || placing !== null || !notes ? "invisible" : ""}`}
      />
      {/* What a building cannot say: where you are, and what hangs here. Put away during
          the tutorial, which wants one thing read and one thing done. */}
      <div
        className={`pointer-events-none absolute inset-0 flex flex-col justify-between p-4 sm:p-6 ${intro !== null || placing !== null ? "invisible" : ""}`}
      >
        {!notes && (
          <button
            type="button"
            aria-expanded={false}
            onClick={() => setNotes(true)}
            className="pointer-events-auto flex w-max max-w-full items-center gap-3 border border-paper/30 bg-carbon/85 px-3 py-2 text-left hover:border-lime focus-visible:outline-2 focus-visible:outline-lime"
          >
            <span className="font-mono text-sm font-semibold text-lime">{current.code}</span>
            <span className="text-sm font-semibold uppercase tracking-tight">{current.name}</span>
            <span className="font-mono text-[11px] uppercase tracking-wider text-paper/60">
              {museum ? museum.counts[room] : "…"} · show list ▸
            </span>
          </button>
        )}
        <div className={`pointer-events-auto max-w-sm ${notes ? "" : "hidden"}`}>
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono text-xs uppercase tracking-widest text-lime">
              Room {current.code} · {museum ? museum.counts[room] : "…"}{" "}
              {museum?.counts[room] === 1 ? "exhibit" : "exhibits"}
            </p>
            <button
              type="button"
              aria-expanded
              onClick={() => setNotes(false)}
              className="border border-paper/30 px-2 py-1 font-mono text-[11px] uppercase tracking-wider text-paper/70 hover:border-lime hover:text-lime"
            >
              ◂ Hide
            </button>
          </div>
          <h1 className="mt-1 text-2xl font-semibold uppercase leading-none tracking-tight sm:text-5xl">
            {current.name}
          </h1>
          <p className="mt-3 hidden max-w-xs text-sm leading-6 text-paper/75 sm:block">{current.blurb}</p>

          {museum && inRoom.length === 0 && (
            <p className="mt-4 border-l-2 border-machine pl-3 text-sm text-paper/75">{current.empty}</p>
          )}
          {room === "annex" && homeless.length > 0 && !placing && (
            <div className="mt-4 max-w-xs">
              <p className="font-mono text-xs uppercase tracking-widest text-paper/60">Build a room for</p>
              <ul className="thin-scroll mt-2 max-h-[16vh] space-y-1 overflow-y-auto pr-2">
                {homeless.map((campaign) => {
                  const id = campaign.address.toBase58();
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        onClick={() => place(id)}
                        className="block w-full border border-lime/60 px-3 py-1.5 text-left text-sm hover:bg-lime hover:text-carbon focus-visible:outline-2 focus-visible:outline-lime"
                      >
                        {campaign.title || "Untitled campaign"}
                        <span className="block font-mono text-[11px] opacity-70">No room yet</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
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
                      onClick={() => select(exhibit.id)}
                      onFocus={() => scene.current?.setHot(exhibit.id)}
                      onBlur={() => scene.current?.setHot(null)}
                      onMouseEnter={() => scene.current?.setHot(exhibit.id)}
                      onMouseLeave={() => scene.current?.setHot(null)}
                      className="block w-full border-l-2 border-paper/20 px-3 py-1.5 text-left transition-colors hover:border-lime hover:bg-paper/10 focus-visible:outline-2 focus-visible:outline-lime"
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
                  left.{" "}
                  <button
                    type="button"
                    onClick={() => select("@board")}
                    className="text-lime underline underline-offset-2"
                  >
                    Find {unhung === 1 ? "it" : "them"} on the campaign board
                  </button>
                  .
                </p>
              )}
            </details>
          )}
        </div>

        {/* One dock for everything: the rooms, the whole building, zoom, help, and the rest. */}
        <div className="flex flex-col items-center gap-2">
          {hint && (
            <p className="museum-dock pointer-events-auto flex items-center gap-3 px-4 py-2 text-xs text-paper/90">
              W A S D or arrows walk · click the floor · Enter opens · drag to look
              <button type="button" aria-label="Got it" onClick={dismissHint} className="text-base leading-none text-paper/60 hover:text-lime">
                ×
              </button>
            </p>
          )}
          {help && (
            <div className="museum-dock museum-dock-panel pointer-events-auto max-w-md px-5 py-4 text-xs leading-5 text-paper/85">
              <p className="text-sm font-semibold text-paper">How to get around</p>
              <p className="mt-1">
                W A S D or the arrow keys walk. Click the floor to walk there. Enter, or a click, opens what
                you stand next to. Drag to look around; plus and minus zoom.
              </p>
              <p className="mt-2 text-sm font-semibold text-paper">Who is who</p>
              <p className="mt-1">
                <span className="font-semibold text-lime">{here ?? 1} here now.</span> You walk as{" "}
                <span className="font-semibold text-paper">{name}</span>. A figure with a bright name is another
                visitor here now. The ones strolling with a faint address are wallets that visited before,
                not people here now. Figures gathered round an exhibit stand for its reactions, one each up to
                ten; they are nobody.
              </p>
            </div>
          )}
          {more && (
            <div className="museum-dock museum-dock-panel pointer-events-auto flex flex-col p-1.5 text-sm">
              {(
                [
                  ["Campaign board", () => select("@board")],
                  ["Start a campaign", () => select("@desk")],
                  ["Replay intro", () => setIntro(0)],
                ] as const
              ).map(([label, act]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => {
                    setMore(false);
                    act();
                  }}
                  className="rounded-lg px-4 py-2 text-left text-paper hover:bg-paper/10 focus-visible:outline-2 focus-visible:outline-lime"
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <nav
            aria-label="Rooms and view"
            className="museum-dock pointer-events-auto flex max-w-full items-center gap-1 overflow-x-auto p-1.5"
          >
            {ROOMS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                aria-current={entry.id === room ? "true" : undefined}
                onClick={() => scene.current?.focusRoom(entry.id)}
                className={`flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-full pl-1 pr-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-lime ${
                  entry.id === room ? "bg-accent text-white" : "text-paper/85 hover:bg-paper/10"
                }`}
              >
                <span
                  className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-extrabold ${
                    entry.id === room ? "bg-white text-accent" : "bg-paper/15 text-paper"
                  }`}
                >
                  {entry.code}
                </span>
                {entry.name.replace(/^The /, "")}
                <span className="text-xs opacity-60">{museum ? museum.counts[entry.id] : "·"}</span>
              </button>
            ))}
            <span aria-hidden className="mx-1 h-6 w-px shrink-0 bg-paper/20" />
            <button
              type="button"
              onClick={() => scene.current?.overview()}
              className="h-9 shrink-0 whitespace-nowrap rounded-full px-3 text-sm font-medium text-paper/85 hover:bg-paper/10 focus-visible:outline-2 focus-visible:outline-lime"
            >
              Whole building
            </button>
            {(
              [
                ["out", "Zoom out", "−", false],
                ["in", "Zoom in", "+", false],
                ["help", "How to get around", "?", help],
                ["more", "More", "⋯", more],
              ] as const
            ).map(([what, label, sign, on]) => (
              <button
                key={what}
                type="button"
                aria-label={label}
                aria-pressed={what === "help" || what === "more" ? on : undefined}
                onClick={() => {
                  if (what === "out") scene.current?.zoomBy(1 / 1.25);
                  else if (what === "in") scene.current?.zoomBy(1.25);
                  else {
                    setHelp(what === "help" && !help);
                    setMore(what === "more" && !more);
                  }
                }}
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base font-semibold leading-none focus-visible:outline-2 focus-visible:outline-lime ${
                  on ? "bg-paper text-carbon" : "text-paper/85 hover:bg-paper/10"
                }`}
              >
                {sign}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {roomless && reminded && !covered && (
        <div className="pointer-events-none absolute inset-x-0 top-4 z-10 flex justify-center px-4">
          <div
            role="status"
            className="build-nudge pointer-events-auto flex max-w-full flex-wrap items-center gap-x-4 gap-y-2 border-2 border-carbon bg-lime px-4 py-3 text-carbon shadow-2xl"
          >
            <p className="min-w-0 text-sm leading-5">
              <span className="block font-mono text-[11px] font-semibold uppercase tracking-wider">
                Your campaign has no room yet
              </span>
              <span className="block truncate font-semibold">{roomless.title || "Untitled campaign"}</span>
            </p>
            <button
              type="button"
              onClick={() => place(roomless.address.toBase58())}
              className="h-10 bg-carbon px-4 font-mono text-xs font-semibold uppercase tracking-wider text-lime hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-carbon"
            >
              Build it a room
            </button>
            <button
              type="button"
              aria-label="Not now"
              onClick={() => setReminded(false)}
              className="flex h-8 w-8 items-center justify-center border border-carbon/40 text-lg leading-none hover:bg-carbon hover:text-lime"
            >
              ×
            </button>
          </div>
        </div>
      )}
      {(nearby || station) && !covered && (
        <div className="pointer-events-none absolute inset-x-0 bottom-24 z-10 flex justify-center px-4 sm:bottom-28">
          <button
            type="button"
            onClick={() => select(near)}
            className="pointer-events-auto flex max-w-full items-center gap-3 border border-carbon bg-lime px-4 py-2 text-left text-carbon shadow-xl hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime"
          >
            <span className="hidden border border-carbon px-1.5 py-0.5 font-mono text-[11px] sm:inline">
              Enter
            </span>
            <span className="min-w-0">
              <span className="block font-mono text-[11px] uppercase tracking-wider">
                {nearby
                  ? `Open exhibit ${nearby.code}`
                  : station?.id === "@board"
                    ? "Read the board"
                    : "Talk to the curator"}
              </span>
              <span className="block truncate text-sm font-semibold">
                {nearby
                  ? nearby.campaign.title || "Untitled campaign"
                  : station?.id === "@board"
                    ? "Every campaign, to search and open"
                    : "Put a new exhibit on the floor"}
              </span>
            </span>
          </button>
        </div>
      )}

      {atDoor && !selected && !panel && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-carbon/70 p-4">
          <section
            aria-labelledby="door-title"
            className="w-full max-w-xl border border-carbon bg-paper p-6 text-stone-900 shadow-2xl sm:p-9"
          >
            <p className="font-mono text-xs uppercase tracking-widest text-stone-600">
              Earnest · admission free
            </p>
            <h1
              id="door-title"
              className="mt-3 text-3xl font-semibold uppercase leading-[0.95] tracking-tight sm:text-5xl"
            >
              Museum of things that almost existed
            </h1>
            <p className="mt-4 text-lg leading-7">A museum for the things the world hasn&apos;t made yet.</p>
            <p className="mt-3 text-sm leading-6 text-stone-700">
              Every exhibit is a pre-order for something that does not exist yet. Take a seat by
              putting down a deposit. If enough people join, it gets built. If too few do, you get
              your deposit back, and the earliest backers get a bonus from a bond its creator
              locked.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                type="button"
                autoFocus
                onClick={() => setAtDoor(false)}
                className="h-11 bg-carbon px-6 text-sm font-medium text-lime hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-carbon"
              >
                Walk in
              </button>
              <button
                type="button"
                onClick={() => {
                  setAtDoor(false);
                  setIntro(0);
                }}
                className="flex h-11 items-center border border-stone-400 px-5 text-sm font-medium hover:border-stone-900"
              >
                Watch the 1-minute intro
              </button>
              <button
                type="button"
                onClick={() => {
                  setAtDoor(false);
                  select("@board");
                }}
                className="flex h-11 items-center border border-stone-400 px-5 text-sm font-medium hover:border-stone-900"
              >
                Read the campaign board
              </button>
            </div>
            <p className="mt-5 border-t border-stone-300 pt-3 font-mono text-[11px] uppercase tracking-wider text-stone-500">
              Play money on a test network · nothing here is audited
            </p>
          </section>
        </div>
      )}

      {!museum && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
          {error ? (
            <div className="pointer-events-auto max-w-md">
              <NetworkNotice />
            </div>
          ) : (
            <p aria-busy className="bg-carbon/85 px-4 py-2 font-mono text-xs uppercase tracking-widest text-paper">
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
          onCreator={(who) => select(CREATOR + who)}
          reactions={reactions.get(selected)}
          mine={reactedByMe}
          inDatabase={inDatabase}
          onReacted={(answer) => (answer ? accept(answer) : noted())}
          onPlace={open && viewer === open.campaign.creator.toBase58() ? () => place(selected) : undefined}
          hasRoom={plots.has(selected)}
          onMap={() => {
            select(null);
            scene.current?.overview();
          }}
        />
      )}
      {panel === "board" && campaigns && now !== null && (
        <Board campaigns={campaigns} now={now} looks={looks} onOpen={(address) => select(address)} onClose={() => select(null)} />
      )}
      {panel === "design" && (
        <DesignMode
          onOpened={(address, look) => {
            setJustMade((made) => ({ ...made, [address]: look }));
            // The look was written down with the campaign; read it back.
            noted();
            // Next comes where it stands: straight into build mode, to pick it a plot.
            place(address);
          }}
          onClose={() => select(null)}
        />
      )}
      {panel === "record" && creator && (
        <CreatorRecord address={creator} now={now} looks={looks} onOpen={select} onClose={() => select(null)} />
      )}
      {intro !== null && !selected && !panel && !placing && (
        <Cutscene
          scene={intro}
          onScene={setIntro}
          onClose={endIntro}
          visitor={publicKey ? shortAddress(publicKey) : null}
          onOpenIdea={
            firstIdea
              ? () => {
                  setIntro(null);
                  select(firstIdea);
                }
              : undefined
          }
        />
      )}
      {placing && !beingPlaced && !selected && !panel && (
        <p
          aria-busy
          className="absolute inset-x-0 bottom-8 z-20 mx-auto w-max max-w-[90vw] border border-lime bg-carbon px-4 py-2 font-mono text-xs uppercase tracking-widest text-lime"
        >
          Your campaign is open. Fetching it to choose its plot…
        </p>
      )}
      {beingPlaced && !mayPlace && !selected && !panel && (
        <div className="absolute inset-x-0 bottom-8 z-20 mx-auto flex w-max max-w-[90vw] items-center gap-3 border border-lime bg-carbon px-4 py-2 text-sm text-paper">
          Only the wallet that opened this campaign can build its room.
          <button type="button" onClick={() => setPlacing(null)} className="font-mono text-xs uppercase tracking-wider text-lime underline">
            Close
          </button>
        </div>
      )}
      {beingPlaced && mayPlace && plots.has(placing ?? "") && !selected && !panel && (
        <div className="absolute inset-x-0 bottom-8 z-20 mx-auto flex w-max max-w-[90vw] items-center gap-3 border border-lime bg-carbon px-4 py-2 text-sm text-paper">
          This campaign already has its room. A room is built once.
          <button type="button" onClick={() => setPlacing(null)} className="font-mono text-xs uppercase tracking-wider text-lime underline">
            Close
          </button>
        </div>
      )}
      {beingPlaced && mayPlace && !plots.has(placing ?? "") && !selected && !panel && (
        <PlotPicker
          key={placing}
          campaign={beingPlaced}
          owners={owners}
          known={plotsKnown}
          chosen={pick}
          onChoose={setChosen}
          style={floor}
          onStyle={setFloor}
          onDone={(built) => {
            // It stands at once; the chain is asked again to make sure it stays.
            if (placing) setJustBuilt((made) => ({ ...made, [placing]: built }));
            setPlacing(null);
            setChosen(null);
            noted();
            scene.current?.focusRoom("annex");
          }}
          onCancel={() => setPlacing(null)}
        />
      )}
    </div>
  );
}
