use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::{constants::CAMPAIGN_SEED, state::Campaign};

/// Moves tokens out of a campaign's vault. The campaign account is the vault's owner, so this is
/// the only way anything leaves it, and every caller decides the amount from `Campaign` alone.
pub fn pay_from_vault<'info>(
    campaign: &Account<'info, Campaign>,
    mint: &Account<'info, Mint>,
    vault: &Account<'info, TokenAccount>,
    to: &Account<'info, TokenAccount>,
    amount: u64,
) -> Result<()> {
    let id = campaign.id.to_le_bytes();
    let seeds: &[&[u8]] = &[
        CAMPAIGN_SEED,
        campaign.creator.as_ref(),
        &id,
        &[campaign.bump],
    ];
    let accounts = TransferChecked {
        from: vault.to_account_info(),
        mint: mint.to_account_info(),
        to: to.to_account_info(),
        authority: campaign.to_account_info(),
    };
    token::transfer_checked(
        CpiContext::new(Token::id(), accounts).with_signer(&[seeds]),
        amount,
        mint.decimals,
    )
}
