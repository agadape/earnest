/**
 * Reactions kept in a database: one of each kind per wallet and campaign, free to give and to
 * take back. A wallet proves a reaction is its own by signing a short message; this route
 * rebuilds that message from what it was sent, checks the signature, and only then writes.
 *
 * What a row proves is that some wallet signed for it. Wallets cost nothing to make, so a
 * count is of wallets, not of people. Where no database is set up this route says so and the
 * app reads reactions from the chain instead.
 */
import { createPublicKey, verify } from "node:crypto";

import { PublicKey } from "@solana/web3.js";

import { type ReactionKind, REACTIONS } from "@/lib/ledger";
import { REACTION_FRESH_MS, reactionMessage, type ReactionsAnswer } from "@/lib/reactions";
import { supabase, SUPABASE_READY } from "@/lib/server/supabase";

// The fixed bytes that come before a raw ed25519 public key in the form node's crypto reads.
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const COUNTS_KEPT_MS = 3_000;

let kept: { at: number; counts: ReactionsAnswer["counts"] } | null = null;

function address(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    return new PublicKey(value).toBase58();
  } catch {
    return null;
  }
}

async function counts(): Promise<ReactionsAnswer["counts"]> {
  if (kept && Date.now() - kept.at < COUNTS_KEPT_MS) return kept.counts;
  const rows = (await supabase("rpc/reaction_counts", { method: "POST", body: {} })) as {
    campaign: string;
    kind: ReactionKind;
    n: number;
  }[];
  const found: ReactionsAnswer["counts"] = {};
  for (const row of rows) {
    found[row.campaign] ??= { want: 0, clever: 0, watching: 0 };
    if (row.kind in found[row.campaign]) found[row.campaign][row.kind] = Number(row.n);
  }
  kept = { at: Date.now(), counts: found };
  return found;
}

async function answer(wallet: string | null): Promise<ReactionsAnswer> {
  const mine = wallet
    ? ((await supabase(`reactions?wallet=eq.${wallet}&select=campaign,kind`)) as { campaign: string; kind: string }[])
    : [];
  return {
    configured: true,
    counts: await counts(),
    mine: mine.map((row) => `${row.campaign}:${row.kind}`),
  };
}

/**
 * What went wrong with the database, in words that help whoever set it up and give nothing
 * away: the kind of failure, never the key or the address.
 */
function why(error: unknown): string {
  console.error("reactions:", error);
  const status = /answered (\d{3})/.exec(error instanceof Error ? error.message : "")?.[1];
  if (status === "401" || status === "403") return "The database refused the server's key.";
  if (status === "404") return "The table or the counting function is missing: run supabase/reactions.sql.";
  if (status) return `The database answered ${status}.`;
  return "The database could not be reached: check SUPABASE_URL.";
}

const NOT_SET_UP: ReactionsAnswer = { configured: false, counts: {}, mine: [] };

export async function GET(request: Request) {
  if (!SUPABASE_READY) return Response.json(NOT_SET_UP);
  try {
    return Response.json(await answer(address(new URL(request.url).searchParams.get("wallet"))));
  } catch (error) {
    return Response.json({ error: "The reactions could not be read.", reason: why(error) }, { status: 502 });
  }
}

export async function POST(request: Request) {
  if (!SUPABASE_READY) return Response.json(NOT_SET_UP, { status: 503 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const campaign = address(body?.campaign);
  const wallet = address(body?.wallet);
  const kind = REACTIONS.find((reaction) => reaction.kind === body?.kind)?.kind;
  const at = typeof body?.at === "number" ? body.at : NaN;
  const on = body?.on !== false;
  if (!campaign || !wallet || !kind || typeof body?.signature !== "string") {
    return Response.json({ error: "A campaign, a wallet, a kind and a signature are needed." }, { status: 400 });
  }
  if (!Number.isFinite(at) || Math.abs(Date.now() - at) > REACTION_FRESH_MS) {
    return Response.json({ error: "That signature is too old. Try again." }, { status: 400 });
  }

  let signed = false;
  try {
    const key = createPublicKey({
      key: Buffer.concat([SPKI_PREFIX, new PublicKey(wallet).toBytes()]),
      format: "der",
      type: "spki",
    });
    const message = Buffer.from(reactionMessage({ campaign, kind, wallet, on, at }), "utf8");
    signed = verify(null, message, key, Buffer.from(body.signature, "base64"));
  } catch {
    signed = false;
  }
  if (!signed) return Response.json({ error: "The signature does not match the wallet." }, { status: 401 });

  try {
    if (on) {
      await supabase("reactions?on_conflict=campaign,wallet,kind", {
        method: "POST",
        body: { campaign, wallet, kind },
        prefer: "resolution=ignore-duplicates,return=minimal",
      });
    } else {
      await supabase(`reactions?campaign=eq.${campaign}&wallet=eq.${wallet}&kind=eq.${kind}`, {
        method: "DELETE",
        prefer: "return=minimal",
      });
    }
    kept = null;
    return Response.json(await answer(wallet));
  } catch (error) {
    return Response.json({ error: "The reaction could not be saved.", reason: why(error) }, { status: 502 });
  }
}
