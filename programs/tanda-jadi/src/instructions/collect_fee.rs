use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::{
    constants::*,
    state::{Campaign, Config},
    vault::pay_from_vault,
};

/// Sends the fee of a campaign that reached its target to the treasury. A campaign that failed
/// never owes one.
#[derive(Accounts)]
pub struct CollectFee<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, has_one = mint)]
    pub campaign: Box<Account<'info, Campaign>>,
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = campaign
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = mint, token::authority = config.treasury)]
    pub treasury_token: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_collect_fee(ctx: Context<CollectFee>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let campaign = &mut ctx.accounts.campaign;
    campaign.sync(now);

    let amount = campaign.fee_due()?;
    campaign.fee_collected = true;

    pay_from_vault(
        campaign,
        &ctx.accounts.mint,
        &ctx.accounts.vault,
        &ctx.accounts.treasury_token,
        amount,
    )
}
