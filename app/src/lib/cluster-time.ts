import { type Connection, SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";

/** What the program will read as "now": the timestamp of the most recent confirmed block. */
export async function clusterTime(connection: Connection): Promise<number> {
  try {
    const time = await connection.getBlockTime(await connection.getSlot("confirmed"));
    if (time !== null) return time;
  } catch {
    // Some nodes cannot answer for the newest slot yet. The clock account below always can.
  }
  const clock = await connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY, "confirmed");
  if (!clock) throw new Error("the cluster did not report its time");
  // Layout: slot, epoch start timestamp, epoch, leader schedule epoch, unix timestamp.
  return Number(clock.data.readBigInt64LE(32));
}
