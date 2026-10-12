/**
 * Reads the notes the museum keeps on chain: reactions to campaigns and claims on annex plots,
 * and says which claims count. It can also write one, signed by a key from `.keys/`:
 *
 *   RPC_URL=https://api.devnet.solana.com npx tsx scripts/notes.ts
 *   ... scripts/notes.ts plot <key> <campaign> <plot> <style>    a negative plot gives it up
 *   ... scripts/notes.ts react <key> <campaign> <want|clever|watching>
 *
 * A claim only counts when `<key>` is the campaign's creator, exactly as in the app.
 */
import { PublicKey } from "@solana/web3.js";

import { claimPlotIx, judgeClaims, reactIx, type ReactionKind, readNotes, REGISTRY, signersOf } from "../src/lib/ledger";
import { PLOTS } from "../src/lib/museum/plan";
import { fetchCampaigns } from "../src/lib/tanda-jadi";
import { connection, hasKeypair, keypair, program, RPC_URL, send } from "./lib";

async function main() {
  console.log(`Notes on ${RPC_URL}, kept under ${REGISTRY.toBase58()}`);
  const [what, key, campaign, ...rest] = process.argv.slice(2);
  if (what === "plot" || what === "react") {
    if (!key || !hasKeypair(key)) throw new Error(`There is no key called ${key} in .keys/`);
    const writer = keypair(key);
    const about = new PublicKey(campaign);
    const instructions =
      what === "plot"
        ? claimPlotIx(writer.publicKey, about, Number(rest[0]), Number(rest[1] ?? 0))
        : reactIx(writer.publicKey, about, rest[0] as ReactionKind);
    console.log(`Wrote: ${await send(instructions, writer)}`);
  }

  const campaigns = await fetchCampaigns(program);
  const creators = new Map(campaigns.map((entry) => [entry.address.toBase58(), entry.creator.toBase58()]));
  const notes = await readNotes(connection);
  const signed = new Map<string, string[]>();
  for (const claim of notes.claims) signed.set(claim.signature, await signersOf(connection, claim.signature));
  const held = judgeClaims(notes.claims, (id) => creators.get(id), (signature) => signed.get(signature), PLOTS.length);

  console.log(`${notes.reactions.size} addresses reacted to, ${notes.claims.length} plot claims, ${held.size} rooms standing`);
  for (const [id, counts] of notes.reactions) {
    console.log(`  ${creators.has(id) ? "campaign" : "no such campaign"} ${id}`, counts);
  }
  for (const [id, room] of held) console.log(`  room on plot ${room.plot + 1}, floor ${room.style}: ${id}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
