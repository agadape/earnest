use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::{
    constants::*,
    error::TandaJadiError,
    state::{Campaign, Listing, Market, Pledge, Sale},
};

/// Buys a seat from its holder at the price they asked. The payment goes straight from the buyer
/// to the seller; the vault is not involved and the campaign keeps the same number of backers.
#[derive(Accounts)]
pub struct BuySeat<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(mut, has_one = mint)]
    pub campaign: Box<Account<'info, Campaign>>,
    pub mint: Box<Account<'info, Mint>>,
    /// CHECK: receives the rent of the two accounts closed below; tied to both by their seeds.
    #[account(mut)]
    pub seller: UncheckedAccount<'info>,
    #[account(
        mut,
        close = seller,
        seeds = [LISTING_SEED, campaign.key().as_ref(), seller.key().as_ref()],
        bump = listing.bump
    )]
    pub listing: Box<Account<'info, Listing>>,
    #[account(
        mut,
        close = seller,
        seeds = [PLEDGE_SEED, campaign.key().as_ref(), seller.key().as_ref()],
        bump = seller_pledge.bump
    )]
    pub seller_pledge: Box<Account<'info, Pledge>>,
    /// One seat per wallet still holds: a buyer who already has a seat cannot take a second.
    #[account(
        init,
        payer = buyer,
        space = 8 + Pledge::INIT_SPACE,
        seeds = [PLEDGE_SEED, campaign.key().as_ref(), buyer.key().as_ref()],
        bump
    )]
    pub buyer_pledge: Box<Account<'info, Pledge>>,
    /// What seats of this campaign have sold for. The first sale creates it.
    #[account(
        init_if_needed,
        payer = buyer,
        space = 8 + Market::INIT_SPACE,
        seeds = [MARKET_SEED, campaign.key().as_ref()],
        bump
    )]
    pub market: Box<Account<'info, Market>>,
    #[account(mut, token::mint = mint, token::authority = buyer)]
    pub buyer_token: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = mint, token::authority = seller)]
    pub seller_token: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

/// `max_price` is the most the buyer agreed to pay. A seller cannot swap in a dearer offer
/// between the moment the buyer looked and the moment this lands.
pub fn handle_buy_seat(ctx: Context<BuySeat>, max_price: u64) -> Result<()> {
    let ask = ctx.accounts.listing.ask;
    require!(ask <= max_price, TandaJadiError::AskTooHigh);

    let now = Clock::get()?.unix_timestamp;
    let seat = &ctx.accounts.seller_pledge;
    ctx.accounts.campaign.transfer_seat(now, seat.braked)?;

    // Same place in the queue, so a bonus seat stays a bonus seat.
    ctx.accounts.buyer_pledge.set_inner(Pledge {
        campaign: ctx.accounts.campaign.key(),
        backer: ctx.accounts.buyer.key(),
        index: seat.index,
        braked: false,
        bump: ctx.bumps.buyer_pledge,
    });

    // Counters only ever grow here, so a market that already exists is never reset.
    let market = &mut ctx.accounts.market;
    market.campaign = ctx.accounts.campaign.key();
    market.bump = ctx.bumps.market;
    market.record(Sale {
        at: now,
        price: ask,
        seat: seat.index,
    })?;

    let accounts = TransferChecked {
        from: ctx.accounts.buyer_token.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.seller_token.to_account_info(),
        authority: ctx.accounts.buyer.to_account_info(),
    };
    token::transfer_checked(
        CpiContext::new(Token::id(), accounts),
        ask,
        ctx.accounts.mint.decimals,
    )
}
