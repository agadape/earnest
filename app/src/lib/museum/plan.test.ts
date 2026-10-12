/**
 * The museum must never say something about a campaign that the campaign does not say itself:
 * which room it hangs in, how many seats are lit, how many exhibits a room holds.
 *
 *   npm test
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { Keypair, PublicKey } from "@solana/web3.js";

import type { Campaign, Status } from "@/lib/tanda-jadi";

import { arrange, canStand, kindOf, roomAt, ROOMS, route, seatMarkers, standBy, stepFrom } from "./plan";

const NOW = 1_000_000;
const DAY = 86_400;

function campaign(id: number, stored: Status, changes: Partial<Campaign> = {}): Campaign {
  return {
    address: Keypair.generate().publicKey,
    creator: PublicKey.default,
    mint: PublicKey.default,
    id: BigInt(id),
    title: `Campaign ${id}`,
    uri: "",
    price: 10_000_000n,
    targetBackers: 5,
    earlySlots: 2,
    bonusPerEarly: 2_500_000n,
    deadline: NOW + DAY,
    buildSecs: 14 * DAY,
    upfrontBps: 2_000,
    feeBps: 300,
    status: stored,
    backers: 2,
    brakes: 0,
    fundedAt: 0,
    brakedAt: 0,
    refundPerBacker: 0n,
    creatorWithdrawn: 0n,
    feeCollected: false,
    ...changes,
  };
}

test("each campaign hangs in the room its state calls for", () => {
  const { exhibits, counts } = arrange(
    [
      campaign(1, "funding"),
      // Still stored as taking pledges, but its deadline has passed: it did not fill.
      campaign(2, "funding", { deadline: NOW - 1 }),
      campaign(3, "building", { backers: 5, fundedAt: NOW - DAY }),
      // Stored as being built, but the build period is over: it is completed.
      campaign(4, "building", { backers: 5, fundedAt: NOW - 15 * DAY }),
      campaign(5, "failed"),
      campaign(6, "braked", { backers: 5, fundedAt: NOW - DAY, brakedAt: NOW - 10 }),
      campaign(7, "completed", { backers: 5, fundedAt: NOW - 20 * DAY }),
    ],
    NOW,
  );
  const roomOf = (id: number) => exhibits.find((exhibit) => exhibit.campaign.id === BigInt(id))?.room;

  assert.equal(roomOf(1), "unmade");
  assert.equal(roomOf(2), "almost");
  assert.equal(roomOf(3), "workshop");
  assert.equal(roomOf(4), "realized");
  assert.equal(roomOf(5), "almost");
  assert.equal(roomOf(7), "realized");
  assert.deepEqual(counts, { unmade: 1, workshop: 1, realized: 2, almost: 3 });

  // A campaign its backers stopped ended unmade, but it keeps its own name for what happened.
  const stopped = exhibits.find((exhibit) => exhibit.campaign.id === 6n);
  assert.equal(stopped?.room, "almost");
  assert.equal(stopped?.status, "braked");
});

test("a room shows the newest first and counts what it has no floor for", () => {
  const hall = ROOMS[0];
  const many = Array.from({ length: hall.slots.length + 3 }, (_, index) => campaign(index + 1, "funding"));
  const { exhibits, counts } = arrange(many, NOW);

  assert.equal(counts.unmade, hall.slots.length + 3);
  assert.equal(exhibits.length, hall.slots.length);
  assert.equal(exhibits[0].campaign.id, BigInt(many.length));
  assert.equal(exhibits[0].code, "A-01");
  // No two exhibits share a place, and every place is inside its room.
  assert.equal(new Set(exhibits.map(({ x, z }) => `${x}:${z}`)).size, exhibits.length);
  for (const { x, z } of exhibits) {
    assert.ok(Math.abs(x - hall.x) < hall.width / 2 && Math.abs(z - hall.z) < hall.depth / 2);
  }
  // The first place handed out is one of the two nearest the middle of the room.
  assert.ok(Math.abs(exhibits[0].x - hall.x) < 2);
});

test("the row of seats never shows more taken than there are", () => {
  assert.deepEqual(seatMarkers({ targetBackers: 5, backers: 2 }), { total: 5, filled: 2, exact: true });
  assert.deepEqual(seatMarkers({ targetBackers: 12, backers: 12 }), { total: 12, filled: 12, exact: true });

  const scaled = seatMarkers({ targetBackers: 50, backers: 49 });
  assert.equal(scaled.exact, false);
  assert.equal(scaled.total, 12);
  // 49 of 50 is not full, so the row must not look full.
  assert.equal(scaled.filled, 11);
  assert.equal(seatMarkers({ targetBackers: 50, backers: 50 }).filled, 12);
  assert.equal(seatMarkers({ targetBackers: 5000, backers: 1 }).filled, 0);
});

test("a campaign always gets the same stand-in object", () => {
  const one = campaign(1, "funding", { title: "A sculpture of nothing in particular" });
  assert.equal(kindOf(one), kindOf({ ...one }));
  assert.equal(kindOf(campaign(2, "funding", { title: "A CLI that diffs two IDLs" })), "screen");
  assert.notEqual(kindOf(one), "screen");
});

/** Walks the way the scene does: at the next point, going round what is in the way. */
function walk(from: { x: number; z: number }, to: { x: number; z: number }, exhibits: { x: number; z: number }[]) {
  const at = { ...from };
  const step = 0.18;
  for (const [x, z] of route(from, to)) {
    for (let tries = 0; tries < 2000; tries++) {
      const dx = x - at.x;
      const dz = z - at.z;
      const left = Math.hypot(dx, dz);
      if (left <= step) {
        if (canStand(x, z, exhibits)) Object.assign(at, { x, z });
        break;
      }
      const next = stepFrom(at, (dx / left) * step, (dz / left) * step, exhibits);
      if (!next) return null;
      Object.assign(at, next);
    }
  }
  return at;
}

test("a visitor can walk from the door to every exhibit in a full museum", () => {
  // Every place in every room taken: the hardest floor to cross.
  const full = ROOMS.flatMap((room) => room.slots);
  const door = { x: -6.4, z: 0 };
  assert.ok(canStand(door.x, door.z, full), "the place a visitor starts is free");

  for (const room of ROOMS) {
    for (const slot of room.slots) {
      const goal = standBy(slot);
      assert.ok(canStand(goal.x, goal.z, full), `there is room to stand by ${room.code} ${slot.x},${slot.z}`);
      const reached = walk(door, goal, full);
      assert.ok(reached, `the way to ${room.code} ${slot.x},${slot.z} is not blocked`);
      assert.ok(
        Math.hypot(reached.x - goal.x, reached.z - goal.z) < 0.3,
        `the walk to ${room.code} ${slot.x},${slot.z} ends beside it`,
      );
      assert.equal(roomAt(reached.x, reached.z), room.id);
    }
  }
});

test("nobody stands in a wall, on a plinth or outside the building", () => {
  const hall = ROOMS[0];
  const exhibits = [hall.slots[0]];
  assert.equal(canStand(hall.slots[0].x, hall.slots[0].z, exhibits), false);
  assert.equal(canStand(hall.x - hall.width / 2 + 0.2, hall.z + 3, exhibits), false);
  assert.equal(canStand(40, 40, exhibits), false);
  // The middle of a doorway is floor.
  assert.equal(canStand(9, 0, exhibits), true);
  assert.equal(canStand(0, 7, exhibits), true);
  // Beside a doorway, where the wall is, is not.
  assert.equal(canStand(9, 2.5, exhibits), false);
});

test("walking between two side rooms goes through the hall", () => {
  const points = route({ x: 15.5, z: 2 }, { x: 0, z: 14 });
  assert.ok(points.length >= 5);
  assert.ok(points.some(([x, z]) => roomAt(x, z) === "unmade"));
});
