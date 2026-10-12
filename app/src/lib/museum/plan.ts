/**
 * The museum's floor plan and the rule that puts each campaign in a room. Pure data: the scene
 * draws it, the catalog and the tests can read it, and nothing here knows about rendering.
 *
 * Distances are in metres on the floor: `x` grows to the east, `z` to the south.
 */
import { type Campaign, type Status, statusAt } from "@/lib/tanda-jadi";

export type RoomId = "unmade" | "workshop" | "realized" | "almost";

export interface Room {
  id: RoomId;
  /** The letter exhibit numbers in this room start with. */
  code: string;
  name: string;
  /** What hangs here, in the words a visitor would use. */
  blurb: string;
  empty: string;
  /** Centre and size of the floor. */
  x: number;
  z: number;
  width: number;
  depth: number;
  /** Where exhibits stand, in the order they are filled. */
  slots: { x: number; z: number }[];
}

/**
 * Places in rows across the room, handed out from the middle outwards and front row first, so a
 * room with two exhibits does not look like one with six missing.
 */
function grid(room: { x: number; z: number }, columns: number[], rows: number[]) {
  return rows
    .flatMap((dz) => columns.map((dx) => ({ dx, dz })))
    .sort((a, b) => Math.abs(a.dx) - Math.abs(b.dx) || b.dz - a.dz)
    .map(({ dx, dz }) => ({ x: room.x + dx, z: room.z + dz }));
}

export const ROOMS: Room[] = [
  {
    id: "unmade",
    code: "A",
    name: "The Unmade Hall",
    blurb: "Ideas still looking for enough people. Every seat here is open or just taken.",
    empty: "Nothing is looking for backers right now.",
    x: 0,
    z: 0,
    width: 16,
    depth: 12,
    slots: grid({ x: 0, z: 0 }, [-5.25, -1.75, 1.75, 5.25], [-2.6, 2.6]),
  },
  {
    id: "workshop",
    code: "B",
    name: "The Workshop",
    blurb: "Every seat was taken. The money reaches the creator while they build, and backers hold a brake.",
    empty: "Nothing is being built right now.",
    x: 15.5,
    z: 0,
    width: 11,
    depth: 10,
    slots: grid({ x: 15.5, z: 0 }, [-3.2, 0, 3.2], [-2.2, 2.2]),
  },
  {
    id: "realized",
    code: "C",
    name: "The Realized Wing",
    blurb: "The build period ended without the backers stopping it. The money raised went to the creator.",
    empty: "No campaign has run to the end yet.",
    x: 0,
    z: -13,
    width: 11,
    depth: 10,
    slots: grid({ x: 0, z: -13 }, [-3.2, 0, 3.2], [-2.2, 2.2]),
  },
  {
    id: "almost",
    code: "D",
    name: "The Almost Wing",
    blurb: "Things that almost existed. Too few joined, so every deposit went back, with a bonus for the earliest. A few were stopped by their backers instead; their labels say so.",
    empty: "Nothing has ended unmade yet.",
    x: 0,
    z: 14,
    width: 16,
    depth: 12,
    slots: grid({ x: 0, z: 14 }, [-5.25, -1.75, 1.75, 5.25], [-3.4, 0, 3.4]),
  },
];

/** Where two rooms meet: a strip of floor through the gap in their walls. */
export const CORRIDORS = [
  { x: 9, z: 0, width: 2, depth: 3.2 },
  { x: 0, z: -7, width: 3.2, depth: 2 },
  { x: 0, z: 7, width: 3.2, depth: 2 },
];

const ROOM_OF: Record<Status, RoomId> = {
  funding: "unmade",
  building: "workshop",
  completed: "realized",
  failed: "almost",
  // Stopped by its backers: it ended unmade, which is what this wing holds. It is not the same
  // as failing to fill, so its label and its marker say which of the two happened.
  braked: "almost",
};

/** The stand-in objects. Campaigns carry no pictures, so each gets one of these. */
export const KINDS = ["screen", "orb", "tower", "ring", "arch", "prism", "stack", "knot"] as const;
export type Kind = (typeof KINDS)[number];

const SCREEN_WORDS = /\b(cli|terminal|command|extension|code|dashboard|editor|ide|app|site|api)\b/i;

/** The same campaign always gets the same object: picked from its title and its address. */
export function kindOf(campaign: Pick<Campaign, "title" | "address">): Kind {
  if (SCREEN_WORDS.test(campaign.title)) return "screen";
  const bytes = campaign.address.toBytes();
  const others = KINDS.filter((kind) => kind !== "screen");
  return others[(bytes[0] + bytes[7] * 3 + bytes[31] * 7) % others.length];
}

export interface Exhibit {
  /** The campaign's address as text. */
  id: string;
  /** `A-03`: room letter and place in the room. */
  code: string;
  campaign: Campaign;
  status: Status;
  room: RoomId;
  x: number;
  z: number;
  kind: Kind;
}

export interface Museum {
  exhibits: Exhibit[];
  /** How many campaigns belong in each room, including those there was no floor space for. */
  counts: Record<RoomId, number>;
}

/**
 * Hangs the campaigns. Within a room the newest comes first; a room shows as many as it has
 * places for and the rest stay reachable through the catalog.
 */
export function arrange(campaigns: Campaign[], now: number): Museum {
  const counts: Record<RoomId, number> = { unmade: 0, workshop: 0, realized: 0, almost: 0 };
  const taken: Record<RoomId, number> = { unmade: 0, workshop: 0, realized: 0, almost: 0 };
  const exhibits: Exhibit[] = [];
  // Ids are the creation time in milliseconds, so the largest is the newest.
  const newestFirst = [...campaigns].sort((a, b) => (a.id === b.id ? 0 : a.id > b.id ? -1 : 1));

  for (const campaign of newestFirst) {
    const status = statusAt(campaign, now);
    const room = ROOMS.find(({ id }) => id === ROOM_OF[status]) as Room;
    counts[room.id] += 1;
    const slot = room.slots[taken[room.id]];
    if (!slot) continue;
    taken[room.id] += 1;
    exhibits.push({
      id: campaign.address.toBase58(),
      code: `${room.code}-${String(taken[room.id]).padStart(2, "0")}`,
      campaign,
      status,
      room: room.id,
      x: slot.x,
      z: slot.z,
      kind: kindOf(campaign),
    });
  }
  return { exhibits, counts };
}

/** How many seat markers stand in front of an exhibit, and how many of them are lit. */
export function seatMarkers(campaign: Pick<Campaign, "targetBackers" | "backers">): {
  total: number;
  filled: number;
  /** False when the row is a scaled-down picture of more seats than fit. */
  exact: boolean;
} {
  const MOST = 12;
  if (campaign.targetBackers <= MOST) {
    return { total: campaign.targetBackers, filled: campaign.backers, exact: true };
  }
  return {
    total: MOST,
    filled: Math.min(MOST, Math.floor((campaign.backers * MOST) / campaign.targetBackers)),
    exact: false,
  };
}

export const STATUS_WORDS: Record<Status, string> = {
  funding: "Taking pledges",
  building: "Being built",
  completed: "Completed",
  failed: "Didn't fill",
  braked: "Stopped by backers",
};
