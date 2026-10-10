use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::TandaJadiError,
    state::{Campaign, Journal},
};

/// Adds a line to the campaign's journal. Only the creator can, at any point in the campaign's
/// life: while it fills, while they build, and afterwards to say where the result is.
#[derive(Accounts)]
pub struct PostUpdate<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(has_one = creator @ TandaJadiError::Unauthorized)]
    pub campaign: Box<Account<'info, Campaign>>,
    /// The first update creates it.
    #[account(
        init_if_needed,
        payer = creator,
        space = 8 + Journal::INIT_SPACE,
        seeds = [JOURNAL_SEED, campaign.key().as_ref()],
        bump
    )]
    pub journal: Box<Account<'info, Journal>>,
    pub system_program: Program<'info, System>,
}

pub fn handle_post_update(ctx: Context<PostUpdate>, text: String) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    // The counter only ever grows here, so a journal that already exists is never reset.
    let journal = &mut ctx.accounts.journal;
    journal.campaign = ctx.accounts.campaign.key();
    journal.bump = ctx.bumps.journal;
    journal.record(now, text)
}
