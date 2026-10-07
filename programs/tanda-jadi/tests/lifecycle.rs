//! End-to-end runs of the compiled program: the two outcomes of a campaign, the brake, and the
//! ways someone might try to take money that is not theirs.

mod common;

use {
    common::*,
    solana_signer::Signer,
    tanda_jadi::{error::TandaJadiError, state::Status, CreateCampaignArgs},
};

const BOND: u64 = 5 * USD;

#[test]
fn a_failed_campaign_pays_early_backers_more_than_they_put_in() {
    let mut world = World::new();
    let budi = world.wallet(BOND);
    let campaign = world.create_campaign(&budi, terms()).unwrap();
    assert_eq!(world.balance(&budi.pubkey()), 0);
    assert_eq!(world.balance(&campaign), BOND);

    // Three of the five seats fill, then the week runs out.
    let backers = world.backers(&campaign, 3);
    let rina = backers[0].pubkey();
    assert_eq!(world.balance(&rina), 0);
    assert_eq!(world.balance(&campaign), BOND + 30 * USD);
    world.wait(7 * DAY);

    for backer in &backers {
        world.claim_refund(&campaign, &backer.pubkey()).unwrap();
    }

    // Rina and the second backer hold the two bonus seats; the third only gets their money back.
    assert_eq!(world.balance(&rina), 12_500_000);
    assert_eq!(world.balance(&backers[1].pubkey()), 12_500_000);
    assert_eq!(world.balance(&backers[2].pubkey()), 10 * USD);

    // The bond is gone, the vault is empty, and no fee was taken.
    assert_eq!(world.campaign(&campaign).status, Status::Failed);
    assert_eq!(world.balance(&campaign), 0);
    assert_rejected(world.withdraw(&campaign), TandaJadiError::NothingToWithdraw);
    assert_rejected(world.collect_fee(&campaign), TandaJadiError::FeeNotDue);
    assert_eq!(world.balance(&budi.pubkey()), 0);
    assert_eq!(world.balance(&world.treasury), 0);
}

#[test]
fn a_refund_can_only_be_claimed_once_and_only_by_its_backer() {
    let mut world = World::new();
    let budi = world.wallet(BOND);
    let campaign = world.create_campaign(&budi, terms()).unwrap();
    let backers = world.backers(&campaign, 3);
    let rina = backers[0].pubkey();
    let mallory = world.wallet(0);

    // Not while the campaign is still open.
    assert_rejected(
        world.claim_refund(&campaign, &rina),
        TandaJadiError::NotRefundable,
    );
    world.wait(7 * DAY);

    // Rina's refund cannot be pointed at someone else's token account (ConstraintTokenOwner).
    let mallory_token = world.token_account(&mallory.pubkey());
    assert_custom_error(
        world.claim_refund_into(&campaign, &rina, &mallory_token),
        2015,
    );
    // Someone who never pledged has no pledge account to claim with (AccountNotInitialized).
    assert_custom_error(world.claim_refund(&campaign, &mallory.pubkey()), 3012);

    world.claim_refund(&campaign, &rina).unwrap();
    assert!(!world.exists(&pledge_address(&campaign, &rina)));
    assert_custom_error(world.claim_refund(&campaign, &rina), 3012);
    assert_eq!(world.balance(&rina), 12_500_000);
}

#[test]
fn bonus_seats_that_stay_empty_cost_the_creator_nothing() {
    let mut world = World::new();
    let budi = world.wallet(BOND);
    let campaign = world.create_campaign(&budi, terms()).unwrap();
    let backers = world.backers(&campaign, 1);
    world.wait(7 * DAY);

    // One of the two bonus seats was taken, so half of the bond was never owed.
    world.withdraw(&campaign).unwrap();
    assert_eq!(world.balance(&budi.pubkey()), 2_500_000);
    assert_rejected(world.withdraw(&campaign), TandaJadiError::NothingToWithdraw);

    world.claim_refund(&campaign, &backers[0].pubkey()).unwrap();
    assert_eq!(world.balance(&backers[0].pubkey()), 12_500_000);
    assert_eq!(world.balance(&campaign), 0);
}

#[test]
fn a_funded_campaign_streams_to_the_creator() {
    let mut world = World::new();
    let budi = world.wallet(BOND);
    let campaign = world.create_campaign(&budi, terms()).unwrap();
    world.wait(DAY);

    let backers = world.backers(&campaign, 4);
    assert_eq!(world.campaign(&campaign).status, Status::Funding);
    assert_rejected(world.withdraw(&campaign), TandaJadiError::NothingToWithdraw);

    // The fifth backer fills the campaign, which starts the build period on the spot.
    let last = world.backers(&campaign, 1);
    let state = world.campaign(&campaign);
    assert_eq!(state.status, Status::Building);
    assert_eq!(state.funded_at, world.now());

    // $50 raised: 20% upfront, 3% fee, $38.50 left to stream over 14 days.
    world.withdraw(&campaign).unwrap();
    assert_eq!(world.balance(&budi.pubkey()), 10 * USD);
    world.collect_fee(&campaign).unwrap();
    assert_eq!(world.balance(&world.treasury), 1_500_000);
    assert_rejected(
        world.collect_fee(&campaign),
        TandaJadiError::FeeAlreadyCollected,
    );

    world.wait(7 * DAY);
    world.withdraw(&campaign).unwrap();
    assert_eq!(world.balance(&budi.pubkey()), 10 * USD + 19_250_000);

    // Nobody gets a refund from a campaign that is being built, and the seats are closed.
    assert_rejected(
        world.claim_refund(&campaign, &backers[0].pubkey()),
        TandaJadiError::NotRefundable,
    );
    let latecomer = world.wallet(10 * USD);
    assert_rejected(
        world.pledge(&campaign, &latecomer),
        TandaJadiError::NotFunding,
    );

    // At the end of the build period the rest of the stream and the bond are released.
    world.wait(7 * DAY);
    world.withdraw(&campaign).unwrap();
    assert_eq!(world.campaign(&campaign).status, Status::Completed);
    assert_eq!(world.balance(&budi.pubkey()), 10 * USD + 38_500_000 + BOND);
    assert_eq!(world.balance(&campaign), 0);
    assert_rejected(
        world.set_brake(&campaign, &last[0], true),
        TandaJadiError::NotBuilding,
    );

    // The pledge account stays behind as the backer's receipt.
    assert!(world.exists(&pledge_address(&campaign, &last[0].pubkey())));
}

#[test]
fn a_majority_of_backers_can_stop_the_stream() {
    let mut world = World::new();
    let budi = world.wallet(BOND);
    let campaign = world.create_campaign(&budi, terms()).unwrap();
    let backers = world.backers(&campaign, 5);

    // Budi takes the upfront share and a quarter of the stream, then goes quiet.
    world.wait(14 * DAY / 4);
    world.withdraw(&campaign).unwrap();
    assert_eq!(world.balance(&budi.pubkey()), 10 * USD + 9_625_000);

    world.set_brake(&campaign, &backers[0], true).unwrap();
    world.set_brake(&campaign, &backers[1], true).unwrap();
    assert_rejected(
        world.set_brake(&campaign, &backers[1], true),
        TandaJadiError::BrakeUnchanged,
    );
    assert_eq!(world.campaign(&campaign).status, Status::Building);

    // A backer can change their mind while the brake has no majority.
    world.set_brake(&campaign, &backers[1], false).unwrap();
    world.set_brake(&campaign, &backers[1], true).unwrap();
    world.set_brake(&campaign, &backers[2], true).unwrap();

    let state = world.campaign(&campaign);
    assert_eq!(state.status, Status::Braked);
    // Three quarters of the stream ($28.875) and the $5 bond, split five ways.
    assert_eq!(state.refund_per_backer, 6_775_000);
    assert_rejected(
        world.set_brake(&campaign, &backers[3], true),
        TandaJadiError::NotBuilding,
    );

    // Time passing changes nothing any more: the stream is frozen where the brake caught it.
    world.wait(30 * DAY);
    assert_rejected(world.withdraw(&campaign), TandaJadiError::NothingToWithdraw);
    for backer in &backers {
        world.claim_refund(&campaign, &backer.pubkey()).unwrap();
        assert_eq!(world.balance(&backer.pubkey()), 6_775_000);
    }

    world.collect_fee(&campaign).unwrap();
    assert_eq!(world.balance(&campaign), 0);
    assert_eq!(world.balance(&budi.pubkey()), 10 * USD + 9_625_000);
}

#[test]
fn outsiders_cannot_brake_or_redirect_a_payout() {
    let mut world = World::new();
    let budi = world.wallet(BOND);
    let campaign = world.create_campaign(&budi, terms()).unwrap();
    let backers = world.backers(&campaign, 5);
    let mallory = world.wallet(10 * USD);

    // No pledge, no brake (AccountNotInitialized).
    assert_custom_error(world.set_brake(&campaign, &mallory, true), 3012);

    // The stream cannot be sent to anyone but the creator (ConstraintTokenOwner).
    let mallory_token = world.token_account(&mallory.pubkey());
    assert_custom_error(world.withdraw_into(&campaign, &mallory_token), 2015);

    // One wallet holds one pledge. The system program refuses to create the account twice.
    let dewi = world.wallet(BOND);
    let second = world.create_campaign(&dewi, terms()).unwrap();
    let repeat = world.wallet(20 * USD);
    world.pledge(&second, &repeat).unwrap();
    assert_custom_error(world.pledge(&second, &repeat), 0);
    assert_eq!(world.balance(&repeat.pubkey()), 10 * USD);

    assert_eq!(world.campaign(&campaign).backers, backers.len() as u32);
}

#[test]
fn nobody_can_pledge_after_the_deadline() {
    let mut world = World::new();
    let budi = world.wallet(BOND);
    let campaign = world.create_campaign(&budi, terms()).unwrap();
    world.backers(&campaign, 2);

    world.wait(7 * DAY);
    let late = world.wallet(10 * USD);
    assert_rejected(world.pledge(&campaign, &late), TandaJadiError::NotFunding);
    assert_eq!(world.balance(&late.pubkey()), 10 * USD);
}

#[test]
fn a_campaign_needs_a_real_bond_and_sane_terms() {
    let mut world = World::new();

    // The bond has to be in the creator's account when the campaign is created.
    let broke = world.wallet(BOND - 1);
    assert!(world.create_campaign(&broke, terms()).is_err());

    let budi = world.wallet(BOND);
    let rejected = [
        (
            CreateCampaignArgs {
                price: 0,
                ..terms()
            },
            TandaJadiError::InvalidPrice,
        ),
        (
            CreateCampaignArgs {
                target_backers: 0,
                ..terms()
            },
            TandaJadiError::InvalidTarget,
        ),
        (
            CreateCampaignArgs {
                early_slots: 0,
                ..terms()
            },
            TandaJadiError::InvalidEarlySlots,
        ),
        (
            CreateCampaignArgs {
                early_slots: 6,
                ..terms()
            },
            TandaJadiError::InvalidEarlySlots,
        ),
        (
            CreateCampaignArgs {
                bonus_per_early: 0,
                ..terms()
            },
            TandaJadiError::InvalidBonus,
        ),
        (
            CreateCampaignArgs {
                funding_secs: 0,
                ..terms()
            },
            TandaJadiError::InvalidDuration,
        ),
        (
            CreateCampaignArgs {
                build_secs: 366 * DAY,
                ..terms()
            },
            TandaJadiError::InvalidDuration,
        ),
        (
            CreateCampaignArgs {
                upfront_bps: 3_001,
                ..terms()
            },
            TandaJadiError::UpfrontTooHigh,
        ),
        (
            CreateCampaignArgs {
                price: u64::MAX,
                ..terms()
            },
            TandaJadiError::MathOverflow,
        ),
        (
            CreateCampaignArgs {
                title: "x".repeat(65),
                ..terms()
            },
            TandaJadiError::TextTooLong,
        ),
    ];
    for (args, expected) in rejected {
        assert_rejected(world.create_campaign(&budi, args).map(|_| ()), expected);
    }

    assert_eq!(world.balance(&budi.pubkey()), BOND);
}

#[test]
fn a_fee_change_leaves_running_campaigns_alone() {
    let mut world = World::new();
    let budi = world.wallet(2 * BOND);
    let first = world.create_campaign(&budi, terms()).unwrap();

    let mallory = world.wallet(0);
    // Mallory is not the admin (ConstraintHasOne is replaced by our own error).
    assert_rejected(
        world.update_config(&mallory, mallory.pubkey(), 0),
        TandaJadiError::Unauthorized,
    );

    let admin = world.admin.insecure_clone();
    assert_rejected(
        world.update_config(&admin, world.treasury, 1_001),
        TandaJadiError::FeeTooHigh,
    );
    world.update_config(&admin, world.treasury, 1_000).unwrap();

    let mut second_terms = terms();
    second_terms.id = 2;
    let second = world.create_campaign(&budi, second_terms).unwrap();

    assert_eq!(world.campaign(&first).fee_bps, FEE_BPS);
    assert_eq!(world.campaign(&second).fee_bps, 1_000);

    world.backers(&first, 5);
    world.collect_fee(&first).unwrap();
    assert_eq!(world.balance(&world.treasury), 1_500_000);
}
