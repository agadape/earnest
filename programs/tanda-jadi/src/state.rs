use anchor_lang::prelude::*;

use crate::{constants::BPS_DENOMINATOR, error::TandaJadiError};

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    /// Wallet whose token account receives the fee.
    pub treasury: Pubkey,
    pub fee_bps: u16,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Clone, Copy, PartialEq, Eq, Debug)]
pub enum Status {
    /// Collecting pledges. Nothing can leave the vault.
    Funding,
    /// Target reached. The raise streams to the creator and backers can brake.
    Building,
    /// Deadline passed below target. Pledges go back and early backers get the bonus.
    Failed,
    /// A majority of backers braked during the build. What is left goes back to them.
    Braked,
    /// Build period ended without a brake. Everything left belongs to the creator.
    Completed,
}

#[account]
#[derive(InitSpace)]
pub struct Campaign {
    pub creator: Pubkey,
    pub mint: Pubkey,
    pub id: u64,

    // Terms. Fixed at creation; no instruction changes them afterwards.
    pub price: u64,
    pub target_backers: u32,
    /// The first `early_slots` backers are paid `bonus_per_early` each if the campaign fails.
    pub early_slots: u32,
    pub bonus_per_early: u64,
    pub deadline: i64,
    pub build_secs: i64,
    pub upfront_bps: u16,
    /// Copied from `Config` at creation so a later fee change cannot touch this campaign.
    pub fee_bps: u16,

    // Progress.
    pub status: Status,
    pub backers: u32,
    pub brakes: u32,
    pub funded_at: i64,
    pub braked_at: i64,
    pub refund_per_backer: u64,
    pub creator_withdrawn: u64,
    pub fee_collected: bool,

    pub bump: u8,
    #[max_len(64)]
    pub title: String,
    #[max_len(200)]
    pub uri: String,
}

#[account]
#[derive(InitSpace)]
pub struct Pledge {
    pub campaign: Pubkey,
    /// Whoever holds the seat now: the wallet that pledged, or one that bought the seat since.
    pub backer: Pubkey,
    /// Position in the queue, starting at zero. It stays with the seat when the seat is sold.
    pub index: u32,
    pub braked: bool,
    pub bump: u8,
}

/// A seat offered for sale by its holder. It is only an offer: the seat stays with the seller,
/// who can take the offer down at any time, until someone pays the asking price.
#[account]
#[derive(InitSpace)]
pub struct Listing {
    pub campaign: Pubkey,
    pub seller: Pubkey,
    pub ask: u64,
    pub bump: u8,
}

fn overflow() -> Error {
    error!(TandaJadiError::MathOverflow)
}

fn mul_div(a: u64, b: u64, denominator: u64) -> Result<u64> {
    let value = (a as u128)
        .checked_mul(b as u128)
        .and_then(|v| v.checked_div(denominator as u128))
        .ok_or_else(overflow)?;
    u64::try_from(value).map_err(|_| overflow())
}

impl Campaign {
    /// What the creator locks at creation: the most the failure bonus can ever cost.
    pub fn bond(&self) -> Result<u64> {
        self.bonus_per_early
            .checked_mul(self.early_slots as u64)
            .ok_or_else(overflow)
    }

    pub fn raised(&self) -> Result<u64> {
        self.price
            .checked_mul(self.backers as u64)
            .ok_or_else(overflow)
    }

    pub fn fee(&self) -> Result<u64> {
        mul_div(self.raised()?, self.fee_bps as u64, BPS_DENOMINATOR)
    }

    pub fn upfront(&self) -> Result<u64> {
        mul_div(self.raised()?, self.upfront_bps as u64, BPS_DENOMINATOR)
    }

    /// The part of the raise that is released over the build period.
    pub fn stream_total(&self) -> Result<u64> {
        self.raised()?
            .checked_sub(self.fee()?)
            .and_then(|v| v.checked_sub(self.upfront().ok()?))
            .ok_or_else(overflow)
    }

    pub fn build_end(&self) -> i64 {
        self.funded_at.saturating_add(self.build_secs)
    }

    pub fn vested_at(&self, time: i64) -> Result<u64> {
        let elapsed = time
            .saturating_sub(self.funded_at)
            .clamp(0, self.build_secs);
        mul_div(self.stream_total()?, elapsed as u64, self.build_secs as u64)
    }

    fn bonuses_owed(&self) -> Result<u64> {
        self.bonus_per_early
            .checked_mul(self.backers.min(self.early_slots) as u64)
            .ok_or_else(overflow)
    }

    fn refunds_owed_after_brake(&self) -> Result<u64> {
        self.refund_per_backer
            .checked_mul(self.backers as u64)
            .ok_or_else(overflow)
    }

    /// Applies the transitions that only depend on the clock. Every instruction calls this
    /// first, so no one has to send a separate "settle" transaction.
    pub fn sync(&mut self, now: i64) {
        match self.status {
            Status::Funding if now >= self.deadline => self.status = Status::Failed,
            Status::Building if now >= self.build_end() => self.status = Status::Completed,
            _ => {}
        }
    }

    /// Registers one more backer and returns their position in the queue.
    /// The backer who fills the last slot starts the build period.
    pub fn add_backer(&mut self, now: i64) -> Result<u32> {
        self.sync(now);
        require!(self.status == Status::Funding, TandaJadiError::NotFunding);

        let index = self.backers;
        self.backers = index.checked_add(1).ok_or_else(overflow)?;
        if self.backers == self.target_backers {
            self.status = Status::Building;
            self.funded_at = now;
        }
        Ok(index)
    }

    /// Seats change hands only while the outcome is open: before the deadline, or during the
    /// build. After that a seat is a refund claim or a receipt and stays with its holder.
    pub fn ensure_tradable(&mut self, now: i64) -> Result<()> {
        self.sync(now);
        require!(
            matches!(self.status, Status::Funding | Status::Building),
            TandaJadiError::NotTradable
        );
        Ok(())
    }

    /// Hands a seat to a new holder. A brake does not travel with it: pulling it was the
    /// seller's judgement, so the new holder starts with the brake released.
    pub fn transfer_seat(&mut self, now: i64, seller_braked: bool) -> Result<()> {
        self.ensure_tradable(now)?;
        if seller_braked {
            self.brakes = self.brakes.checked_sub(1).ok_or_else(overflow)?;
        }
        Ok(())
    }

    /// Moves one backer's brake. Once more than half of the backers hold it, the stream stops
    /// for good: the unreleased part of the raise and the bond are split between the backers,
    /// capped at what each of them paid.
    pub fn move_brake(&mut self, now: i64, was_on: bool, on: bool) -> Result<()> {
        self.sync(now);
        require!(self.status == Status::Building, TandaJadiError::NotBuilding);
        require!(was_on != on, TandaJadiError::BrakeUnchanged);

        self.brakes = if on {
            self.brakes.checked_add(1)
        } else {
            self.brakes.checked_sub(1)
        }
        .ok_or_else(overflow)?;

        if (self.brakes as u64) * 2 > self.backers as u64 {
            let unreleased = self
                .stream_total()?
                .checked_sub(self.vested_at(now)?)
                .ok_or_else(overflow)?;
            let pool = unreleased.checked_add(self.bond()?).ok_or_else(overflow)?;
            self.refund_per_backer = (pool / self.backers as u64).min(self.price);
            self.braked_at = now;
            self.status = Status::Braked;
        }
        Ok(())
    }

    /// Everything the creator may have taken out by `now`, including what was already withdrawn.
    /// Call `sync` first.
    pub fn creator_entitled(&self, now: i64) -> Result<u64> {
        let total = match self.status {
            Status::Funding => Some(0),
            Status::Failed => self.bond()?.checked_sub(self.bonuses_owed()?),
            Status::Building => self.upfront()?.checked_add(self.vested_at(now)?),
            Status::Completed => self.payout_after_target()?.checked_add(self.bond()?),
            Status::Braked => self
                .payout_after_target()?
                .checked_add(self.bond()?)
                .and_then(|v| v.checked_sub(self.refunds_owed_after_brake().ok()?)),
        };
        total.ok_or_else(overflow)
    }

    fn payout_after_target(&self) -> Result<u64> {
        self.upfront()?
            .checked_add(self.stream_total()?)
            .ok_or_else(overflow)
    }

    /// What the backer at `index` gets back. Call `sync` first.
    pub fn refund_for(&self, index: u32) -> Result<u64> {
        match self.status {
            Status::Failed if index < self.early_slots => self
                .price
                .checked_add(self.bonus_per_early)
                .ok_or_else(overflow),
            Status::Failed => Ok(self.price),
            Status::Braked => Ok(self.refund_per_backer),
            _ => err!(TandaJadiError::NotRefundable),
        }
    }

    pub fn fee_due(&self) -> Result<u64> {
        require!(
            matches!(
                self.status,
                Status::Building | Status::Braked | Status::Completed
            ),
            TandaJadiError::FeeNotDue
        );
        require!(!self.fee_collected, TandaJadiError::FeeAlreadyCollected);
        self.fee()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const USD: u64 = 1_000_000;
    const DAY: i64 = 86_400;

    /// Budi's campaign from the product brief: 50 backers at $10 within 7 days, a $2.50 bonus
    /// for the first 20 backers (so a $50 bond), 20% upfront, 3% fee, 14 days to build.
    fn budi() -> Campaign {
        Campaign {
            creator: Pubkey::default(),
            mint: Pubkey::default(),
            id: 1,
            price: 10 * USD,
            target_backers: 50,
            early_slots: 20,
            bonus_per_early: 2_500_000,
            deadline: 7 * DAY,
            build_secs: 14 * DAY,
            upfront_bps: 2_000,
            fee_bps: 300,
            status: Status::Funding,
            backers: 0,
            brakes: 0,
            funded_at: 0,
            braked_at: 0,
            refund_per_backer: 0,
            creator_withdrawn: 0,
            fee_collected: false,
            bump: 255,
            title: String::new(),
            uri: String::new(),
        }
    }

    fn with_backers(count: u32, at: i64) -> Campaign {
        let mut campaign = budi();
        for _ in 0..count {
            campaign.add_backer(at).unwrap();
        }
        campaign
    }

    fn code(result: Result<impl core::fmt::Debug>) -> u32 {
        match result.unwrap_err() {
            Error::AnchorError(e) => e.error_code_number,
            other => panic!("unexpected error: {other:?}"),
        }
    }

    fn vault(campaign: &Campaign) -> u64 {
        campaign.bond().unwrap() + campaign.raised().unwrap()
    }

    #[test]
    fn failure_pays_early_backers_from_the_bond() {
        let mut campaign = with_backers(30, DAY);
        campaign.sync(7 * DAY);

        assert_eq!(campaign.status, Status::Failed);
        assert_eq!(campaign.refund_for(0).unwrap(), 12_500_000);
        assert_eq!(campaign.refund_for(19).unwrap(), 12_500_000);
        assert_eq!(campaign.refund_for(20).unwrap(), 10 * USD);
        assert_eq!(campaign.creator_entitled(7 * DAY).unwrap(), 0);
        assert_eq!(
            code(campaign.fee_due()),
            TandaJadiError::FeeNotDue as u32 + 6000
        );
    }

    #[test]
    fn failure_returns_the_unused_bond() {
        let mut campaign = with_backers(5, DAY);
        campaign.sync(8 * DAY);

        // Five early backers were paid $2.50 each; the other $37.50 was never owed.
        assert_eq!(campaign.creator_entitled(8 * DAY).unwrap(), 37_500_000);

        let refunds: u64 = (0..5).map(|i| campaign.refund_for(i).unwrap()).sum();
        assert_eq!(refunds + 37_500_000, vault(&campaign));
    }

    #[test]
    fn nobody_can_pledge_after_the_deadline_or_once_full() {
        let mut late = with_backers(3, DAY);
        assert_eq!(
            code(late.add_backer(7 * DAY)),
            TandaJadiError::NotFunding as u32 + 6000
        );

        let mut full = with_backers(50, DAY);
        assert_eq!(full.status, Status::Building);
        assert_eq!(
            code(full.add_backer(DAY)),
            TandaJadiError::NotFunding as u32 + 6000
        );
    }

    #[test]
    fn reaching_the_target_starts_the_stream() {
        let start = 2 * DAY;
        let mut campaign = with_backers(50, start);

        assert_eq!(campaign.funded_at, start);
        assert_eq!(campaign.fee().unwrap(), 15 * USD);
        assert_eq!(campaign.upfront().unwrap(), 100 * USD);
        assert_eq!(campaign.stream_total().unwrap(), 385 * USD);

        assert_eq!(campaign.creator_entitled(start).unwrap(), 100 * USD);
        assert_eq!(
            campaign.creator_entitled(start + 7 * DAY).unwrap(),
            292_500_000
        );

        // The deadline of the funding period no longer matters once the target was reached.
        campaign.sync(7 * DAY);
        assert_eq!(campaign.status, Status::Building);

        let end = start + 14 * DAY;
        campaign.sync(end);
        assert_eq!(campaign.status, Status::Completed);
        assert_eq!(campaign.creator_entitled(end).unwrap(), 535 * USD);
        assert_eq!(535 * USD + campaign.fee_due().unwrap(), vault(&campaign));
    }

    #[test]
    fn brake_needs_more_than_half() {
        let mut campaign = with_backers(50, DAY);
        for _ in 0..25 {
            campaign.move_brake(DAY, false, true).unwrap();
        }
        assert_eq!(campaign.status, Status::Building);

        campaign.move_brake(DAY, true, false).unwrap();
        assert_eq!(campaign.brakes, 24);

        campaign.move_brake(DAY, false, true).unwrap();
        campaign.move_brake(DAY, false, true).unwrap();
        assert_eq!(campaign.status, Status::Braked);
    }

    #[test]
    fn brake_returns_what_was_not_released() {
        let start = DAY;
        let mut campaign = with_backers(50, start);
        for _ in 0..26 {
            campaign.move_brake(start, false, true).unwrap();
        }

        // Nothing was streamed yet: $385 unreleased plus the $50 bond, over 50 backers.
        assert_eq!(campaign.refund_per_backer, 8_700_000);
        assert_eq!(campaign.refund_for(49).unwrap(), 8_700_000);
        // The creator keeps the upfront share and nothing else, however long they wait.
        assert_eq!(campaign.creator_entitled(start).unwrap(), 100 * USD);
        assert_eq!(
            campaign.creator_entitled(start + 30 * DAY).unwrap(),
            100 * USD
        );
    }

    #[test]
    fn brake_halfway_keeps_what_was_already_earned() {
        let start = DAY;
        let mut campaign = with_backers(50, start);
        let halfway = start + 7 * DAY;
        for _ in 0..26 {
            campaign.move_brake(halfway, false, true).unwrap();
        }

        // $192.50 unreleased plus the $50 bond, over 50 backers.
        assert_eq!(campaign.refund_per_backer, 4_850_000);
        assert_eq!(campaign.creator_entitled(halfway).unwrap(), 292_500_000);
    }

    #[test]
    fn brake_never_pays_a_backer_more_than_they_paid() {
        let mut campaign = budi();
        campaign.bonus_per_early = 20 * USD; // a $400 bond on a $500 raise
        for _ in 0..50 {
            campaign.add_backer(DAY).unwrap();
        }
        for _ in 0..26 {
            campaign.move_brake(DAY, false, true).unwrap();
        }

        assert_eq!(campaign.refund_per_backer, 10 * USD);
        // $385 + $400 was available, $500 went back, the rest of the bond returns to the creator.
        assert_eq!(campaign.creator_entitled(DAY).unwrap(), 385 * USD);
    }

    #[test]
    fn brake_is_closed_outside_the_build_period() {
        let mut funding = with_backers(10, DAY);
        assert_eq!(
            code(funding.move_brake(DAY, false, true)),
            TandaJadiError::NotBuilding as u32 + 6000
        );

        let mut done = with_backers(50, DAY);
        assert_eq!(
            code(done.move_brake(15 * DAY, false, true)),
            TandaJadiError::NotBuilding as u32 + 6000
        );
        assert_eq!(done.status, Status::Completed);
    }

    #[test]
    fn every_token_in_the_vault_is_owed_to_someone() {
        // Awkward numbers on purpose, so integer division leaves dust in every formula.
        for braked_after in [0, 1, 333_333, 999_999, 1_000_000] {
            let mut campaign = budi();
            campaign.price = 9_999_999;
            campaign.target_backers = 7;
            campaign.early_slots = 3;
            campaign.bonus_per_early = 3_333_333;
            campaign.build_secs = 1_000_001;
            campaign.fee_bps = 333;
            campaign.upfront_bps = 1_777;
            for _ in 0..7 {
                campaign.add_backer(DAY).unwrap();
            }
            for _ in 0..4 {
                campaign
                    .move_brake(DAY + braked_after, false, true)
                    .unwrap();
            }
            assert_eq!(campaign.status, Status::Braked);

            let owed = campaign.fee().unwrap()
                + campaign.creator_entitled(DAY + braked_after).unwrap()
                + campaign.refund_per_backer * 7;
            assert_eq!(owed, vault(&campaign));
        }
    }

    #[test]
    fn a_seat_changes_hands_only_while_the_outcome_is_open() {
        let mut funding = with_backers(3, DAY);
        funding.transfer_seat(2 * DAY, false).unwrap();
        assert_eq!(
            code(funding.transfer_seat(7 * DAY, false)),
            TandaJadiError::NotTradable as u32 + 6000
        );

        let mut building = with_backers(50, DAY);
        building.transfer_seat(2 * DAY, false).unwrap();
        assert_eq!(
            code(building.transfer_seat(15 * DAY, false)),
            TandaJadiError::NotTradable as u32 + 6000
        );

        let mut braked = with_backers(50, DAY);
        for _ in 0..26 {
            braked.move_brake(DAY, false, true).unwrap();
        }
        assert_eq!(
            code(braked.transfer_seat(DAY, true)),
            TandaJadiError::NotTradable as u32 + 6000
        );
        assert_eq!(braked.brakes, 26);
    }

    #[test]
    fn a_sold_seat_arrives_with_its_brake_released() {
        let mut campaign = with_backers(50, DAY);
        for _ in 0..25 {
            campaign.move_brake(DAY, false, true).unwrap();
        }
        campaign.transfer_seat(DAY, true).unwrap();
        assert_eq!(campaign.brakes, 24);

        // The buyer pulling it again counts once, and 25 of 50 is still not a majority.
        campaign.move_brake(DAY, false, true).unwrap();
        assert_eq!(campaign.brakes, 25);
        assert_eq!(campaign.status, Status::Building);
        assert_eq!(campaign.backers, 50);
    }

    /// A tiny deterministic generator, so a failing run can be repeated exactly.
    struct Rng(u64);

    impl Rng {
        fn range(&mut self, low: u64, high: u64) -> u64 {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 7;
            self.0 ^= self.0 << 17;
            low + self.0 % (high - low + 1)
        }
    }

    /// Plays thousands of random campaigns the way the instructions would. Every payout comes
    /// out of a vault balance that may never be overdrawn, and once the clocks have run out and
    /// everybody has collected, the vault has to be exactly empty.
    #[test]
    fn random_campaigns_pay_out_exactly_what_came_in() {
        let mut rng = Rng(0x7a6e_6461_6a61_6469);
        let (mut failed, mut braked, mut completed) = (0, 0, 0);

        for run in 0..5_000 {
            let target = rng.range(1, 30) as u32;
            let mut campaign = budi();
            campaign.price = rng.range(1, 1_000_000_000);
            campaign.target_backers = target;
            campaign.early_slots = rng.range(1, target as u64) as u32;
            campaign.bonus_per_early = rng.range(1, 2_000_000_000);
            campaign.deadline = rng.range(1, 1_000_000) as i64;
            campaign.build_secs = rng.range(1, 1_000_000) as i64;
            campaign.upfront_bps = rng.range(0, 3_000) as u16;
            campaign.fee_bps = rng.range(0, 1_000) as u16;

            let mut now = 0;
            let mut vault = campaign.bond().unwrap();
            // One entry per backer who still holds a pledge: queue position and brake position.
            let mut pledges: Vec<(u32, bool)> = Vec::new();
            let pace = (campaign.deadline.max(campaign.build_secs) / 20) as u64;
            // How many faces of the die mean "someone pledges". Zero is a campaign nobody wants.
            let eagerness = rng.range(0, 5);

            for _ in 0..150 {
                match rng.range(0, 7 + eagerness) {
                    0..=1 => now += rng.range(0, pace) as i64,
                    2..=3 if !pledges.is_empty() => {
                        let pick = rng.range(0, pledges.len() as u64 - 1) as usize;
                        let on = !pledges[pick].1;
                        if campaign.move_brake(now, !on, on).is_ok() {
                            pledges[pick].1 = on;
                        }
                    }
                    4 if !pledges.is_empty() => {
                        // A seat is sold: same place in the queue, brake released.
                        let pick = rng.range(0, pledges.len() as u64 - 1) as usize;
                        if campaign.transfer_seat(now, pledges[pick].1).is_ok() {
                            pledges[pick].1 = false;
                        }
                    }
                    5 => pay_creator(&mut campaign, &mut vault, now, run),
                    6 if !pledges.is_empty() => {
                        let pick = rng.range(0, pledges.len() as u64 - 1) as usize;
                        campaign.sync(now);
                        if let Ok(amount) = campaign.refund_for(pledges[pick].0) {
                            vault = vault
                                .checked_sub(amount)
                                .expect("refund overdraws the vault");
                            pledges.swap_remove(pick);
                        }
                    }
                    7 => pay_fee(&mut campaign, &mut vault, now, run),
                    8.. => {
                        if let Ok(index) = campaign.add_backer(now) {
                            vault += campaign.price;
                            pledges.push((index, false));
                        }
                    }
                    _ => {}
                }

                // While seats can still change hands, the count of brakes is exactly the
                // number of holders pulling one.
                if matches!(campaign.status, Status::Funding | Status::Building) {
                    let pulled = pledges.iter().filter(|(_, braked)| *braked).count();
                    assert_eq!(
                        campaign.brakes as usize, pulled,
                        "run {run}: brakes drifted"
                    );
                }
            }

            // Long after every deadline: everybody collects what is theirs.
            now += 3_000_000;
            pay_creator(&mut campaign, &mut vault, now, run);
            pay_fee(&mut campaign, &mut vault, now, run);
            for (index, _) in pledges {
                if let Ok(amount) = campaign.refund_for(index) {
                    vault = vault
                        .checked_sub(amount)
                        .expect("refund overdraws the vault");
                }
            }
            assert_eq!(vault, 0, "run {run} left money in the vault");

            match campaign.status {
                Status::Failed => failed += 1,
                Status::Braked => braked += 1,
                Status::Completed => completed += 1,
                other => panic!("run {run} ended as {other:?}"),
            }
        }

        // The runs have to reach every ending, or the checks above prove little.
        assert!(
            failed > 500 && braked > 500 && completed > 500,
            "failed {failed}, braked {braked}, completed {completed}"
        );
    }

    fn pay_creator(campaign: &mut Campaign, vault: &mut u64, now: i64, run: u32) {
        campaign.sync(now);
        let amount = campaign
            .creator_entitled(now)
            .unwrap()
            .checked_sub(campaign.creator_withdrawn)
            .unwrap_or_else(|| {
                panic!("run {run}: the creator's share shrank below what they took")
            });
        *vault = vault
            .checked_sub(amount)
            .unwrap_or_else(|| panic!("run {run}: the creator's payout overdraws the vault"));
        campaign.creator_withdrawn += amount;
    }

    fn pay_fee(campaign: &mut Campaign, vault: &mut u64, now: i64, run: u32) {
        campaign.sync(now);
        if let Ok(amount) = campaign.fee_due() {
            *vault = vault
                .checked_sub(amount)
                .unwrap_or_else(|| panic!("run {run}: the fee overdraws the vault"));
            campaign.fee_collected = true;
        }
    }
}
