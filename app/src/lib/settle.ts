import type { PublicKey, TransactionInstruction } from "@solana/web3.js";

import {
  type Campaign,
  claimRefundIxs,
  collectFeeIxs,
  creatorClaimable,
  fee,
  fetchPledges,
  statusAt,
  type TandaJadiProgram,
  withdrawIxs,
} from "./tanda-jadi";

/** Refunds per transaction. Each is two instructions; six would still fit, five leaves room. */
export const REFUNDS_PER_TRANSACTION = 5;

export interface Settlement {
  /** One inner list per transaction, in the order they should be sent. */
  groups: TransactionInstruction[][];
  refunds: number;
  fee: bigint;
  creator: bigint;
}

/**
 * Everything a campaign still owes that anyone may send: the refunds once it failed or was
 * braked, the fee once it reached its target, and the creator's share once that amount is final.
 * The program checks every destination, so whoever sends these only pays the network fee.
 */
export async function planSettlement(
  program: TandaJadiProgram,
  campaign: Campaign,
  now: number,
  treasury: PublicKey,
  payer: PublicKey,
): Promise<Settlement> {
  const plan: Settlement = { groups: [], refunds: 0, fee: 0n, creator: 0n };
  const status = statusAt(campaign, now);
  if (status === "funding") return plan;

  if (status === "failed" || status === "braked") {
    const pledges = await fetchPledges(program, campaign.address);
    for (let start = 0; start < pledges.length; start += REFUNDS_PER_TRANSACTION) {
      const batch = pledges.slice(start, start + REFUNDS_PER_TRANSACTION);
      const instructions = await Promise.all(
        batch.map((pledge) => claimRefundIxs(program, campaign, pledge.backer, payer)),
      );
      plan.groups.push(instructions.flat());
    }
    plan.refunds = pledges.length;
  }

  if (status !== "failed" && !campaign.feeCollected && fee(campaign) > 0n) {
    plan.groups.push(await collectFeeIxs(program, campaign, treasury, payer));
    plan.fee = fee(campaign);
  }

  // While a campaign is being built its creator takes the stream whenever they like; this only
  // steps in once the amount is final.
  if (status !== "building") {
    const owed = creatorClaimable(campaign, now);
    if (owed > 0n) {
      plan.groups.push(await withdrawIxs(program, campaign, payer));
      plan.creator = owed;
    }
  }
  return plan;
}
