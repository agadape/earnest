use anchor_lang::prelude::*;

use crate::{constants::*, state::Listing};

/// Takes an offer down. Allowed at any time, also after the campaign ended, so an offer nobody
/// took never keeps the seller's rent.
#[derive(Accounts)]
pub struct UnlistSeat<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,
    #[account(
        mut,
        close = seller,
        has_one = seller,
        seeds = [LISTING_SEED, listing.campaign.as_ref(), seller.key().as_ref()],
        bump = listing.bump
    )]
    pub listing: Account<'info, Listing>,
}

pub fn handle_unlist_seat(_ctx: Context<UnlistSeat>) -> Result<()> {
    Ok(())
}
