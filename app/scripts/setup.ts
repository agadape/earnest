/**
 * One-time setup of a cluster for development: the program's config, a demo token standing in
 * for USDC, and `app/.env.local` so the web app points at both.
 *
 *   npm run setup                                            (local validator)
 *   RPC_URL=https://api.devnet.solana.com npm run setup      (devnet)
 *
 * Safe to run again; it only creates what is missing.
 */
import fs from "node:fs";
import path from "node:path";

import { createMint } from "@solana/spl-token";

import { fetchConfig, initializeConfigIx, PROGRAM_ID } from "../src/lib/tanda-jadi";
import { connection, ensureSol, hasKeypair, keypair, program, RPC_URL, send } from "./lib";

const FEE_BPS = 300;

async function main() {
  if (!(await connection.getAccountInfo(PROGRAM_ID))) {
    throw new Error(`The program ${PROGRAM_ID.toBase58()} is not deployed on ${RPC_URL}.`);
  }

  const admin = keypair("admin");
  await ensureSol(admin.publicKey, 2);

  let config = await fetchConfig(program);
  if (!config) {
    const treasury = keypair("treasury").publicKey;
    await send([await initializeConfigIx(program, admin.publicKey, treasury, FEE_BPS)], admin);
    config = await fetchConfig(program);
    console.log(`Config created. Fee ${FEE_BPS / 100}%, treasury ${treasury.toBase58()}`);
  } else {
    console.log(`Config exists. Fee ${config.feeBps / 100}%, admin ${config.admin.toBase58()}`);
  }

  // The demo token's address is a keypair of its own so that it stays the same across runs.
  const mintExisted = hasKeypair("mint");
  const mintKeypair = keypair("mint");
  if (!mintExisted || !(await connection.getAccountInfo(mintKeypair.publicKey))) {
    await createMint(connection, admin, admin.publicKey, null, 6, mintKeypair);
    console.log(`Demo token created: ${mintKeypair.publicKey.toBase58()}`);
  } else {
    console.log(`Demo token exists: ${mintKeypair.publicKey.toBase58()}`);
  }

  const envFile = path.resolve(process.cwd(), ".env.local");
  // Only these two lines are ours; anything else already in the file is kept.
  const ours: Record<string, string> = {
    NEXT_PUBLIC_RPC_URL: RPC_URL,
    NEXT_PUBLIC_MINT: mintKeypair.publicKey.toBase58(),
  };
  const kept = (fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8").split("\n") : []).filter(
    (line) => line.trim() !== "" && !(line.split("=")[0] in ours),
  );
  const lines = [...Object.entries(ours).map(([key, value]) => `${key}=${value}`), ...kept];
  fs.writeFileSync(envFile, `${lines.join("\n")}\n`);
  console.log(`Wrote ${path.relative(process.cwd(), envFile)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
