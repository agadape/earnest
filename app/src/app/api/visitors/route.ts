/**
 * The wallets that have walked the museum, kept so that the rooms are not empty when nobody is
 * in them: each one strolls about as a figure with its short address over it.
 *
 * A wallet is written down when a browser that has it connected opens the museum. Nobody signs
 * for that, so an address here is whatever a browser sent and proves nothing about who was
 * there; the page calls these figures past visitors, never people who are here now. Without a
 * database there are none.
 */
import { PublicKey } from "@solana/web3.js";

import { supabase, SUPABASE_READY } from "@/lib/server/supabase";

// How many figures stroll at most: the wallets seen most recently.
const MOST = 14;
const KEPT_MS = 20_000;

let kept: { at: number; wallets: string[] } | null = null;

async function recent(): Promise<string[]> {
  if (kept && Date.now() - kept.at < KEPT_MS) return kept.wallets;
  const rows = (await supabase(`visitors?select=wallet&order=last_seen.desc&limit=${MOST}`)) as { wallet: string }[];
  kept = { at: Date.now(), wallets: rows.map((row) => row.wallet) };
  return kept.wallets;
}

export async function GET() {
  if (!SUPABASE_READY) return Response.json({ wallets: [] });
  try {
    return Response.json({ wallets: await recent() });
  } catch (error) {
    console.error("visitors:", error);
    return Response.json({ wallets: [] });
  }
}

export async function POST(request: Request) {
  if (!SUPABASE_READY) return Response.json({ wallets: [] });
  const body = (await request.json().catch(() => null)) as { wallet?: unknown } | null;
  let wallet: string;
  try {
    wallet = new PublicKey(String(body?.wallet)).toBase58();
  } catch {
    return Response.json({ error: "A wallet address is needed." }, { status: 400 });
  }
  try {
    await supabase("visitors?on_conflict=wallet", {
      method: "POST",
      body: { wallet, last_seen: new Date().toISOString() },
      prefer: "resolution=merge-duplicates,return=minimal",
    });
    kept = null;
    return Response.json({ wallets: await recent() });
  } catch (error) {
    console.error("visitors:", error);
    return Response.json({ wallets: [] });
  }
}
