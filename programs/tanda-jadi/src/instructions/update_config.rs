use anchor_lang::prelude::*;

use crate::{constants::*, error::TandaJadiError, state::Config};

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    pub admin: Signer<'info>,
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ TandaJadiError::Unauthorized
    )]
    pub config: Account<'info, Config>,
}

/// Changes apply to campaigns created afterwards. A running campaign keeps the fee it started
/// with; only the wallet that receives it follows the config.
pub fn handle_update_config(
    ctx: Context<UpdateConfig>,
    treasury: Pubkey,
    fee_bps: u16,
) -> Result<()> {
    require!(fee_bps <= MAX_FEE_BPS, TandaJadiError::FeeTooHigh);

    let config = &mut ctx.accounts.config;
    config.treasury = treasury;
    config.fee_bps = fee_bps;
    Ok(())
}
