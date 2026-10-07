use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::{error::TandaJadiError, state::Campaign, vault::pay_from_vault};

/// Pays the creator whatever the campaign's state says is theirs by now: the upfront share and
/// the released part of the stream while building, the bond at the end, or the unused bond after
/// a failure. Anyone may send it; the money can only go to the creator.
#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut, has_one = mint)]
    pub campaign: Box<Account<'info, Campaign>>,
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = campaign
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = mint, token::authority = campaign.creator)]
    pub creator_token: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_withdraw(ctx: Context<Withdraw>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let campaign = &mut ctx.accounts.campaign;
    campaign.sync(now);

    let amount = campaign
        .creator_entitled(now)?
        .checked_sub(campaign.creator_withdrawn)
        .ok_or(TandaJadiError::MathOverflow)?;
    require!(amount > 0, TandaJadiError::NothingToWithdraw);
    campaign.creator_withdrawn += amount;

    pay_from_vault(
        campaign,
        &ctx.accounts.mint,
        &ctx.accounts.vault,
        &ctx.accounts.creator_token,
        amount,
    )
}
