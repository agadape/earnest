/**
 * The whole product in about a minute, on a real cluster with scripted wallets.
 *
 * Budi opens two identical campaigns: five seats at $10, a $2.50 bonus for the first two backers
 * (a $5 bond), a short funding window and a short build period.
 *
 *   Campaign A fills up. Money streams to Budi, three backers pull the brake, the rest goes back.
 *   Campaign B stops at three of five. One backer sells her bonus seat instead of waiting.
 *   Then everyone holding a seat is refunded, and the two bonus seats get the bonus.
 *
 *   npm run demo
 *
 * Run `npm run setup` first. The web app shows the same campaigns while this runs.
 */
import type { Keypair, PublicKey } from "@solana/web3.js";

import {
  bond,
  buySeatIxs,
  type Campaign,
  campaignAddress,
  type CampaignTerms,
  claimRefundIxs,
  collectFeeIxs,
  createCampaignIx,
  fetchCampaign,
  fetchConfig,
  fetchListings,
  fetchPledges,
  impliedFailureChance,
  listSeatIx,
  pledgeIx,
  setBrakeIx,
  statusAt,
  tokenAccount,
  withdrawIxs,
} from "../src/lib/tanda-jadi";
import {
  chainTime,
  ensureSol,
  ensureTokens,
  IS_LOCAL,
  keypair,
  program,
  send,
  sleep,
  tokenBalance,
  usd,
  USD,
  waitUntil,
} from "./lib";

const FUNDING_SECS = Number(process.env.FUNDING_SECS ?? 40);
const BUILD_SECS = Number(process.env.BUILD_SECS ?? 180);
const PAUSE_MS = Number(process.env.PAUSE_MS ?? 1500);

const BACKER_NAMES = ["rina", "sari", "tono", "wati", "yoga"];

// Pays for the transactions "anyone" may send: refunds and payouts need no signature from the
// person receiving them.
const admin = keypair("admin");
// Mints the demo token.
const faucet = keypair("faucet");
const mint = keypair("mint").publicKey;
const budi = keypair("budi");
const backers = BACKER_NAMES.map((name) => ({ name, wallet: keypair(name) }));

let startedAt = 0;

// Payouts can be sent by anyone, so a keeper (`npm run keeper`) may get there first. Then the
// money has already arrived and there is nothing left for this script to send.
const alreadySent = () => undefined;

// Stamped with the local clock: asking the chain for the time on every line is what gets a
// script throttled on a public RPC node.
async function log(message: string) {
  const elapsed = Math.round(Date.now() / 1000 - startedAt);
  console.log(`[${String(elapsed).padStart(3)}s] ${message}`);
}

const balance = (owner: Keypair) => tokenBalance(mint, owner.publicKey);
const nameOf = (address: PublicKey) =>
  backers.find(({ wallet }) => wallet.publicKey.equals(address))?.name ?? "someone";

/** Returns every pledge still in `campaign` to whoever holds the seat now. */
async function refundHolders(label: string, campaign: Campaign) {
  const pledges = await fetchPledges(program, campaign.address);
  if (pledges.length === 0) await log(`${label}: a keeper already returned every pledge.`);
  for (const { backer, index } of pledges) {
    const before = await tokenBalance(mint, backer);
    await send(
      await claimRefundIxs(program, campaign, backer, admin.publicKey),
      admin,
    ).catch(alreadySent);
    await log(
      `${label}: ${nameOf(backer)} (seat ${index + 1}) is refunded: ` +
        `${usd(before)} -> ${usd(await tokenBalance(mint, backer))}`,
    );
  }
}

async function load(address: Campaign["address"]): Promise<Campaign> {
  const campaign = await fetchCampaign(program, address);
  if (!campaign) throw new Error(`campaign ${address.toBase58()} not found`);
  return campaign;
}

async function main() {
  const config = await fetchConfig(program);
  if (!config) throw new Error("Run `npm run setup` first.");

  // Everyone starts from the same, exact balances so the numbers below are easy to follow.
  const sol = IS_LOCAL ? 1 : 0.05;
  await ensureSol(admin.publicKey, IS_LOCAL ? 2 : 0.5);
  await ensureSol(budi.publicKey, sol, admin);
  await ensureSol(faucet.publicKey, IS_LOCAL ? 1 : 0.05, admin);
  await ensureTokens(mint, budi.publicKey, 10n * USD, faucet);
  for (const { wallet } of backers) {
    await ensureSol(wallet.publicKey, sol, admin);
    await ensureTokens(mint, wallet.publicKey, 25n * USD, faucet);
  }
  const budiStart = await balance(budi);
  const backerStart = await Promise.all(backers.map(({ wallet }) => balance(wallet)));
  const rinaStart = backerStart[0];

  startedAt = Date.now() / 1000;
  const run = BigInt(Date.now());
  const terms = (id: bigint, title: string): CampaignTerms => ({
    id,
    title,
    uri: "",
    price: 10n * USD,
    targetBackers: 5,
    earlySlots: 2,
    bonusPerEarly: 2_500_000n,
    fundingSecs: FUNDING_SECS,
    buildSecs: BUILD_SECS,
    upfrontBps: 2_000,
  });
  const termsA = terms(run, "Budi's tool (demo A)");
  const termsB = terms(run + 1n, "Budi's tool (demo B)");
  const a = campaignAddress(budi.publicKey, termsA.id);
  const b = campaignAddress(budi.publicKey, termsB.id);

  await send([await createCampaignIx(program, budi.publicKey, mint, termsA)], budi);
  await send([await createCampaignIx(program, budi.publicKey, mint, termsB)], budi);
  const campaignA = await load(a);
  const campaignB = await load(b);
  await log(
    `Budi opens two campaigns: 5 seats x ${usd(termsA.price)}, ${FUNDING_SECS}s to fill them, ` +
      `${usd(termsA.bonusPerEarly)} bonus for the first ${termsA.earlySlots}. ` +
      `He locks ${usd(bond(campaignA))} in each (${usd(budiStart)} -> ${usd(await balance(budi))}).`,
  );
  console.log(`       A ${a.toBase58()}\n       B ${b.toBase58()}`);

  // Five backers join A. Only the first three also join B.
  for (const [index, { name, wallet }] of backers.entries()) {
    await sleep(PAUSE_MS);
    await send([await pledgeIx(program, campaignA, wallet.publicKey)], wallet);
    if (index < 3) {
      await send([await pledgeIx(program, campaignB, wallet.publicKey)], wallet);
    }
    await log(`${name} pledges to A${index < 3 ? " and B" : ""}`);
  }
  await log(
    `A is full: ${(await load(a)).status}. B has 3 of 5. ` +
      `rina holds ${usd(await balance(backers[0].wallet))} (started with ${usd(rinaStart)}).`,
  );

  // A reached its target, so the upfront share is Budi's at once.
  await send(await withdrawIxs(program, campaignA, admin.publicKey), admin);
  await log(`A: Budi receives the upfront share. He holds ${usd(await balance(budi))}.`);

  // Sari holds a bonus seat in B and would rather not wait. She offers it, and Wati, who has no
  // seat in B, buys it. The seat keeps its place in the queue, and with it the bonus.
  const [, sari, , wati] = backers;
  await send([await listSeatIx(program, b, sari.wallet.publicKey, 11_500_000n)], sari.wallet);
  const [offer] = await fetchListings(program, b);
  const chance = impliedFailureChance(campaignB, offer.ask);
  await log(
    `B: sari offers her bonus seat for ${usd(offer.ask)}. That makes sense if she puts the ` +
      `chance of B not filling at about ${Math.round((chance ?? 0) * 100)}% or lower.`,
  );
  await sleep(PAUSE_MS);
  await send(await buySeatIxs(program, campaignB, offer, wati.wallet.publicKey), wati.wallet);
  await log(`B: wati buys it. sari holds ${usd(await balance(sari.wallet))} and is out.`);

  // B runs out of time. Nobody has to declare it failed: the first refund does.
  await waitUntil(campaignB.deadline);
  await log("B: the deadline passed with 3 of 5 seats taken.");
  await refundHolders("B", campaignB);
  await log(
    `B: ${statusAt(await load(b), await chainTime())}. ` +
      `Vault ${usd(await tokenBalance(mint, b))}, Budi's bond is gone.`,
  );

  // Back to A, where the build period has been running in the meantime.
  await send(await withdrawIxs(program, campaignA, admin.publicKey), admin);
  await log(`A: the stream so far reaches Budi. He holds ${usd(await balance(budi))}.`);

  for (const { name, wallet } of backers.slice(0, 3)) {
    await sleep(PAUSE_MS);
    await send([await setBrakeIx(program, a, wallet.publicKey, true)], wallet);
    await log(`A: ${name} pulls the brake`);
  }
  const braked = await load(a);
  await log(
    `A: ${braked.status}. The stream stopped; each backer gets ${usd(braked.refundPerBacker)} back.`,
  );
  // Whatever was released between Budi's last withdrawal and the brake is still his.
  await send(await withdrawIxs(program, campaignA, admin.publicKey), admin).catch(alreadySent);
  await refundHolders("A", campaignA);
  await send(
    await collectFeeIxs(program, campaignA, config.treasury, admin.publicKey),
    admin,
  ).catch(alreadySent);

  console.log("\nFinal balances");
  console.log(`  budi  ${usd(await balance(budi))}  (started with ${usd(budiStart)})`);
  for (const [index, { name, wallet }] of backers.entries()) {
    console.log(
      `  ${name.padEnd(5)} ${usd(await balance(wallet))}  (started with ${usd(backerStart[index])})`,
    );
  }
  console.log(`  fee   ${usd(await tokenBalance(mint, config.treasury))} in the treasury`);
  console.log(
    `  vaults: A ${usd(await tokenBalance(mint, a))}, B ${usd(await tokenBalance(mint, b))}` +
      `  (${tokenAccount(mint, a).toBase58()}, ${tokenAccount(mint, b).toBase58()})`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
