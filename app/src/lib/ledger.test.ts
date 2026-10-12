/**
 * Reactions and rooms are read from notes anybody can write. These check that only the notes
 * that should count do: a room is its creator's to place, and a plot goes to whoever signed
 * for it first.
 *
 *   npm test
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { Keypair, PublicKey } from "@solana/web3.js";

import type { Campaign } from "@/lib/tanda-jadi";

import { judgeClaims, judgeLooks, type PlotClaim, sortNotes } from "./ledger";
import { arrange, canStand, lookOf, PLOTS, ROOMS, route } from "./museum/plan";

const A = "CampaignA";
const B = "CampaignB";
const creators: Record<string, string> = { [A]: "alice", [B]: "bob" };
const claim = (signature: string, campaign: string, plot: number, style = 0): PlotClaim => ({
  signature,
  campaign,
  plot,
  style,
});
const judge = (claims: PlotClaim[], signed: Record<string, string[]>) =>
  judgeClaims(
    claims,
    (campaign) => creators[campaign],
    (signature) => signed[signature],
    24,
  );

test("notes are sorted into reactions and claims, and anything else is ignored", () => {
  const { reactions, claims } = sortNotes([
    { signature: "1", text: `earnest:1:react:${A}:want` },
    { signature: "2", text: `earnest:1:react:${A}:want` },
    { signature: "3", text: `earnest:1:react:${A}:clever` },
    { signature: "4", text: `earnest:1:react:${A}:hate` },
    { signature: "5", text: "hello" },
    { signature: "6", text: `someone-else:1:react:${A}:want` },
    { signature: "7", text: `earnest:1:plot:${B}:3:2` },
    { signature: "8", text: `earnest:1:plot:${B}:x:2` },
  ]);
  assert.deepEqual(reactions.get(A), { want: 2, clever: 1, watching: 0 });
  assert.equal(reactions.size, 1);
  assert.deepEqual(claims, [{ signature: "7", campaign: B, plot: 3, style: 2 }]);
});

test("only a campaign's creator can give it a room", () => {
  const held = judge([claim("1", A, 4), claim("2", B, 5)], { "1": ["mallory"], "2": ["bob"] });
  assert.equal(held.has(A), false);
  assert.deepEqual(held.get(B), { plot: 5, style: 0 });
});

test("a plot goes to whoever signed for it first", () => {
  const held = judge([claim("1", A, 4), claim("2", B, 4)], { "1": ["alice"], "2": ["bob"] });
  assert.deepEqual(held.get(A), { plot: 4, style: 0 });
  assert.equal(held.has(B), false);
});

test("a room is built once: it cannot be moved or given up", () => {
  const signed = { "1": ["alice"], "2": ["alice"], "3": ["bob"], "4": ["bob"], "5": ["alice"] };
  const moved = judge([claim("1", A, 4), claim("2", A, 9, 3), claim("3", B, 4)], signed);
  // The second claim does not move it, so the first plot is still taken when the other asks.
  assert.deepEqual(moved.get(A), { plot: 4, style: 0 });
  assert.equal(moved.has(B), false);

  const left = judge([claim("1", A, 4), claim("4", B, 7), claim("5", A, -1)], signed);
  assert.deepEqual(left.get(A), { plot: 4, style: 0 });
  assert.equal(left.size, 2);

  // A claim that lost its plot to someone quicker leaves its campaign free to ask again.
  const again = judge([claim("3", B, 4), claim("1", A, 4), claim("2", A, 9, 3)], signed);
  assert.deepEqual(again.get(A), { plot: 9, style: 3 });
});

test("a claim that has not been looked up, or names a plot that does not exist, counts for nothing", () => {
  assert.equal(judge([claim("1", A, 4)], {}).size, 0);
  assert.equal(judge([claim("1", A, 24)], { "1": ["alice"] }).size, 0);
});

function campaign(id: number): Campaign {
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
    deadline: 2_000_000,
    buildSecs: 86_400,
    upfrontBps: 2_000,
    feeBps: 300,
    status: "funding",
    backers: 2,
    brakes: 0,
    fundedAt: 0,
    brakedAt: 0,
    refundPerBacker: 0n,
  } as Campaign;
}

test("a campaign with a room stands on its plot and leaves the hall's floor to others", () => {
  const hall = ROOMS[0];
  const many = Array.from({ length: hall.slots.length + 1 }, (_, index) => campaign(index + 1));
  // The oldest has no floor in a full hall.
  const oldest = many[0].address.toBase58();
  const before = arrange(many, 1_000_000);
  assert.equal(before.exhibits.some((exhibit) => exhibit.id === oldest), false);

  const after = arrange(
    many,
    1_000_000,
    new Map([[oldest, { plot: 7, style: 2 }]]),
    new Map([[oldest, 3]]),
  );
  const built = after.exhibits.find((exhibit) => exhibit.id === oldest);
  assert.ok(built);
  assert.equal(built.room, "annex");
  assert.equal(built.code, "E-08");
  assert.deepEqual({ x: built.x, z: built.z }, PLOTS[7]);
  assert.equal(built.reactions, 3);
  assert.equal(after.counts.annex, 1);
  assert.equal(after.counts.unmade, hall.slots.length);
  assert.equal(after.exhibits.length, many.length);
});

test("the annex is reached through the workshop, on floor all the way", () => {
  const plot = PLOTS[13];
  const to = { x: plot.x + 1.25, z: plot.z + 1.75 };
  const fromHall = route({ x: -6, z: 0 }, to);
  assert.deepEqual(fromHall.slice(0, 2), [
    [6.6, 0],
    [11.4, 0],
  ]);
  for (const [x, z] of fromHall) assert.ok(canStand(x, z, []), `${x},${z} is not floor`);

  // From the workshop nobody goes back to the hall first.
  const fromWorkshop = route({ x: 15.5, z: 0 }, to);
  assert.deepEqual(fromWorkshop[0], [19.6, 0]);
});

test("a look counts only from the campaign's creator, and the last one holds", () => {
  const { looks } = sortNotes([
    { signature: "1", text: `earnest:1:look:${A}:orb:3:1` },
    { signature: "2", text: `earnest:1:look:${A}:tower:9:2` },
    { signature: "3", text: `earnest:1:look:${A}:ring:0:0` },
    { signature: "4", text: `earnest:1:look:${B}:spaceship:0:0` },
    { signature: "5", text: `earnest:1:look:${B}:orb:99:0` },
  ]);
  // A shape that does not exist and a colour past the end of the list are not looks at all.
  assert.equal(looks.length, 3);
  const chosen = judgeLooks(
    looks,
    (id) => creators[id],
    (signature) => ({ "1": ["alice"], "2": ["alice"], "3": ["mallory"] })[signature],
  );
  assert.deepEqual(chosen.get(A), { kind: "tower", tint: 9, trim: 2 });
  assert.equal(chosen.has(B), false);
});

test("campaigns with the same title do not all look the same, and one campaign always looks the same", () => {
  const twins = Array.from({ length: 12 }, () => ({ ...campaign(1), title: "Same title" }));
  const seen = new Set(twins.map((twin) => { const look = lookOf(twin); return `${look.tint}:${look.trim}`; }));
  assert.ok(seen.size >= 4, `only ${seen.size} different looks among twelve`);
  assert.deepEqual(lookOf(twins[0]), lookOf(twins[0]));
  // The shape still follows the title.
  assert.equal(new Set(twins.map((twin) => lookOf(twin).kind)).size, 1);

  const hung = arrange([twins[0]], 1_000_000, undefined, undefined, new Map([[twins[0].address.toBase58(), { kind: "knot", tint: 2, trim: 1 }]]));
  assert.deepEqual(
    { kind: hung.exhibits[0].kind, tint: hung.exhibits[0].tint, trim: hung.exhibits[0].trim },
    { kind: "knot", tint: 2, trim: 1 },
  );
});
