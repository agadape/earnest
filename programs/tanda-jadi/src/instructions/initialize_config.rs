use anchor_lang::prelude::*;

use crate::{constants::*, error::TandaJadiError, state::Config};

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        init,
        payer = admin,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, Config>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize_config(
    ctx: Context<InitializeConfig>,
    treasury: Pubkey,
    fee_bps: u16,
) -> Result<()> {
    require!(fee_bps <= MAX_FEE_BPS, TandaJadiError::FeeTooHigh);

    ctx.accounts.config.set_inner(Config {
        admin: ctx.accounts.admin.key(),
        treasury,
        fee_bps,
        bump: ctx.bumps.config,
    });
    Ok(())
}
