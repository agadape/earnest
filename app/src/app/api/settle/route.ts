import { PublicKey } from "@solana/web3.js";

import { clusterTime } from "@/lib/cluster-time";
import { loadServerKey, sendAsServer, serverConnection } from "@/lib/server/payer";
import { planSettlement } from "@/lib/settle";
import { type Campaign, fetchCampaign, fetchCampaigns, fetchConfig, getProgram } from "@/lib/tanda-jadi";

export const maxDuration = 60;

/** Transactions per campaign per call, so one request stays well inside the time limit. */
const GROUPS_PER_CALL = 8;
const COOLDOWN_MS = 5_000;
const lastRun = new Map<string, number>();

type Context = NonNullable<Awaited<ReturnType<typeof context>>>;

async function context() {
  const key = await loadServerKey();
  if (!key) return null;
  const connection = serverConnection();
  const program = getProgram(connection);
  const config = await fetchConfig(program);
  if (!config) return null;
  return { key, connection, program, treasury: config.treasury, now: await clusterTime(connection) };
}

/** Sends what `campaign` owes, up to `GROUPS_PER_CALL` transactions. */
async function settle(campaign: Campaign, { key, connection, program, treasury, now }: Context) {
  const plan = await planSettlement(program, campaign, now, treasury, key.publicKey);
  const groups = plan.groups.slice(0, GROUPS_PER_CALL);
  for (const group of groups) {
    await sendAsServer(connection, key, group);
  }
  return { sent: groups.length, remaining: plan.groups.length - groups.length };
}

const unavailable = () =>
  Response.json({ error: "Payouts are not automatic on this server." }, { status: 503 });

function failed(error: unknown) {
  // Only the message: never the error object, which may carry the transaction and its signer.
  console.error("settle:", error instanceof Error ? error.message : "unknown error");
  return Response.json(
    { error: "Could not reach the network. Try again in a moment." },
    { status: 502 },
  );
}

/**
 * `POST /api/settle` with `{ "campaign": "<address>" }`: sends whatever that campaign owes that
 * anyone may send (refunds, the fee, the creator's final share), paid for by the server's key.
 * The campaign page calls this the moment a campaign fails, so nobody has to click to get their
 * money back. The program decides who gets what; this only pays the network fee.
 */
export async function POST(request: Request) {
  let raw: unknown;
  try {
    ({ campaign: raw } = (await request.json()) as { campaign?: unknown });
  } catch {
    raw = undefined;
  }
  let address: PublicKey;
  try {
    if (typeof raw !== "string") throw new Error();
    address = new PublicKey(raw);
  } catch {
    return Response.json({ error: 'Send a JSON body like { "campaign": "…" }.' }, { status: 400 });
  }

  const now = Date.now();
  if (now - (lastRun.get(address.toBase58()) ?? 0) < COOLDOWN_MS) {
    return Response.json({ error: "This campaign was just handled." }, { status: 429 });
  }
  lastRun.set(address.toBase58(), now);

  try {
    const ctx = await context();
    if (!ctx) return unavailable();
    const campaign = await fetchCampaign(ctx.program, address);
    if (!campaign) return Response.json({ error: "No campaign at this address." }, { status: 404 });
    return Response.json(await settle(campaign, ctx));
  } catch (error) {
    return failed(error);
  }
}

/**
 * `GET /api/settle`: the same for every campaign at once. Vercel's cron calls it daily (see
 * `vercel.json`) for the campaigns nobody opened in a browser. It needs `CRON_SECRET`.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const ctx = await context();
    if (!ctx) return unavailable();
    const summary: Record<string, { sent: number; remaining: number } | "skipped"> = {};
    for (const campaign of await fetchCampaigns(ctx.program)) {
      // One campaign going wrong must not hold up the others; it is retried tomorrow.
      summary[campaign.address.toBase58()] = await settle(campaign, ctx).catch(() => "skipped");
    }
    return Response.json(summary);
  } catch (error) {
    return failed(error);
  }
}
