use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, TransferChecked},
};

use crate::{
    constants::*,
    error::TandaJadiError,
    state::{Campaign, Config, Status},
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CreateCampaignArgs {
    /// Chosen by the creator; only has to be unique among their own campaigns.
    pub id: u64,
    pub price: u64,
    pub target_backers: u32,
    pub early_slots: u32,
    pub bonus_per_early: u64,
    pub funding_secs: i64,
    pub build_secs: i64,
    pub upfront_bps: u16,
    pub title: String,
    pub uri: String,
}

#[derive(Accounts)]
#[instruction(args: CreateCampaignArgs)]
pub struct CreateCampaign<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    pub mint: Account<'info, Mint>,
    #[account(
        init,
        payer = creator,
        space = 8 + Campaign::INIT_SPACE,
        seeds = [CAMPAIGN_SEED, creator.key().as_ref(), &args.id.to_le_bytes()],
        bump
    )]
    pub campaign: Box<Account<'info, Campaign>>,
    #[account(
        init,
        payer = creator,
        associated_token::mint = mint,
        associated_token::authority = campaign
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = mint, token::authority = creator)]
    pub creator_token: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_create_campaign(
    ctx: Context<CreateCampaign>,
    args: CreateCampaignArgs,
) -> Result<()> {
    require!(args.price > 0, TandaJadiError::InvalidPrice);
    require!(args.target_backers > 0, TandaJadiError::InvalidTarget);
    require!(
        args.early_slots > 0 && args.early_slots <= args.target_backers,
        TandaJadiError::InvalidEarlySlots
    );
    require!(args.bonus_per_early > 0, TandaJadiError::InvalidBonus);
    require!(
        args.funding_secs > 0 && args.funding_secs <= MAX_FUNDING_SECS,
        TandaJadiError::InvalidDuration
    );
    require!(
        args.build_secs > 0 && args.build_secs <= MAX_BUILD_SECS,
        TandaJadiError::InvalidDuration
    );
    require!(
        args.upfront_bps <= MAX_UPFRONT_BPS,
        TandaJadiError::UpfrontTooHigh
    );
    require!(
        args.title.len() <= MAX_TITLE_LEN && args.uri.len() <= MAX_URI_LEN,
        TandaJadiError::TextTooLong
    );
    // The full raise has to fit in 64 bits, so no later sum of pledges can overflow.
    args.price
        .checked_mul(args.target_backers as u64)
        .ok_or(TandaJadiError::MathOverflow)?;

    let now = Clock::get()?.unix_timestamp;
    let campaign = &mut ctx.accounts.campaign;
    campaign.set_inner(Campaign {
        creator: ctx.accounts.creator.key(),
        mint: ctx.accounts.mint.key(),
        id: args.id,
        price: args.price,
        target_backers: args.target_backers,
        early_slots: args.early_slots,
        bonus_per_early: args.bonus_per_early,
        deadline: now + args.funding_secs,
        build_secs: args.build_secs,
        upfront_bps: args.upfront_bps,
        fee_bps: ctx.accounts.config.fee_bps,
        status: Status::Funding,
        backers: 0,
        brakes: 0,
        funded_at: 0,
        braked_at: 0,
        refund_per_backer: 0,
        creator_withdrawn: 0,
        fee_collected: false,
        bump: ctx.bumps.campaign,
        title: args.title,
        uri: args.uri,
    });

    // The creator locks the whole bond before anyone can pledge.
    let accounts = TransferChecked {
        from: ctx.accounts.creator_token.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.vault.to_account_info(),
        authority: ctx.accounts.creator.to_account_info(),
    };
    token::transfer_checked(
        CpiContext::new(Token::id(), accounts),
        campaign.bond()?,
        ctx.accounts.mint.decimals,
    )
}
