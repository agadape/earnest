//! Tanda Jadi: pre-orders that pay the buyer back with a bonus when too few people join.
//!
//! A creator opens a campaign ("I build this if N people put down P each before the deadline")
//! and locks a bond. Backers pledge into a vault that only this program can move.
//!
//! - Target missed: every pledge goes back, and the earliest backers also receive a bonus paid
//!   from the creator's bond.
//! - Target reached: a share goes to the creator at once, the rest is released linearly over the
//!   build period, and a majority of backers can brake that stream and take back what is left.
//!
//! While the outcome is open a backer can sell their seat to someone else. The seat keeps its
//! place in the queue, so what a bonus seat sells for says how likely its holders think a
//! failure is.

pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;
pub mod vault;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("EsMmNdHM99LX3c3yhec5AgdteXBPyCz5kN8St3ySddzv");

#[program]
pub mod tanda_jadi {
    use super::*;

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        treasury: Pubkey,
        fee_bps: u16,
    ) -> Result<()> {
        crate::instructions::initialize_config::handle_initialize_config(ctx, treasury, fee_bps)
    }

    pub fn update_config(ctx: Context<UpdateConfig>, treasury: Pubkey, fee_bps: u16) -> Result<()> {
        crate::instructions::update_config::handle_update_config(ctx, treasury, fee_bps)
    }

    pub fn create_campaign(ctx: Context<CreateCampaign>, args: CreateCampaignArgs) -> Result<()> {
        crate::instructions::create_campaign::handle_create_campaign(ctx, args)
    }

    pub fn pledge(ctx: Context<MakePledge>) -> Result<()> {
        crate::instructions::pledge::handle_pledge(ctx)
    }

    pub fn claim_refund(ctx: Context<ClaimRefund>) -> Result<()> {
        crate::instructions::claim_refund::handle_claim_refund(ctx)
    }

    pub fn withdraw(ctx: Context<Withdraw>) -> Result<()> {
        crate::instructions::withdraw::handle_withdraw(ctx)
    }

    pub fn collect_fee(ctx: Context<CollectFee>) -> Result<()> {
        crate::instructions::collect_fee::handle_collect_fee(ctx)
    }

    pub fn set_brake(ctx: Context<SetBrake>, on: bool) -> Result<()> {
        crate::instructions::set_brake::handle_set_brake(ctx, on)
    }

    pub fn list_seat(ctx: Context<ListSeat>, ask: u64) -> Result<()> {
        crate::instructions::list_seat::handle_list_seat(ctx, ask)
    }

    pub fn unlist_seat(ctx: Context<UnlistSeat>) -> Result<()> {
        crate::instructions::unlist_seat::handle_unlist_seat(ctx)
    }

    pub fn buy_seat(ctx: Context<BuySeat>, max_price: u64) -> Result<()> {
        crate::instructions::buy_seat::handle_buy_seat(ctx, max_price)
    }
}
