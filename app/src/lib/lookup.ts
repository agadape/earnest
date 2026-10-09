import { PublicKey } from "@solana/web3.js";

import { type Campaign, fetchCampaign, type TandaJadiProgram } from "@/lib/tanda-jadi";

/** The address a link carries, or `null` when it is incomplete or mistyped. */
export function parseAddress(text: string): PublicKey | null {
  try {
    return new PublicKey(text);
  } catch {
    return null;
  }
}

/** `fetchCampaign`, except that an address holding something else is "no campaign here". */
export function findCampaign(
  program: TandaJadiProgram,
  address: PublicKey,
): Promise<Campaign | null> {
  return fetchCampaign(program, address).catch((error: unknown) => {
    // Only a failure to decode means that. Anything else is a network problem and stays one.
    if (error instanceof Error && /discriminator|beyond buffer|decode/i.test(error.message)) {
      return null;
    }
    throw error;
  });
}
