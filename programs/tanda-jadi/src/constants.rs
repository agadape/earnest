use anchor_lang::prelude::*;

#[constant]
pub const CONFIG_SEED: &[u8] = b"config";

#[constant]
pub const CAMPAIGN_SEED: &[u8] = b"campaign";

#[constant]
pub const PLEDGE_SEED: &[u8] = b"pledge";

#[constant]
pub const LISTING_SEED: &[u8] = b"listing";

pub const BPS_DENOMINATOR: u64 = 10_000;

/// Ceiling for the service fee, taken only from campaigns that reach their target.
pub const MAX_FEE_BPS: u16 = 1_000;

/// Ceiling for the share of the raise a creator may receive the moment the target is reached.
/// Everything above it has to be streamed, so backers can still brake it.
pub const MAX_UPFRONT_BPS: u16 = 3_000;

pub const MAX_FUNDING_SECS: i64 = 90 * 86_400;
pub const MAX_BUILD_SECS: i64 = 365 * 86_400;

pub const MAX_TITLE_LEN: usize = 64;
pub const MAX_URI_LEN: usize = 200;
