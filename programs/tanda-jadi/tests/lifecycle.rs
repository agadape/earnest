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

#[test]
fn a_seat_can_be_sold_and_takes_its_bonus_along() {
    let mut world = World::new();
    let budi = world.wallet(BOND);
    let campaign = world.create_campaign(&budi, terms()).unwrap();
    let backers = world.backers(&campaign, 3);
    let rina = &backers[0];

    // Rina holds the first bonus seat and offers it for $11.50.
    world.list_seat(&campaign, rina, 11_500_000).unwrap();
    let dewi = world.wallet(11_500_000);
    world
        .buy_seat(&campaign, &rina.pubkey(), &dewi, 11_500_000)
        .unwrap();

    assert_eq!(world.balance(&rina.pubkey()), 11_500_000);
    assert_eq!(world.balance(&dewi.pubkey()), 0);
    assert!(!world.exists(&pledge_address(&campaign, &rina.pubkey())));
    assert!(!world.exists(&listing_address(&campaign, &rina.pubkey())));
    assert_eq!(world.pledge_of(&campaign, &dewi.pubkey()).index, 0);
    // The vault and the head count are untouched: the campaign did not lose a backer.
    assert_eq!(world.campaign(&campaign).backers, 3);
    assert_eq!(world.balance(&campaign), BOND + 30 * USD);

    // The bonus follows the seat, not the wallet that first took it.
    world.wait(7 * DAY);
    world.claim_refund(&campaign, &dewi.pubkey()).unwrap();
    assert_eq!(world.balance(&dewi.pubkey()), 12_500_000);
    assert_custom_error(world.claim_refund(&campaign, &rina.pubkey()), 3012);
}

#[test]
fn a_seat_sale_cannot_be_forced_or_gamed() {
    let mut world = World::new();
    let budi = world.wallet(BOND);
    let campaign = world.create_campaign(&budi, terms()).unwrap();
    let backers = world.backers(&campaign, 2);
    let (rina, sari) = (&backers[0], &backers[1]);
    let mallory = world.wallet(50 * USD);

    // Only a seat holder can offer a seat (AccountNotInitialized), and not for nothing.
    assert_custom_error(world.list_seat(&campaign, &mallory, 5 * USD), 3012);
    assert_rejected(
        world.list_seat(&campaign, rina, 0),
        TandaJadiError::InvalidAsk,
    );
    // A seat that is not on offer cannot be bought.
    assert_custom_error(
        world.buy_seat(&campaign, &rina.pubkey(), &mallory, 50 * USD),
        3012,
    );

    world.list_seat(&campaign, rina, 12 * USD).unwrap();
    // One offer per seat. The system program refuses to create the account twice.
    assert_custom_error(world.list_seat(&campaign, rina, 13 * USD), 0);

    // The buyer names the most they will pay, so a seller cannot raise the price under them.
    assert_rejected(
        world.buy_seat(&campaign, &rina.pubkey(), &mallory, 12 * USD - 1),
        TandaJadiError::AskTooHigh,
    );
    // One seat per wallet still holds: Sari cannot add Rina's seat to her own.
    assert_custom_error(world.buy_seat(&campaign, &rina.pubkey(), sari, 12 * USD), 0);

    // Nobody but the seller can take an offer down (ConstraintHasOne or ConstraintSeeds).
    let listing = listing_address(&campaign, &rina.pubkey());
    let refused = world.unlist(&listing, &mallory).unwrap_err();
    assert!(
        refused.contains("Custom(2001)") || refused.contains("Custom(2006)"),
        "{refused}"
    );
    // The seller can, and then the seat cannot be bought any more.
    world.unlist_seat(&campaign, rina).unwrap();
    assert_custom_error(
        world.buy_seat(&campaign, &rina.pubkey(), &mallory, 50 * USD),
        3012,
    );

    // Once the deadline has passed a seat is a refund claim, and stays where it is.
    world.list_seat(&campaign, rina, 12 * USD).unwrap();
    world.wait(7 * DAY);
    assert_rejected(
        world.buy_seat(&campaign, &rina.pubkey(), &mallory, 12 * USD),
        TandaJadiError::NotTradable,
    );
    assert_rejected(
        world.list_seat(&campaign, sari, 12 * USD),
        TandaJadiError::NotTradable,
    );
    // The leftover offer can still be taken down, and the refund is unaffected by it.
    world.unlist_seat(&campaign, rina).unwrap();
    world.claim_refund(&campaign, &rina.pubkey()).unwrap();
    assert_eq!(world.balance(&rina.pubkey()), 12_500_000);
    assert_eq!(world.balance(&mallory.pubkey()), 50 * USD);
}

#[test]
fn a_seat_sold_during_the_build_arrives_with_its_brake_released() {
    let mut world = World::new();
    let budi = world.wallet(BOND);
    let campaign = world.create_campaign(&budi, terms()).unwrap();
    let backers = world.backers(&campaign, 5);
    world.wait(DAY);

    world.set_brake(&campaign, &backers[0], true).unwrap();
    world.set_brake(&campaign, &backers[1], true).unwrap();
    assert_eq!(world.campaign(&campaign).brakes, 2);

    // A full campaign has no seats left, so a latecomer buys from a holder, here above the price.
    world.list_seat(&campaign, &backers[0], 14 * USD).unwrap();
    let dewi = world.wallet(14 * USD);
    world
        .buy_seat(&campaign, &backers[0].pubkey(), &dewi, 14 * USD)
        .unwrap();
    assert_eq!(world.balance(&backers[0].pubkey()), 14 * USD);

    let state = world.campaign(&campaign);
    assert_eq!(
        (state.brakes, state.backers, state.status),
        (1, 5, Status::Building)
    );
    assert!(!world.pledge_of(&campaign, &dewi.pubkey()).braked);
    // The seller has no say any more.
    assert_custom_error(world.set_brake(&campaign, &backers[0], true), 3012);

    // The new holder decides for themselves, and their brake counts once.
    world.set_brake(&campaign, &dewi, true).unwrap();
    assert_eq!(world.campaign(&campaign).status, Status::Building);
    world.set_brake(&campaign, &backers[2], true).unwrap();
    assert_eq!(world.campaign(&campaign).status, Status::Braked);

    // Refunds go to whoever holds the seat now.
    let refund = world.campaign(&campaign).refund_per_backer;
    world.claim_refund(&campaign, &dewi.pubkey()).unwrap();
    assert_eq!(world.balance(&dewi.pubkey()), refund);
    assert_custom_error(world.claim_refund(&campaign, &backers[0].pubkey()), 3012);
}
