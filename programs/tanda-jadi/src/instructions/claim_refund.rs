use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::{
    constants::*,
    state::{Campaign, Pledge},
    vault::pay_from_vault,
};

/// Anyone may send this. The money can only go to the backer who made the pledge, so a bot or
/// the web app can return every pledge the moment a campaign fails, without the backer clicking.
#[derive(Accounts)]
pub struct ClaimRefund<'info> {
    #[account(mut, has_one = mint)]
    pub campaign: Box<Account<'info, Campaign>>,
    #[account(
        mut,
        close = backer,
        has_one = backer,
        seeds = [PLEDGE_SEED, campaign.key().as_ref(), backer.key().as_ref()],
        bump = pledge.bump
    )]
    pub pledge: Account<'info, Pledge>,
    /// CHECK: receives the pledge account's rent; tied to the pledge by `has_one` and its seeds.
    #[account(mut)]
    pub backer: UncheckedAccount<'info>,
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = campaign
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = mint, token::authority = backer)]
    pub backer_token: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_claim_refund(ctx: Context<ClaimRefund>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let campaign = &mut ctx.accounts.campaign;
    campaign.sync(now);
    let amount = campaign.refund_for(ctx.accounts.pledge.index)?;

    // Closing the pledge account (see `close` above) is what makes a second claim impossible.
    pay_from_vault(
        campaign,
        &ctx.accounts.mint,
        &ctx.accounts.vault,
        &ctx.accounts.backer_token,
        amount,
    )
}
