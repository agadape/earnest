/**
 * A keeper: watches every campaign and sends the payouts that anyone is allowed to send, so that
 * nobody has to click to get their money.
 *
 *   - a campaign failed or was braked: every pledge goes back to its backer
 *   - a campaign reached its target: the fee is sent to the treasury
 *   - a campaign is over (failed, braked or completed): what is the creator's is sent to them
 *
 * It has no special rights. The program decides who gets what; the keeper only pays the network
 * fees, from the same throwaway key the other scripts use. The hosted web app does the same from
 * its server, so this is for a local validator or as a second pair of hands.
 *
 *   npm run keeper
 */
import { planSettlement } from "../src/lib/settle";
import { type Campaign, fetchCampaigns, fetchConfig, statusAt } from "../src/lib/tanda-jadi";
import { chainTime, ensureSol, IS_LOCAL, keypair, program, RPC_URL, send, sleep, usd } from "./lib";

const INTERVAL_MS = Number(process.env.INTERVAL_MS ?? (IS_LOCAL ? 2_000 : 10_000));

const payer = keypair("admin");
// Campaigns with nothing left to send. They are final, so they never need another look.
const finished = new Set<string>();

function log(campaign: Campaign, message: string) {
  console.log(`${new Date().toISOString().slice(11, 19)}  ${campaign.title || "(untitled)"}: ${message}`);
}

async function settle(campaign: Campaign, now: number, treasury: Campaign["creator"]) {
  const plan = await planSettlement(program, campaign, now, treasury, payer.publicKey);
  for (const group of plan.groups) {
    await send(group, payer);
  }
  if (plan.refunds > 0) log(campaign, `returned ${plan.refunds} pledge${plan.refunds === 1 ? "" : "s"}`);
  if (plan.fee > 0n) log(campaign, `sent the ${usd(plan.fee)} fee to the treasury`);
  if (plan.creator > 0n) log(campaign, `sent ${usd(plan.creator)} to the creator`);

  const status = statusAt(campaign, now);
  if (status !== "funding" && status !== "building") finished.add(campaign.address.toBase58());
}

async function main() {
  const config = await fetchConfig(program);
  if (!config) throw new Error("Run `npm run setup` first.");
  await ensureSol(payer.publicKey, IS_LOCAL ? 2 : 0.05);
  console.log(`Keeper on ${RPC_URL}, paying fees from ${payer.publicKey.toBase58()}`);

  for (;;) {
    try {
      const now = await chainTime();
      for (const campaign of await fetchCampaigns(program)) {
        if (finished.has(campaign.address.toBase58())) continue;
        // One campaign going wrong must not hold up the others; it is retried on the next round.
        await settle(campaign, now, config.treasury).catch((error) =>
          log(campaign, `skipped for now (${String(error).split("\n")[0]})`),
        );
      }
    } catch (error) {
      console.error(`could not read the chain: ${String(error).split("\n")[0]}`);
    }
    await sleep(INTERVAL_MS);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
