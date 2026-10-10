/**
 * What the campaigns a wallet has opened add up to. All of it is read from the campaigns
 * themselves; nothing is reported by the creator.
 */
import { usd } from "@/lib/format";
import { bond, type Campaign, statusAt, streamTotal, upfront } from "@/lib/tanda-jadi";

export interface CreatorRecord {
  opened: number;
  /** Still taking pledges or being built. */
  open: number;
  completed: number;
  failed: number;
  braked: number;
  /** Owed from the creator's bonds to early backers of campaigns that did not fill. */
  bonuses: bigint;
  /** Bonds that went to the backers who stopped a build. */
  bondsLost: bigint;
  /** What campaigns that ran to the end paid the creator. */
  earned: bigint;
}

export function recordOf(campaigns: Campaign[], now: number): CreatorRecord {
  const record: CreatorRecord = {
    opened: campaigns.length,
    open: 0,
    completed: 0,
    failed: 0,
    braked: 0,
    bonuses: 0n,
    bondsLost: 0n,
    earned: 0n,
  };
  for (const campaign of campaigns) {
    switch (statusAt(campaign, now)) {
      case "funding":
      case "building":
        record.open += 1;
        break;
      case "completed":
        record.completed += 1;
        record.earned += upfront(campaign) + streamTotal(campaign);
        break;
      case "failed":
        record.failed += 1;
        record.bonuses +=
          campaign.bonusPerEarly * BigInt(Math.min(campaign.backers, campaign.earlySlots));
        break;
      case "braked":
        record.braked += 1;
        record.bondsLost += bond(campaign);
        break;
    }
  }
  return record;
}

/** `"1 completed, 2 didn't fill ($10.00 paid in bonuses), 1 still open"`. */
export function describeRecord(record: CreatorRecord): string {
  const parts: string[] = [];
  if (record.completed > 0) parts.push(`${record.completed} completed`);
  if (record.failed > 0) {
    parts.push(
      `${record.failed} didn't fill` +
        (record.bonuses > 0n ? ` (${usd(record.bonuses)} paid in bonuses)` : ""),
    );
  }
  if (record.braked > 0) parts.push(`${record.braked} stopped by backers`);
  if (record.open > 0) parts.push(`${record.open} still open`);
  return parts.join(", ");
}
