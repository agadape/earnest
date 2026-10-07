/**
 * A keeper: watches every campaign and sends the payouts that anyone is allowed to send, so that
 * nobody has to click to get their money.
 *
 *   - a campaign failed or was braked: every pledge goes back to its backer
 *   - a campaign is over (failed, braked or completed): what is the creator's is sent to them
 *   - a campaign reached its target: the fee is sent to the treasury
 *
 * It has no special rights. The program decides who gets what; the keeper only pays the network
 * fees, from the same throwaway key the other scripts use.
 *
 *   npm run keeper
 */
import type { PublicKey } from "@solana/web3.js";

import {
  type Campaign,
  claimRefundIxs,
  collectFeeIxs,
  creatorClaimable,
  fee,
  fetchCampaigns,
  fetchConfig,
  fetchPledges,
  statusAt,
  withdrawIxs,
} from "../src/lib/tanda-jadi";
import { chainTime, ensureSol, IS_LOCAL, keypair, program, RPC_URL, send, sleep, usd } from "./lib";

const INTERVAL_MS = Number(process.env.INTERVAL_MS ?? (IS_LOCAL ? 2_000 : 10_000));
// Each refund is two instructions; more than this does not fit in one transaction.
const REFUNDS_PER_TRANSACTION = 5;

const payer = keypair("admin");
// Campaigns with nothing left to send. They are final, so they never need another look.
const finished = new Set<string>();

function log(campaign: Campaign, message: string) {
  console.log(`${new Date().toISOString().slice(11, 19)}  ${campaign.title || "(untitled)"}: ${message}`);
}

async function settle(campaign: Campaign, now: number, treasury: PublicKey): Promise<void> {
  const status = statusAt(campaign, now);
  if (status === "funding") return;

  let refundsLeft = 0;
  if (status === "failed" || status === "braked") {
    const pledges = await fetchPledges(program, campaign.address);
    refundsLeft = pledges.length;
    for (let start = 0; start < pledges.length; start += REFUNDS_PER_TRANSACTION) {
      const batch = pledges.slice(start, start + REFUNDS_PER_TRANSACTION);
      const instructions = await Promise.all(
        batch.map((pledge) => claimRefundIxs(program, campaign, pledge.backer, payer.publicKey)),
      );
      await send(instructions.flat(), payer);
      refundsLeft -= batch.length;
      log(campaign, `returned ${batch.length} pledge${batch.length === 1 ? "" : "s"}`);
    }
  }

  const feeDue = status !== "failed" && !campaign.feeCollected && fee(campaign) > 0n;
  if (feeDue) {
    await send(await collectFeeIxs(program, campaign, treasury, payer.publicKey), payer);
    log(campaign, `sent the ${usd(fee(campaign))} fee to the treasury`);
  }

  // While a campaign is being built its creator can take the stream whenever they like; the
  // keeper only steps in once the amount is final.
  if (status === "building") return;
  const owed = creatorClaimable(campaign, now);
  if (owed > 0n) {
    await send(await withdrawIxs(program, campaign, payer.publicKey), payer);
    log(campaign, `sent ${usd(owed)} to the creator`);
  }
  if (refundsLeft === 0) finished.add(campaign.address.toBase58());
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
