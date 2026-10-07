/**
 * Client for the Tanda Jadi program, shared by the web app and the scripts.
 *
 * Token amounts are `bigint` in base units (six decimals for USDC), times are Unix seconds.
 * The functions under "Money" mirror `programs/tanda-jadi/src/state.rs` so the interface can show
 * what a transaction will pay before it is sent. The program stays the source of truth.
 */
import { BN, Program, type IdlAccounts } from "@anchor-lang/core";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  type Connection,
  PublicKey,
  type TransactionInstruction,
} from "@solana/web3.js";

import idl from "./idl.json";
import type { TandaJadi } from "./idl-types";

export type TandaJadiProgram = Program<TandaJadi>;

export const PROGRAM_ID = new PublicKey(idl.address);
export const BPS_DENOMINATOR = 10_000n;
export const MAX_UPFRONT_BPS = 3_000;
export const MAX_TITLE_LENGTH = 64;
export const MAX_URI_LENGTH = 200;

/** A program handle that can read accounts and build instructions. Sending is up to the caller. */
export function getProgram(connection: Connection): TandaJadiProgram {
  return new Program<TandaJadi>(idl as TandaJadi, { connection });
}

// ---------------------------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------------------------

export function configAddress(): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID)[0];
}

export function campaignAddress(creator: PublicKey, id: bigint): PublicKey {
  // Not `Buffer.writeBigUInt64LE`: the `Buffer` that bundlers put into browser code lacks it.
  const idBytes = new Uint8Array(8);
  new DataView(idBytes.buffer).setBigUint64(0, id, true);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("campaign"), creator.toBuffer(), idBytes],
    PROGRAM_ID,
  )[0];
}

export function pledgeAddress(campaign: PublicKey, backer: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pledge"), campaign.toBuffer(), backer.toBuffer()],
    PROGRAM_ID,
  )[0];
}

/** The token account of `owner`. For a campaign address this is its vault. */
export function tokenAccount(mint: PublicKey, owner: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, owner, true);
}

// ---------------------------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------------------------

export type Status = "funding" | "building" | "failed" | "braked" | "completed";

export interface Campaign {
  address: PublicKey;
  creator: PublicKey;
  mint: PublicKey;
  id: bigint;
  title: string;
  uri: string;

  price: bigint;
  targetBackers: number;
  earlySlots: number;
  bonusPerEarly: bigint;
  deadline: number;
  buildSecs: number;
  upfrontBps: number;
  feeBps: number;

  /** As stored. Use `statusAt` for what is true right now. */
  status: Status;
  backers: number;
  brakes: number;
  fundedAt: number;
  brakedAt: number;
  refundPerBacker: bigint;
  creatorWithdrawn: bigint;
  feeCollected: boolean;
}

export interface Pledge {
  address: PublicKey;
  campaign: PublicKey;
  backer: PublicKey;
  /** Position in the queue, starting at zero. Positions below `earlySlots` carry the bonus. */
  index: number;
  braked: boolean;
}

export interface Config {
  admin: PublicKey;
  treasury: PublicKey;
  feeBps: number;
}

type RawCampaign = IdlAccounts<TandaJadi>["campaign"];
type RawPledge = IdlAccounts<TandaJadi>["pledge"];

const big = (value: BN): bigint => BigInt(value.toString());

function toCampaign(address: PublicKey, raw: RawCampaign): Campaign {
  return {
    address,
    creator: raw.creator,
    mint: raw.mint,
    id: big(raw.id),
    title: raw.title,
    uri: raw.uri,
    price: big(raw.price),
    targetBackers: raw.targetBackers,
    earlySlots: raw.earlySlots,
    bonusPerEarly: big(raw.bonusPerEarly),
    deadline: raw.deadline.toNumber(),
    buildSecs: raw.buildSecs.toNumber(),
    upfrontBps: raw.upfrontBps,
    feeBps: raw.feeBps,
    status: Object.keys(raw.status)[0] as Status,
    backers: raw.backers,
    brakes: raw.brakes,
    fundedAt: raw.fundedAt.toNumber(),
    brakedAt: raw.brakedAt.toNumber(),
    refundPerBacker: big(raw.refundPerBacker),
    creatorWithdrawn: big(raw.creatorWithdrawn),
    feeCollected: raw.feeCollected,
  };
}

function toPledge(address: PublicKey, raw: RawPledge): Pledge {
  return {
    address,
    campaign: raw.campaign,
    backer: raw.backer,
    index: raw.index,
    braked: raw.braked,
  };
}

export async function fetchConfig(program: TandaJadiProgram): Promise<Config | null> {
  const raw = await program.account.config.fetchNullable(configAddress());
  return raw && { admin: raw.admin, treasury: raw.treasury, feeBps: raw.feeBps };
}

export async function fetchCampaign(
  program: TandaJadiProgram,
  address: PublicKey,
): Promise<Campaign | null> {
  const raw = await program.account.campaign.fetchNullable(address);
  return raw && toCampaign(address, raw);
}

export async function fetchCampaigns(program: TandaJadiProgram): Promise<Campaign[]> {
  const all = await program.account.campaign.all();
  return all.map(({ publicKey, account }) => toCampaign(publicKey, account));
}

export async function fetchPledge(
  program: TandaJadiProgram,
  campaign: PublicKey,
  backer: PublicKey,
): Promise<Pledge | null> {
  const address = pledgeAddress(campaign, backer);
  const raw = await program.account.pledge.fetchNullable(address);
  return raw && toPledge(address, raw);
}

/** Every pledge of a campaign that has not been refunded yet, in queue order. */
export async function fetchPledges(
  program: TandaJadiProgram,
  campaign: PublicKey,
): Promise<Pledge[]> {
  const all = await program.account.pledge.all([
    { memcmp: { offset: 8, bytes: campaign.toBase58() } },
  ]);
  return all
    .map(({ publicKey, account }) => toPledge(publicKey, account))
    .sort((a, b) => a.index - b.index);
}

// ---------------------------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------------------------

const bps = (amount: bigint, share: number) => (amount * BigInt(share)) / BPS_DENOMINATOR;
const min = (a: bigint, b: bigint) => (a < b ? a : b);

/** What the creator locked at creation: the most the failure bonus can cost them. */
export const bond = (c: Campaign) => c.bonusPerEarly * BigInt(c.earlySlots);
export const target = (c: Campaign) => c.price * BigInt(c.targetBackers);
export const raised = (c: Campaign) => c.price * BigInt(c.backers);
export const fee = (c: Campaign) => bps(raised(c), c.feeBps);
export const upfront = (c: Campaign) => bps(raised(c), c.upfrontBps);
export const streamTotal = (c: Campaign) => raised(c) - fee(c) - upfront(c);
export const buildEnd = (c: Campaign) => c.fundedAt + c.buildSecs;
export const bonusSeatsLeft = (c: Campaign) => Math.max(0, c.earlySlots - c.backers);
/** How many backers have to hold the brake to stop the stream. */
export const brakesNeeded = (c: Campaign) => Math.floor(c.backers / 2) + 1;

/** The stored status with the clock applied, the way the program does before every instruction. */
export function statusAt(c: Campaign, now: number): Status {
  if (c.status === "funding" && now >= c.deadline) return "failed";
  if (c.status === "building" && now >= buildEnd(c)) return "completed";
  return c.status;
}

export function vestedAt(c: Campaign, time: number): bigint {
  const elapsed = Math.min(Math.max(time - c.fundedAt, 0), c.buildSecs);
  return (streamTotal(c) * BigInt(elapsed)) / BigInt(c.buildSecs);
}

/** Everything the creator may have taken out by `now`, including what they already withdrew. */
export function creatorEntitled(c: Campaign, now: number): bigint {
  switch (statusAt(c, now)) {
    case "funding":
      return 0n;
    case "failed":
      return bond(c) - c.bonusPerEarly * BigInt(Math.min(c.backers, c.earlySlots));
    case "building":
      return upfront(c) + vestedAt(c, now);
    case "completed":
      return upfront(c) + streamTotal(c) + bond(c);
    case "braked":
      return upfront(c) + streamTotal(c) + bond(c) - c.refundPerBacker * BigInt(c.backers);
  }
}

export const creatorClaimable = (c: Campaign, now: number) =>
  creatorEntitled(c, now) - c.creatorWithdrawn;

/** What the backer at `index` gets back right now, or `null` while no refund is due. */
export function refundFor(c: Campaign, index: number, now: number): bigint | null {
  switch (statusAt(c, now)) {
    case "failed":
      return c.price + (index < c.earlySlots ? c.bonusPerEarly : 0n);
    case "braked":
      return c.refundPerBacker;
    default:
      return null;
  }
}

/** What a backer would get back if the campaign failed, given their position in the queue. */
export const refundIfFailed = (c: Campaign, index: number) =>
  c.price + (index < c.earlySlots ? c.bonusPerEarly : 0n);

/** What each backer would get back if the brake reached a majority at `now`. */
export function refundIfBrakedAt(c: Campaign, now: number): bigint {
  if (c.backers === 0) return 0n;
  const pool = streamTotal(c) - vestedAt(c, now) + bond(c);
  return min(pool / BigInt(c.backers), c.price);
}

// ---------------------------------------------------------------------------------------------
// Instructions
// ---------------------------------------------------------------------------------------------

export interface CampaignTerms {
  /** Only has to be unique among the creator's own campaigns. */
  id: bigint;
  title: string;
  uri: string;
  price: bigint;
  targetBackers: number;
  earlySlots: number;
  bonusPerEarly: bigint;
  fundingSecs: number;
  buildSecs: number;
  upfrontBps: number;
}

const bn = (value: bigint | number) => new BN(value.toString());

export function initializeConfigIx(
  program: TandaJadiProgram,
  admin: PublicKey,
  treasury: PublicKey,
  feeBps: number,
): Promise<TransactionInstruction> {
  return program.methods.initializeConfig(treasury, feeBps).accounts({ admin }).instruction();
}

/** Opens a campaign and moves the creator's bond into its vault. */
export function createCampaignIx(
  program: TandaJadiProgram,
  creator: PublicKey,
  mint: PublicKey,
  terms: CampaignTerms,
): Promise<TransactionInstruction> {
  return program.methods
    .createCampaign({
      id: bn(terms.id),
      price: bn(terms.price),
      targetBackers: terms.targetBackers,
      earlySlots: terms.earlySlots,
      bonusPerEarly: bn(terms.bonusPerEarly),
      fundingSecs: bn(terms.fundingSecs),
      buildSecs: bn(terms.buildSecs),
      upfrontBps: terms.upfrontBps,
      title: terms.title,
      uri: terms.uri,
    })
    .accountsPartial({
      creator,
      mint,
      campaign: campaignAddress(creator, terms.id),
      creatorToken: tokenAccount(mint, creator),
    })
    .instruction();
}

export function pledgeIx(
  program: TandaJadiProgram,
  campaign: Pick<Campaign, "address" | "mint">,
  backer: PublicKey,
): Promise<TransactionInstruction> {
  return program.methods
    .pledge()
    .accountsPartial({
      backer,
      campaign: campaign.address,
      mint: campaign.mint,
      backerToken: tokenAccount(campaign.mint, backer),
    })
    .instruction();
}

/**
 * Returns a pledge to its backer. Anyone can pay for this transaction; the money only ever goes
 * to the backer. The first instruction recreates the backer's token account if they closed it.
 */
export async function claimRefundIxs(
  program: TandaJadiProgram,
  campaign: Pick<Campaign, "address" | "mint">,
  backer: PublicKey,
  payer: PublicKey,
): Promise<TransactionInstruction[]> {
  const backerToken = tokenAccount(campaign.mint, backer);
  return [
    createAssociatedTokenAccountIdempotentInstruction(payer, backerToken, backer, campaign.mint),
    await program.methods
      .claimRefund()
      .accountsPartial({
        campaign: campaign.address,
        backer,
        mint: campaign.mint,
        backerToken,
      })
      .instruction(),
  ];
}

/** Pays the creator what is theirs by now. Anyone can pay for this transaction. */
export async function withdrawIxs(
  program: TandaJadiProgram,
  campaign: Pick<Campaign, "address" | "mint" | "creator">,
  payer: PublicKey,
): Promise<TransactionInstruction[]> {
  const creatorToken = tokenAccount(campaign.mint, campaign.creator);
  return [
    createAssociatedTokenAccountIdempotentInstruction(
      payer,
      creatorToken,
      campaign.creator,
      campaign.mint,
    ),
    await program.methods
      .withdraw()
      .accountsPartial({ campaign: campaign.address, mint: campaign.mint, creatorToken })
      .instruction(),
  ];
}

export async function collectFeeIxs(
  program: TandaJadiProgram,
  campaign: Pick<Campaign, "address" | "mint">,
  treasury: PublicKey,
  payer: PublicKey,
): Promise<TransactionInstruction[]> {
  const treasuryToken = tokenAccount(campaign.mint, treasury);
  return [
    createAssociatedTokenAccountIdempotentInstruction(
      payer,
      treasuryToken,
      treasury,
      campaign.mint,
    ),
    await program.methods
      .collectFee()
      .accountsPartial({ campaign: campaign.address, mint: campaign.mint, treasuryToken })
      .instruction(),
  ];
}

export function setBrakeIx(
  program: TandaJadiProgram,
  campaign: PublicKey,
  backer: PublicKey,
  on: boolean,
): Promise<TransactionInstruction> {
  return program.methods.setBrake(on).accountsPartial({ backer, campaign }).instruction();
}

// ---------------------------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------------------------

/** `12500000n` → `"12.50"`. Trailing zeros beyond two decimals are dropped. */
export function formatTokens(amount: bigint, decimals = 6): string {
  const negative = amount < 0n;
  const digits = (negative ? -amount : amount).toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, -decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = digits.slice(-decimals).replace(/0+$/, "").padEnd(2, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/** `"12.5"` → `12500000n`. Returns `null` for anything that is not a plain positive amount. */
export function parseTokens(text: string, decimals = 6): bigint | null {
  const match = /^(\d+)(?:\.(\d*))?$/.exec(text.trim());
  if (!match) return null;
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) return null;
  return BigInt(match[1]) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0"));
}
