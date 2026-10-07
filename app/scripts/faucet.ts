/**
 * Gives a wallet demo tokens (and SOL for fees) so it can be used in the web app.
 *
 *   npm run faucet -- <wallet address> [amount in dollars, default 100]
 */
import { PublicKey } from "@solana/web3.js";

import { ensureSol, ensureTokens, IS_LOCAL, keypair, tokenBalance, usd, USD } from "./lib";

async function main() {
  const [address, amount = "100"] = process.argv.slice(2);
  if (!address) {
    throw new Error("Usage: npm run faucet -- <wallet address> [amount in dollars]");
  }

  const wallet = new PublicKey(address);
  const admin = keypair("admin");
  const faucet = keypair("faucet");
  const mint = keypair("mint").publicKey;

  await ensureSol(wallet, IS_LOCAL ? 1 : 0.05, admin);
  const wanted = (await tokenBalance(mint, wallet)) + BigInt(amount) * USD;
  await ensureSol(faucet.publicKey, IS_LOCAL ? 1 : 0.05, admin);
  await ensureTokens(mint, wallet, wanted, faucet);

  console.log(`${wallet.toBase58()} now holds ${usd(await tokenBalance(mint, wallet))}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
