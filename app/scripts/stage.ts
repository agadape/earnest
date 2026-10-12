/**
 * Sets the stage for a walkthrough or a recording. A creator with a short history opens three
 * campaigns, each one step short of the moment worth showing, and this script plays everyone
 * except you.
 *
 *   The record   Two campaigns that are already over: one ran to the end, one did not fill and
 *                paid its bonus. They are what the creator's record shows.
 *   The market   Three of six seats are taken. A bonus seat has changed hands three times and is
 *                on offer again. You buy it.
 *   The build    Four of five seats are taken. You take the last one and the build starts. The
 *                creator stays silent; two backers pull the brake, and yours is the deciding one.
 *   The miss     Opened last, with a short deadline and one backer. You take the second bonus
 *                seat, the deadline passes, and your deposit comes back with the bonus.
 *
 *   npm run stage
 *
 * `npm run showcase` sets the same stage to last, for visitors who arrive when nobody is at the
 * keyboard: the campaigns stay open for weeks, the build is already running with a seat on
 * offer in it, and the script exits as soon as everything is in place.
 *
 * Run `npm run setup` first, and leave this running until it says it is done: it is what pulls
 * the two brakes.
 */
import readline from "node:readline/promises";

import { Keypair } from "@solana/web3.js";

import {
  brakesNeeded,
  buySeatIxs,
  type Campaign,
  campaignAddress,
  type CampaignTerms,
  claimRefundIxs,
  collectFeeIxs,
  createCampaignIx,
  fetchCampaign,
  fetchConfig,
  fetchListing,
  fetchListings,
  listSeatIx,
  pledgeIx,
  postUpdateIx,
  setBrakeIx,
  withdrawIxs,
} from "../src/lib/tanda-jadi";
import {
  chainTime,
  ensureSol,
  ensureTokens,
  IS_LOCAL,
  keypair,
  program,
  RPC_URL,
  send,
  sleep,
  usd,
  USD,
  waitUntil,
} from "./lib";

const SHOWCASE = process.argv.includes("showcase");
const DAY = 86_400;

/** How long the campaign that is meant to fail stays open. */
const MISS_SECS = Number(process.env.MISS_SECS ?? (SHOWCASE ? 21 * DAY : 135));
/**
 * How long the other two stay open. Long enough to get through a take without hurry, short enough
 * that an unused stage is off the list of open campaigns before the next one is set.
 */
const OPEN_SECS = Number(process.env.OPEN_SECS ?? (SHOWCASE ? 30 * DAY : 1_800));
const BUILD_SECS = Number(process.env.BUILD_SECS ?? (SHOWCASE ? 30 * DAY : 600));
/** How long the build runs before the scripted backers lose patience. */
const QUIET_SECS = Number(process.env.QUIET_SECS ?? 20);
/**
 * How long the two campaigns of the record last. A pledge has to land inside this, which takes
 * a moment on a public network.
 */
const HISTORY_SECS = Number(process.env.HISTORY_SECS ?? (IS_LOCAL ? 6 : 25));
/** After this long with nothing left to wait for but you, the script stops watching. */
const WATCH_SECS = Number(process.env.WATCH_SECS ?? 3_600);
const SITE_URL =
  process.env.SITE_URL ?? (IS_LOCAL ? "http://localhost:3000" : "https://inearnest.vercel.app");

const admin = keypair("admin");
const faucet = keypair("faucet");
const mint = keypair("mint").publicKey;
// A new creator for every stage, so the record the app shows for them is exactly the history
// set up below and not what earlier runs left behind.
const budi = Keypair.generate();
const [rina, sari, tono, wati, yoga] = ["rina", "sari", "tono", "wati", "yoga"].map(keypair);

const clock = (date = new Date()) => date.toTimeString().slice(0, 8);
// Whole cents, rounded down, the way the app shows amounts.
const cents = (amount: bigint) => usd(amount - (amount % 10_000n));
const log = (message: string) => console.log(`${clock()}  ${message}`);
const link = (campaign: Campaign) => `${SITE_URL}/campaign/${campaign.address.toBase58()}`;

// Payouts can be sent by anyone, so the app's own server may get there first. Then the money
// has already arrived and there is nothing left for this script to send.
const alreadySent = () => undefined;

async function open(terms: Omit<CampaignTerms, "id" | "uri">): Promise<Campaign> {
  const id = BigInt(Date.now());
  await send([await createCampaignIx(program, budi.publicKey, mint, { ...terms, id, uri: "" })], budi);
  return load(campaignAddress(budi.publicKey, id));
}

async function load(address: Campaign["address"]): Promise<Campaign> {
  const campaign = await fetchCampaign(program, address);
  if (!campaign) throw new Error(`campaign ${address.toBase58()} not found`);
  return campaign;
}

async function pledge(campaign: Campaign, backers: Keypair[]) {
  for (const backer of backers) {
    await send([await pledgeIx(program, campaign, backer.publicKey)], backer);
  }
}

/** Budi tells the backers of `campaign` where things stand. */
async function say(campaign: Campaign, text: string) {
  await send([await postUpdateIx(program, campaign.address, budi.publicKey, text)], budi);
}

/** `seller` offers their seat for `ask` and `buyer` takes it. */
async function trade(campaign: Campaign, seller: Keypair, buyer: Keypair, ask: bigint) {
  await send([await listSeatIx(program, campaign.address, seller.publicKey, ask)], seller);
  const offer = (await fetchListings(program, campaign.address)).find((listing) =>
    listing.seller.equals(seller.publicKey),
  );
  if (!offer) throw new Error("the offer that was just made is not on chain");
  await send(await buySeatIxs(program, campaign, offer, buyer.publicKey), buyer);
}

async function main() {
  const config = await fetchConfig(program);
  if (!config) throw new Error("Run `npm run setup` first.");

  const sol = IS_LOCAL ? 1 : 0.05;
  await ensureSol(admin.publicKey, IS_LOCAL ? 2 : 0.5);
  await ensureSol(faucet.publicKey, sol, admin);
  // Five campaigns and three journals are paid for by their creator.
  await ensureSol(budi.publicKey, IS_LOCAL ? 1 : 0.1, admin);
  await ensureTokens(mint, budi.publicKey, 30n * USD, faucet);
  for (const backer of [rina, sari, tono, wati, yoga]) {
    await ensureSol(backer.publicKey, sol, admin);
    await ensureTokens(mint, backer.publicKey, 40n * USD, faucet);
  }
  log(`Setting the stage on ${new URL(RPC_URL).host}. This takes a minute or two.`);

  // The record. Both campaigns are short enough to be over by the time the rest is set up.
  const missed = await open({
    title: "A Grafana dashboard for validator rewards",
    price: 10n * USD,
    targetBackers: 5,
    earlySlots: 2,
    bonusPerEarly: 2_500_000n,
    fundingSecs: HISTORY_SECS,
    buildSecs: 14 * 86_400,
    upfrontBps: 2_000,
  });
  await pledge(missed, [sari]);
  const shipped = await open({
    title: "Diff two Anchor IDLs from the command line",
    price: 5n * USD,
    targetBackers: 3,
    earlySlots: 1,
    bonusPerEarly: 1n * USD,
    fundingSecs: OPEN_SECS,
    buildSecs: HISTORY_SECS,
    upfrontBps: 2_000,
  });
  await pledge(shipped, [tono, wati, yoga]);
  await say(shipped, "v0.1 is out. Thank you to the three of you who asked for it.");
  const shippedAt = (await load(shipped.address)).fundedAt + HISTORY_SECS;

  // The market: one bonus seat goes round three times, so the page has prices to draw, and ends
  // up on offer for more than it last sold for.
  const market = await open({
    title: "Replay any failed Solana transaction locally",
    price: 10n * USD,
    targetBackers: 6,
    earlySlots: 3,
    bonusPerEarly: 2_500_000n,
    fundingSecs: OPEN_SECS,
    buildSecs: 14 * 86_400,
    upfrontBps: 2_000,
  });
  await pledge(market, [rina, sari, tono]);
  await say(market, "The prototype replays a failed swap from start to finish.");
  await trade(market, rina, wati, 10_800_000n);
  await trade(market, wati, yoga, 11_200_000n);
  await trade(market, yoga, rina, 11_000_000n);
  await send([await listSeatIx(program, market.address, rina.publicKey, 11_500_000n)], rina);
  log("The market is ready: three sales on record, seat 1 on offer for $11.50.");

  // The build: one seat short of full. This is the last the backers hear from Budi.
  const build = await open({
    title: "A VS Code extension that explains Anchor errors",
    price: 10n * USD,
    targetBackers: 5,
    earlySlots: 2,
    bonusPerEarly: 2_500_000n,
    fundingSecs: OPEN_SECS,
    buildSecs: BUILD_SECS,
    upfrontBps: 2_000,
  });
  await pledge(build, [rina, sari, tono, wati]);
  await say(build, "The spec is written. I start the day the last seat is taken.");
  if (SHOWCASE) {
    // Nobody is there to take the last seat, so a backer does, and the build is under way
    // when a visitor arrives. One seat is on offer so that they can buy in and try the brake.
    await pledge(build, [yoga]);
    await say(build, "Day 1: the extension reads error codes straight from the IDL.");
    await send([await listSeatIx(program, build.address, wati.publicKey, 10_500_000n)], wati);
    log("The build is under way, with seat 4 on offer for $10.50.");
  } else {
    log("The build is ready: four of five seats taken.");
  }

  // The record again, now that both of its campaigns are over: what is owed gets paid.
  await waitUntil(Math.max(missed.deadline, shippedAt));
  await send(await claimRefundIxs(program, missed, sari.publicKey, admin.publicKey), admin).catch(
    alreadySent,
  );
  for (const over of [missed, shipped]) {
    await send(await withdrawIxs(program, over, admin.publicKey), admin).catch(alreadySent);
  }
  await send(
    await collectFeeIxs(program, shipped, config.treasury, admin.publicKey),
    admin,
  ).catch(alreadySent);
  log("The record is ready: one campaign ran to the end, one did not fill and paid its bonus.");

  if (process.stdin.isTTY && !SHOWCASE) {
    const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
    await prompt.question(
      `\nThe last campaign fails ${MISS_SECS} seconds after it opens. ` +
        `The other two stay open until ${clock(new Date(build.deadline * 1000))}.\n` +
        "Press Enter when you are ready to start. ",
    );
    prompt.close();
  }

  const miss = await open({
    title: "Turn any Anchor IDL into a Postman collection",
    price: 10n * USD,
    targetBackers: 5,
    earlySlots: 2,
    bonusPerEarly: 2_500_000n,
    fundingSecs: MISS_SECS,
    buildSecs: 14 * 86_400,
    upfrontBps: 2_000,
  });
  await pledge(miss, [yoga]);
  if (SHOWCASE) {
    console.log(`
The showcase is set and stays up by itself.

  Taking pledges, a bonus seat left   ${link(miss)}
  A seat on offer, three sales        ${link(market)}
  Being built, a seat on offer        ${link(build)}
  The creator's record                ${SITE_URL}/creator/${budi.publicKey.toBase58()}
`);
    return;
  }
  const left = miss.deadline - (await chainTime());

  console.log(`
Go. Everything below is open in the app now.

  1. The miss    ${link(miss)}
                 Pledge $10 for seat 2, a bonus seat. It fails at ${clock(new Date(miss.deadline * 1000))},
                 in ${left} s, and pays you $12.50.
  2. The market  ${link(market)}
                 Buy seat 1 for $11.50.
  3. The build   ${link(build)}
                 Take the last seat. The creator says nothing; ${QUIET_SECS} s into the build two
                 backers pull the brake. Then pull yours.
  4. The miss    again, to watch the deadline pass and $12.50 arrive.

  The creator's record: ${SITE_URL}/creator/${budi.publicKey.toBase58()}

Keep this window open. Ctrl+C stops it.
`);

  await watch(miss, market, build);
}

/** Reports what you do in the app, and plays the two backers who lose patience with the build. */
async function watch(miss: Campaign, market: Campaign, build: Campaign) {
  const pending = { miss: true, market: true, build: true };
  const impatient = [rina, sari];
  const giveUpAt = Date.now() + WATCH_SECS * 1000;

  while ((pending.miss || pending.market || pending.build) && Date.now() < giveUpAt) {
    await sleep(IS_LOCAL ? 1_000 : 4_000);
    const now = await chainTime();

    if (pending.miss && now >= miss.deadline) {
      const { backers, targetBackers } = await load(miss.address);
      log(
        `The miss: the deadline passed with ${backers} of ${targetBackers} seats taken. ` +
          "Open its page and the deposits go back by themselves.",
      );
      pending.miss = false;
    }

    if (pending.market && !(await fetchListing(program, market.address, rina.publicKey))) {
      log("The market: seat 1 was bought. The sale is on the page.");
      pending.market = false;
    } else if (pending.market && now >= market.deadline) {
      log("The market: its deadline passed with seat 1 still on offer.");
      pending.market = false;
    }

    if (pending.build) {
      const current = await load(build.address);
      if (current.status === "braked") {
        log(`The build: braked. Each backer gets ${cents(current.refundPerBacker)} back.`);
        pending.build = false;
      } else if (current.status !== "funding" && current.status !== "building") {
        pending.build = false;
      } else if (current.fundedAt === 0 && now >= current.deadline) {
        log("The build: nobody took the last seat in time.");
        pending.build = false;
      } else if (current.fundedAt > 0 && now >= current.fundedAt + current.buildSecs) {
        log("The build: the build period ended without a third brake.");
        pending.build = false;
      } else if (current.fundedAt > 0 && impatient.length > 0 && now >= current.fundedAt + QUIET_SECS) {
        const backer = impatient.shift() as Keypair;
        // Fails only if the campaign was braked in the meantime, which the next round reports.
        await send([await setBrakeIx(program, build.address, backer.publicKey, true)], backer).catch(
          () => undefined,
        );
        const { brakes } = await load(build.address);
        log(`The build: a backer pulls the brake (${brakes} of ${brakesNeeded(current)} needed).`);
      }
    }
  }

  log(
    pending.miss || pending.market || pending.build
      ? "Stopped watching. What is still open stays open in the app."
      : "Done. Nothing on this stage is left to wait for.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
