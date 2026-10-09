import "server-only";

import { PublicKey } from "@solana/web3.js";
import { cacheLife } from "next/cache";
import { unstable_rethrow } from "next/navigation";

import { clusterTime } from "@/lib/cluster-time";
import { MINT } from "@/lib/env";
import { usd } from "@/lib/format";
import { findCampaign, parseAddress } from "@/lib/lookup";
import { serverConnection } from "@/lib/server/payer";
import { hook, outcome, sentence, titleOf } from "@/lib/summary";
import { getProgram, statusAt } from "@/lib/tanda-jadi";

/** What a link preview says about a campaign. Plain data, so that a cache entry can hold it. */
export interface CampaignPreview {
  address: string;
  title: string;
  backers: number;
  targetBackers: number;
  /** "3 of 5 seats taken · $10.00 a seat" while pledges are taken, then what became of it. */
  line: string;
  /** What the next backer gets back if the seats don't fill. `null` once pledging is over. */
  hook: string | null;
  /** Both as one short text. */
  description: string;
}

// A crawler gives up after a few seconds, and a throttled node can take longer than that.
const PATIENCE_MS = 5_000;

/** `work`, or a failure once it has taken longer than a crawler would wait. */
function inTime<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("the RPC node took too long")), PATIENCE_MS);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/**
 * Link previews are fetched in bursts: one pasted link brings a crawler from every app it is
 * pasted into, each asking for the page and for the picture. A campaign is looked up once and
 * the answer kept for half a minute to a minute, so a burst costs the RPC node a lookup or two
 * instead of one per request. Remote, because a page with the address in its path is rendered
 * per request, where a serverless host keeps no memory from one request to the next.
 *
 * The time limit has to sit in here: a page waits for a lookup it has started for as long as
 * the lookup runs, whether or not anything still listens for the answer. A lookup that fails
 * is not kept, so the next request tries again.
 */
async function lookUp(address: string): Promise<CampaignPreview | null> {
  "use cache: remote";
  cacheLife({ stale: 60, revalidate: 30, expire: 60 });

  const connection = serverConnection();
  const [campaign, now] = await inTime(
    Promise.all([
      findCampaign(getProgram(connection), new PublicKey(address)),
      clusterTime(connection),
    ]),
  );
  // Priced in another token, its amounts would be shown as dollars they are not.
  if (!campaign || !MINT || !campaign.mint.equals(MINT)) return null;

  // What is true at the cluster's time, which is not always what the account still says.
  const status = statusAt(campaign, now);
  return {
    address,
    title: titleOf(campaign),
    backers: campaign.backers,
    targetBackers: campaign.targetBackers,
    line:
      status === "funding"
        ? `${campaign.backers} of ${campaign.targetBackers} seats taken · ${usd(campaign.price)} a seat`
        : outcome(campaign, status),
    hook: status === "funding" ? hook(campaign) : null,
    description: sentence(campaign, status),
  };
}

/**
 * The preview of the campaign at `address`, or `null` when there is none to show: the address
 * is mistyped, holds no campaign of this site, or the network did not answer in time. Never
 * throws for any of those, so a preview falls back to the site's own instead of failing.
 */
export async function campaignPreview(address: string): Promise<CampaignPreview | null> {
  const key = parseAddress(address);
  if (!key) return null;
  try {
    return await lookUp(key.toBase58());
  } catch (error) {
    // When Next.js renders a page ahead of time it stops a lookup like this one by rejecting
    // it, and has to see that rejection itself to know the answer is only known per request.
    unstable_rethrow(error);
    console.error("preview:", error instanceof Error ? error.message : "unknown error");
    return null;
  }
}
