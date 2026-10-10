/**
 * Client for the program behind Earnest (it kept its first name, Tanda Jadi), shared by the
 * web app and the scripts.
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
export const MAX_UPDATE_LENGTH = 200;

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

export function marketAddress(campaign: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market"), campaign.toBuffer()],
    PROGRAM_ID,
  )[0];
}

export function journalAddress(campaign: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("journal"), campaign.toBuffer()],
    PROGRAM_ID,
  )[0];
}

export function listingAddress(campaign: PublicKey, seller: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("listing"), campaign.toBuffer(), seller.toBuffer()],
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

/** A seat its holder offers for sale. The seat stays theirs until someone pays the price. */
export interface Listing {
  address: PublicKey;
  campaign: PublicKey;
  seller: PublicKey;
  ask: bigint;
}

/** One seat changing hands: what was actually paid, as opposed to what a holder asks. */
export interface Sale {
  at: number;
  price: bigint;
  /** Position in the queue of the seat that was sold, starting at zero. */
  seat: number;
}

/** Every sale of a campaign's seats, counted, with the latest sixteen kept oldest first. */
export interface Market {
  sales: number;
  volume: bigint;
  recent: Sale[];
}

/** One thing the creator told their backers. */
export interface Update {
  at: number;
  text: string;
}

/** What the creator has posted about a campaign: a count, and the latest five, oldest first. */
export interface Journal {
  posted: number;
  recent: Update[];
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

/** Every campaign, or only those opened by `creator`. */
export async function fetchCampaigns(
  program: TandaJadiProgram,
  creator?: PublicKey,
): Promise<Campaign[]> {
  const all = await program.account.campaign.all(
    creator ? [{ memcmp: { offset: 8, bytes: creator.toBase58() } }] : undefined,
  );
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

/** What this campaign's seats have sold for, or `null` if none has been sold yet. */
export async function fetchMarket(
  program: TandaJadiProgram,
  campaign: PublicKey,
): Promise<Market | null> {
  const raw = await program.account.market.fetchNullable(marketAddress(campaign));
  return (
    raw && {
      sales: raw.sales,
      volume: big(raw.volume),
      recent: raw.recent.map((sale) => ({
        at: sale.at.toNumber(),
        price: big(sale.price),
        seat: sale.seat,
      })),
    }
  );
}

/** What the creator has posted about this campaign, or `null` if they never posted. */
export async function fetchJournal(
  program: TandaJadiProgram,
  campaign: PublicKey,
): Promise<Journal | null> {
  const raw = await program.account.journal.fetchNullable(journalAddress(campaign));
  return (
    raw && {
      posted: raw.posted,
      recent: raw.recent.map((update) => ({ at: update.at.toNumber(), text: update.text })),
    }
  );
}

/** The offer `seller` has standing for their seat, or `null`. Buying a seat removes its offer. */
export async function fetchListing(
  program: TandaJadiProgram,
  campaign: PublicKey,
  seller: PublicKey,
): Promise<Listing | null> {
  const address = listingAddress(campaign, seller);
  const raw = await program.account.listing.fetchNullable(address);
  return raw && { address, campaign: raw.campaign, seller: raw.seller, ask: big(raw.ask) };
}

/**
 * Every offer made for a seat of this campaign, cheapest first. An offer can outlive its seat
 * (the seat was refunded, the offer never taken down), so match these against `fetchPledges`
 * before showing them as buyable.
 */
export async function fetchListings(
  program: TandaJadiProgram,
  campaign: PublicKey,
): Promise<Listing[]> {
  const all = await program.account.listing.all([
    { memcmp: { offset: 8, bytes: campaign.toBase58() } },
  ]);
  return all
    .map(({ publicKey, account }) => ({
      address: publicKey,
      campaign: account.campaign,
      seller: account.seller,
      ask: big(account.ask),
    }))
    .sort((a, b) => (a.ask < b.ask ? -1 : a.ask > b.ask ? 1 : 0));
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

/** Seats change hands only while the outcome is open: before the deadline or during the build. */
export function seatsTradable(c: Campaign, now: number): boolean {
  const status = statusAt(c, now);
  return status === "funding" || status === "building";
}

/**
 * What an asking price for a bonus seat says about the campaign's chances, as a share between 0
 * and 1, or `null` when it says nothing.
 *
 * A bonus seat pays `price + bonus` if the campaign fails and is worth `price` to someone who
 * wants the product. Letting it go for `price + x` only makes sense to a holder who thinks a
 * failure is about `x / bonus` likely, or less; paying that much only to a buyer who thinks it
 * is at least that likely. An offer is one holder's view. A sale is where two people met.
 */
export function impliedFailureChance(c: Campaign, bonusSeatAsk: bigint): number | null {
  if (c.bonusPerEarly === 0n) return null;
  const premium = bonusSeatAsk - c.price;
  if (premium < 0n || premium > c.bonusPerEarly) return null;
  return Number(premium) / Number(c.bonusPerEarly);
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

/** Adds a line to the campaign's journal. Only its creator can sign this. */
export function postUpdateIx(
  program: TandaJadiProgram,
  campaign: PublicKey,
  creator: PublicKey,
  text: string,
): Promise<TransactionInstruction> {
  return program.methods
    .postUpdate(text)
    .accountsPartial({ creator, campaign, journal: journalAddress(campaign) })
    .instruction();
}

/** Offers the seller's seat at a fixed price. To change the price, unlist and list again. */
export function listSeatIx(
  program: TandaJadiProgram,
  campaign: PublicKey,
  seller: PublicKey,
  ask: bigint,
): Promise<TransactionInstruction> {
  return program.methods.listSeat(bn(ask)).accountsPartial({ seller, campaign }).instruction();
}

/** Takes the seller's offer down. Allowed at any time, also after the campaign ended. */
export function unlistSeatIx(
  program: TandaJadiProgram,
  campaign: PublicKey,
  seller: PublicKey,
): Promise<TransactionInstruction> {
  return program.methods
    .unlistSeat()
    .accountsPartial({ seller, listing: listingAddress(campaign, seller) })
    .instruction();
}

/**
 * Buys the seat on offer for exactly the price the buyer saw: if the seller swapped in a dearer
 * offer in the meantime, the purchase fails instead of costing more. The first instruction
 * recreates the seller's token account if they closed it, so they can always be paid.
 */
export async function buySeatIxs(
  program: TandaJadiProgram,
  campaign: Pick<Campaign, "address" | "mint">,
  listing: Pick<Listing, "seller" | "ask">,
  buyer: PublicKey,
): Promise<TransactionInstruction[]> {
  const sellerToken = tokenAccount(campaign.mint, listing.seller);
  return [
    createAssociatedTokenAccountIdempotentInstruction(
      buyer,
      sellerToken,
      listing.seller,
      campaign.mint,
    ),
    await program.methods
      .buySeat(bn(listing.ask))
      .accountsPartial({
        buyer,
        campaign: campaign.address,
        mint: campaign.mint,
        seller: listing.seller,
        market: marketAddress(campaign.address),
        buyerToken: tokenAccount(campaign.mint, buyer),
        sellerToken,
      })
      .instruction(),
  ];
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
