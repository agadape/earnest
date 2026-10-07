import { drip, FaucetError } from "@/lib/server/faucet";

/**
 * `POST /api/faucet` with `{ "address": "<wallet>" }`: 100 demo dollars and SOL for fees.
 * The key that pays for it stays on the server; see `lib/server/faucet.ts`.
 */
export async function POST(request: Request) {
  let address: unknown;
  try {
    ({ address } = (await request.json()) as { address?: unknown });
  } catch {
    address = undefined;
  }
  if (typeof address !== "string") {
    return Response.json({ error: 'Send a JSON body like { "address": "…" }.' }, { status: 400 });
  }

  try {
    return Response.json(await drip(address));
  } catch (error) {
    if (error instanceof FaucetError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    // Only the message: never the error object, which may carry the transaction and its signer.
    console.error("faucet:", error instanceof Error ? error.message : "unknown error");
    return Response.json(
      { error: "The faucet could not reach the network. Try again in a moment." },
      { status: 502 },
    );
  }
}
