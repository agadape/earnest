use anchor_lang::prelude::*;

use crate::{
    constants::*,
    state::{Campaign, Pledge},
};

#[derive(Accounts)]
pub struct SetBrake<'info> {
    pub backer: Signer<'info>,
    #[account(mut)]
    pub campaign: Box<Account<'info, Campaign>>,
    #[account(
        mut,
        has_one = backer,
        seeds = [PLEDGE_SEED, campaign.key().as_ref(), backer.key().as_ref()],
        bump = pledge.bump
    )]
    pub pledge: Account<'info, Pledge>,
}

/// A backer pulls or releases their brake. It only counts during the build period, and once a
/// majority holds it the campaign is stopped for good.
pub fn handle_set_brake(ctx: Context<SetBrake>, on: bool) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let pledge = &mut ctx.accounts.pledge;

    ctx.accounts.campaign.move_brake(now, pledge.braked, on)?;
    pledge.braked = on;
    Ok(())
}
