use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::TandaJadiError,
    state::{Campaign, Listing, Pledge},
};

#[derive(Accounts)]
pub struct ListSeat<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,
    #[account(mut)]
    pub campaign: Box<Account<'info, Campaign>>,
    /// Proof that the seller holds a seat. It is not changed: the seat stays theirs until sold.
    #[account(
        seeds = [PLEDGE_SEED, campaign.key().as_ref(), seller.key().as_ref()],
        bump = pledge.bump
    )]
    pub pledge: Account<'info, Pledge>,
    #[account(
        init,
        payer = seller,
        space = 8 + Listing::INIT_SPACE,
        seeds = [LISTING_SEED, campaign.key().as_ref(), seller.key().as_ref()],
        bump
    )]
    pub listing: Account<'info, Listing>,
    pub system_program: Program<'info, System>,
}

/// Offers the seller's seat at a fixed price. To change the price, take the offer down and make
/// a new one.
pub fn handle_list_seat(ctx: Context<ListSeat>, ask: u64) -> Result<()> {
    require!(ask > 0, TandaJadiError::InvalidAsk);
    let now = Clock::get()?.unix_timestamp;
    ctx.accounts.campaign.ensure_tradable(now)?;

    ctx.accounts.listing.set_inner(Listing {
        campaign: ctx.accounts.campaign.key(),
        seller: ctx.accounts.seller.key(),
        ask,
        bump: ctx.bumps.listing,
    });
    Ok(())
}
