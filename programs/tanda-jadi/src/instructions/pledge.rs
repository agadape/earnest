use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::{
    constants::*,
    state::{Campaign, Pledge},
};

#[derive(Accounts)]
pub struct MakePledge<'info> {
    #[account(mut)]
    pub backer: Signer<'info>,
    #[account(mut, has_one = mint)]
    pub campaign: Box<Account<'info, Campaign>>,
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = campaign
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = mint, token::authority = backer)]
    pub backer_token: Box<Account<'info, TokenAccount>>,
    /// One pledge per wallet per campaign. After a successful campaign this account stays
    /// behind as the backer's receipt.
    #[account(
        init,
        payer = backer,
        space = 8 + Pledge::INIT_SPACE,
        seeds = [PLEDGE_SEED, campaign.key().as_ref(), backer.key().as_ref()],
        bump
    )]
    pub pledge: Account<'info, Pledge>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_pledge(ctx: Context<MakePledge>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let index = ctx.accounts.campaign.add_backer(now)?;

    ctx.accounts.pledge.set_inner(Pledge {
        campaign: ctx.accounts.campaign.key(),
        backer: ctx.accounts.backer.key(),
        index,
        braked: false,
        bump: ctx.bumps.pledge,
    });

    let accounts = TransferChecked {
        from: ctx.accounts.backer_token.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.vault.to_account_info(),
        authority: ctx.accounts.backer.to_account_info(),
    };
    token::transfer_checked(
        CpiContext::new(Token::id(), accounts),
        ctx.accounts.campaign.price,
        ctx.accounts.mint.decimals,
    )
}
