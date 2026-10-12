/**
 * The reactions route must only write what a wallet signed for. The database is stood in for
 * by a list in memory that answers the same few REST calls.
 *
 *   npm test
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { ed25519 } from "@noble/curves/ed25519.js";
import { Keypair } from "@solana/web3.js";

import { reactionMessage, type ReactionsAnswer } from "@/lib/reactions";

process.env.SUPABASE_URL = "https://database.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "a-key-for-the-test";

const rows: { campaign: string; wallet: string; kind: string }[] = [];
const eq = (url: URL, field: string) => url.searchParams.get(field)?.replace(/^eq\./, "");

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input));
  const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  if (url.pathname.endsWith("/rpc/reaction_counts")) {
    const counted = new Map<string, number>();
    for (const row of rows) counted.set(`${row.campaign}|${row.kind}`, (counted.get(`${row.campaign}|${row.kind}`) ?? 0) + 1);
    return reply([...counted].map(([key, n]) => ({ campaign: key.split("|")[0], kind: key.split("|")[1], n })));
  }
  if (init?.method === "POST") {
    const row = JSON.parse(String(init.body));
    const there = rows.some((other) => other.campaign === row.campaign && other.wallet === row.wallet && other.kind === row.kind);
    if (!there) rows.push(row);
    return new Response("", { status: 201 });
  }
  if (init?.method === "DELETE") {
    const index = rows.findIndex(
      (row) => row.campaign === eq(url, "campaign") && row.wallet === eq(url, "wallet") && row.kind === eq(url, "kind"),
    );
    if (index >= 0) rows.splice(index, 1);
    return new Response(null, { status: 204 });
  }
  return reply(rows.filter((row) => row.wallet === eq(url, "wallet")).map(({ campaign, kind }) => ({ campaign, kind })));
}) as typeof fetch;

const campaign = Keypair.generate().publicKey.toBase58();

async function react(signer: Keypair, claimed: { wallet?: string; on?: boolean; at?: number; signedOn?: boolean } = {}) {
  const { POST } = await import("./route");
  const wallet = claimed.wallet ?? signer.publicKey.toBase58();
  const at = claimed.at ?? Date.now();
  const on = claimed.on ?? true;
  const message = reactionMessage({ campaign, kind: "want", wallet, on: claimed.signedOn ?? on, at });
  const signature = ed25519.sign(new TextEncoder().encode(message), signer.secretKey.slice(0, 32));
  const response = await POST(
    new Request("http://localhost/api/reactions", {
      method: "POST",
      body: JSON.stringify({ campaign, kind: "want", wallet, on, at, signature: Buffer.from(signature).toString("base64") }),
    }),
  );
  return { status: response.status, answer: (await response.json()) as ReactionsAnswer };
}

test("a wallet's signed reaction is counted once, however often it is sent", async () => {
  const rina = Keypair.generate();
  const first = await react(rina);
  assert.equal(first.status, 200);
  assert.equal(first.answer.counts[campaign].want, 1);
  assert.deepEqual(first.answer.mine, [`${campaign}:want`]);

  const again = await react(rina);
  assert.equal(again.answer.counts[campaign].want, 1);

  const budi = await react(Keypair.generate());
  assert.equal(budi.answer.counts[campaign].want, 2);
});

test("nobody can react in another wallet's name, or turn an add into a remove", async () => {
  const before = rows.length;
  const victim = Keypair.generate().publicKey.toBase58();
  assert.equal((await react(Keypair.generate(), { wallet: victim })).status, 401);
  assert.equal((await react(Keypair.generate(), { on: false, signedOn: true })).status, 401);
  assert.equal(rows.length, before);
});

test("an old signature is refused", async () => {
  assert.equal((await react(Keypair.generate(), { at: Date.now() - 3_600_000 })).status, 400);
});

test("a wallet can take its reaction back", async () => {
  const sari = Keypair.generate();
  const given = await react(sari);
  const taken = await react(sari, { on: false });
  assert.equal(taken.status, 200);
  assert.equal(taken.answer.counts[campaign].want, given.answer.counts[campaign].want - 1);
  assert.deepEqual(taken.answer.mine, []);
});
