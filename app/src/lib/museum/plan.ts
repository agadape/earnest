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

/** The way in: a porch on the west side of the main hall. */
export const ENTRANCE = { x: -9.5, z: 0, width: 3, depth: 3.2, along: "x" as const };

/** Where two rooms meet, or the building meets the outside: floor through a gap in the walls. */
export const CORRIDORS = [
  ENTRANCE,
  { x: 9, z: 0, width: 2, depth: 3.2, along: "x" as const },
  { x: 0, z: -7, width: 3.2, depth: 2, along: "z" as const },
  { x: 0, z: 7, width: 3.2, depth: 2, along: "z" as const },
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

/**
 * The same title always gets the same object, so the object can be shown while a campaign is
 * still being written. A campaign without a title falls back on its address.
 */
export function kindOf(campaign: { title: string; address?: { toBytes(): Uint8Array } }): Kind {
  const title = campaign.title.trim();
  if (SCREEN_WORDS.test(title)) return "screen";
  const others = KINDS.filter((kind) => kind !== "screen");
  const bytes = title
    ? new TextEncoder().encode(title.toLowerCase())
    : (campaign.address?.toBytes() ?? new Uint8Array([0]));
  let sum = 7;
  for (const byte of bytes) sum = (sum * 31 + byte) % 9973;
  return others[sum % others.length];
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

/** How close to a wall a visitor can stand. */
const MARGIN = 0.8;
/** How much room an exhibit takes up on the floor, as a radius. */
export const EXHIBIT_RADIUS = 1.05;

/** Whether a visitor can stand at a point: on a floor, clear of the walls and of every exhibit. */
export function canStand(x: number, z: number, exhibits: { x: number; z: number }[]): boolean {
  const onRoom = ROOMS.some(
    (room) =>
      Math.abs(x - room.x) <= room.width / 2 - MARGIN && Math.abs(z - room.z) <= room.depth / 2 - MARGIN,
  );
  // A corridor is walked along its length, a little into the rooms it joins.
  const onCorridor = CORRIDORS.some((corridor) => {
    const lengthwise = corridor.along;
    const halfWidth = (lengthwise === "x" ? corridor.depth : corridor.width) / 2 - 0.45;
    const halfLength = (lengthwise === "x" ? corridor.width : corridor.depth) / 2 + MARGIN + 0.2;
    return lengthwise === "x"
      ? Math.abs(x - corridor.x) <= halfLength && Math.abs(z - corridor.z) <= halfWidth
      : Math.abs(z - corridor.z) <= halfLength && Math.abs(x - corridor.x) <= halfWidth;
  });
  if (!onRoom && !onCorridor) return false;
  return exhibits.every((exhibit) => Math.hypot(x - exhibit.x, z - exhibit.z) >= EXHIBIT_RADIUS);
}

/** The room a point on the floor belongs to: the one it is in, or the nearest. */
export function roomAt(x: number, z: number): RoomId {
  let best = ROOMS[0];
  let least = Infinity;
  for (const room of ROOMS) {
    const dx = Math.max(0, Math.abs(x - room.x) - room.width / 2);
    const dz = Math.max(0, Math.abs(z - room.z) - room.depth / 2);
    const distance = Math.hypot(dx, dz);
    if (distance < least) {
      least = distance;
      best = room;
    }
  }
  return best.id;
}

// Each side room is reached through one door in the main hall: a point just inside the room
// and a point just inside the hall.
const DOORS: Partial<Record<RoomId, { inside: [number, number]; hall: [number, number] }>> = {
  workshop: { inside: [11.4, 0], hall: [6.6, 0] },
  realized: { inside: [0, -9.4], hall: [0, -4.6] },
  almost: { inside: [0, 9.4], hall: [0, 4.6] },
};

/** The points to walk through, in order, to get from one place to another by the doors. */
export function route(from: { x: number; z: number }, to: { x: number; z: number }): [number, number][] {
  const start = roomAt(from.x, from.z);
  const end = roomAt(to.x, to.z);
  const points: [number, number][] = [];
  if (start !== end) {
    const out = DOORS[start];
    if (out) points.push(out.inside, out.hall);
    const into = DOORS[end];
    if (into) points.push(into.hall, into.inside);
  }
  points.push([to.x, to.z]);
  return points;
}

/** Where a visitor stands to look at an exhibit: in front of it, by its seats. */
export const standBy = (place: { x: number; z: number }) => ({ x: place.x + 1.25, z: place.z + 1.75 });

// When the way ahead is blocked, the turns to try, in degrees: a little to one side first.
const TURNS = [0, 25, -25, 50, -50, 75, -75, 95, -95];

/**
 * One step from a point towards a direction, going round whatever is in the way. Returns where
 * the step ends, or `null` if there is no way forward at all.
 */
export function stepFrom(
  at: { x: number; z: number },
  dx: number,
  dz: number,
  exhibits: { x: number; z: number }[],
): { x: number; z: number } | null {
  for (const turn of TURNS) {
    const angle = (turn * Math.PI) / 180;
    const x = at.x + dx * Math.cos(angle) - dz * Math.sin(angle);
    const z = at.z + dx * Math.sin(angle) + dz * Math.cos(angle);
    if (canStand(x, z, exhibits)) return { x, z };
  }
  return null;
}

/**
 * The two things in the main hall that are not exhibits. A visitor walks up to them as to an
 * exhibit; what they open is up to the page.
 */
export const STATIONS = [
  { id: "@board", x: -6.9, z: -4.5, label: "Campaign board" },
  { id: "@desk", x: -6.9, z: 4.5, label: "Curator · start a campaign" },
] as const;
