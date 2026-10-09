//! A small in-process chain with the program, one token and a config, plus the handful of
//! actions the tests need. Balances are in the token's base units (six decimals, like USDC).

use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::{
            clock::Clock, instruction::Instruction, program_option::COption, program_pack::Pack,
            system_program,
        },
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    anchor_spl::{
        associated_token::{self, get_associated_token_address},
        token::{self, spl_token},
    },
    litesvm::LiteSVM,
    solana_account::Account,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
    tanda_jadi::{
        constants::{CAMPAIGN_SEED, CONFIG_SEED, PLEDGE_SEED},
        error::TandaJadiError,
        state::{Campaign, Config},
        CreateCampaignArgs,
    },
};

pub const USD: u64 = 1_000_000;
pub const DAY: i64 = 86_400;
pub const FEE_BPS: u16 = 300;

const SOL: u64 = 1_000_000_000;

pub struct World {
    pub svm: LiteSVM,
    pub mint: Pubkey,
    pub admin: Keypair,
    pub treasury: Pubkey,
}

/// A five-seat version of the campaign in the product brief: $10 a seat within 7 days, a $2.50
/// bonus for the first two backers (a $5 bond), 20% upfront and 14 days to build.
pub fn terms() -> CreateCampaignArgs {
    CreateCampaignArgs {
        id: 1,
        price: 10 * USD,
        target_backers: 5,
        early_slots: 2,
        bonus_per_early: 2_500_000,
        funding_secs: 7 * DAY,
        build_secs: 14 * DAY,
        upfront_bps: 2_000,
        title: "Budi's developer tool".to_string(),
        uri: "https://example.com/budi".to_string(),
    }
}

pub fn config_address() -> Pubkey {
    Pubkey::find_program_address(&[CONFIG_SEED], &tanda_jadi::id()).0
}

pub fn campaign_address(creator: &Pubkey, id: u64) -> Pubkey {
    Pubkey::find_program_address(
        &[CAMPAIGN_SEED, creator.as_ref(), &id.to_le_bytes()],
        &tanda_jadi::id(),
    )
    .0
}

pub fn pledge_address(campaign: &Pubkey, backer: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[PLEDGE_SEED, campaign.as_ref(), backer.as_ref()],
        &tanda_jadi::id(),
    )
    .0
}

/// Asserts that a transaction was rejected with the given program error.
#[track_caller]
pub fn assert_rejected(result: Result<(), String>, expected: TandaJadiError) {
    assert_custom_error(result, 6000 + expected as u32);
}

/// Asserts that a transaction was rejected with the given numeric error, for errors raised by
/// Anchor's account checks or by another program.
#[track_caller]
pub fn assert_custom_error(result: Result<(), String>, code: u32) {
    let message = result.expect_err("transaction should have been rejected");
    assert!(
        message.contains(&format!("Custom({code})")),
        "expected custom error {code}, got: {message}"
    );
}

impl World {
    pub fn new() -> Self {
        let mut svm = LiteSVM::new();
        let program = include_bytes!(concat!(
            env!("CARGO_TARGET_TMPDIR"),
            "/../deploy/tanda_jadi.so"
        ));
        svm.add_program(tanda_jadi::id(), program).unwrap();

        let mint = Pubkey::new_unique();
        let mut data = [0u8; spl_token::state::Mint::LEN];
        spl_token::state::Mint {
            mint_authority: COption::None,
            supply: 0,
            decimals: 6,
            is_initialized: true,
            freeze_authority: COption::None,
        }
        .pack_into_slice(&mut data);
        svm.set_account(
            mint,
            Account {
                lamports: SOL,
                data: data.to_vec(),
                owner: token::ID,
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

        let admin = Keypair::new();
        svm.airdrop(&admin.pubkey(), 100 * SOL).unwrap();

        let mut world = Self {
            svm,
            mint,
            admin,
            treasury: Pubkey::new_unique(),
        };
        let treasury = world.treasury;
        world.set_balance(&treasury, 0);

        let instruction = Instruction::new_with_bytes(
            tanda_jadi::id(),
            &tanda_jadi::instruction::InitializeConfig {
                treasury: world.treasury,
                fee_bps: FEE_BPS,
            }
            .data(),
            tanda_jadi::accounts::InitializeConfig {
                admin: world.admin.pubkey(),
                config: config_address(),
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        world.send(instruction, &[]).unwrap();
        world
    }

    /// A new wallet with SOL for fees and `tokens` in its token account.
    pub fn wallet(&mut self, tokens: u64) -> Keypair {
        let keypair = Keypair::new();
        self.svm.airdrop(&keypair.pubkey(), 10 * SOL).unwrap();
        self.set_balance(&keypair.pubkey(), tokens);
        keypair
    }

    pub fn token_account(&self, owner: &Pubkey) -> Pubkey {
        get_associated_token_address(owner, &self.mint)
    }

    fn set_balance(&mut self, owner: &Pubkey, amount: u64) {
        let mut data = [0u8; spl_token::state::Account::LEN];
        spl_token::state::Account {
            mint: self.mint,
            owner: *owner,
            amount,
            delegate: COption::None,
            state: spl_token::state::AccountState::Initialized,
            is_native: COption::None,
            delegated_amount: 0,
            close_authority: COption::None,
        }
        .pack_into_slice(&mut data);
        self.svm
            .set_account(
                self.token_account(owner),
                Account {
                    lamports: SOL,
                    data: data.to_vec(),
                    owner: token::ID,
                    executable: false,
                    rent_epoch: 0,
                },
            )
            .unwrap();
    }

    /// Token balance of `owner`, or zero if they have no token account.
    pub fn balance(&self, owner: &Pubkey) -> u64 {
        self.svm
            .get_account(&self.token_account(owner))
            .filter(|account| !account.data.is_empty())
            .map(|account| {
                spl_token::state::Account::unpack(&account.data)
                    .unwrap()
                    .amount
            })
            .unwrap_or(0)
    }

    pub fn campaign(&self, address: &Pubkey) -> Campaign {
        let account = self.svm.get_account(address).unwrap();
        Campaign::try_deserialize(&mut account.data.as_slice()).unwrap()
    }

    pub fn config(&self) -> Config {
        let account = self.svm.get_account(&config_address()).unwrap();
        Config::try_deserialize(&mut account.data.as_slice()).unwrap()
    }

    pub fn exists(&self, address: &Pubkey) -> bool {
        self.svm
            .get_account(address)
            .is_some_and(|account| account.lamports > 0)
    }

    pub fn now(&self) -> i64 {
        self.svm.get_sysvar::<Clock>().unix_timestamp
    }

    pub fn wait(&mut self, seconds: i64) {
        let mut clock = self.svm.get_sysvar::<Clock>();
        clock.unix_timestamp += seconds;
        self.svm.set_sysvar::<Clock>(&clock);
    }

    /// Sends one instruction, paid for by the admin wallet, which stands in for "anyone".
    pub fn send(&mut self, instruction: Instruction, signers: &[&Keypair]) -> Result<(), String> {
        // A fresh blockhash keeps two identical instructions from being treated as a replay.
        self.svm.expire_blockhash();
        let message = Message::new_with_blockhash(
            &[instruction],
            Some(&self.admin.pubkey()),
            &self.svm.latest_blockhash(),
        );
        let mut all_signers = vec![&self.admin];
        all_signers.extend(
            signers
                .iter()
                .filter(|signer| signer.pubkey() != self.admin.pubkey()),
        );
        let transaction =
            VersionedTransaction::try_new(VersionedMessage::Legacy(message), &all_signers).unwrap();

        self.svm
            .send_transaction(transaction)
            .map(|_| ())
            .map_err(|failure| format!("{:?}\n{}", failure.err, failure.meta.logs.join("\n")))
    }

    pub fn update_config(
        &mut self,
        admin: &Keypair,
        treasury: Pubkey,
        fee_bps: u16,
    ) -> Result<(), String> {
        let instruction = Instruction::new_with_bytes(
            tanda_jadi::id(),
            &tanda_jadi::instruction::UpdateConfig { treasury, fee_bps }.data(),
            tanda_jadi::accounts::UpdateConfig {
                admin: admin.pubkey(),
                config: config_address(),
            }
            .to_account_metas(None),
        );
        self.send(instruction, &[admin])
    }

    pub fn create_campaign(
        &mut self,
        creator: &Keypair,
        args: CreateCampaignArgs,
    ) -> Result<Pubkey, String> {
        let campaign = campaign_address(&creator.pubkey(), args.id);
        let instruction = Instruction::new_with_bytes(
            tanda_jadi::id(),
            &tanda_jadi::instruction::CreateCampaign { args }.data(),
            tanda_jadi::accounts::CreateCampaign {
                creator: creator.pubkey(),
                config: config_address(),
                mint: self.mint,
                campaign,
                vault: self.token_account(&campaign),
                creator_token: self.token_account(&creator.pubkey()),
                token_program: token::ID,
                associated_token_program: associated_token::ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        self.send(instruction, &[creator]).map(|_| campaign)
    }

    pub fn pledge(&mut self, campaign: &Pubkey, backer: &Keypair) -> Result<(), String> {
        let instruction = Instruction::new_with_bytes(
            tanda_jadi::id(),
            &tanda_jadi::instruction::Pledge {}.data(),
            tanda_jadi::accounts::MakePledge {
                backer: backer.pubkey(),
                campaign: *campaign,
                mint: self.mint,
                vault: self.token_account(campaign),
                backer_token: self.token_account(&backer.pubkey()),
                pledge: pledge_address(campaign, &backer.pubkey()),
                token_program: token::ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        self.send(instruction, &[backer])
    }

    /// Creates `count` wallets holding exactly one pledge's worth and pledges with each, in order.
    pub fn backers(&mut self, campaign: &Pubkey, count: usize) -> Vec<Keypair> {
        let price = self.campaign(campaign).price;
        (0..count)
            .map(|_| {
                let backer = self.wallet(price);
                self.pledge(campaign, &backer).unwrap();
                backer
            })
            .collect()
    }

    /// Sent without the backer's signature, the way a bot would.
    pub fn claim_refund(&mut self, campaign: &Pubkey, backer: &Pubkey) -> Result<(), String> {
        let backer_token = self.token_account(backer);
        self.claim_refund_into(campaign, backer, &backer_token)
    }

    pub fn claim_refund_into(
        &mut self,
        campaign: &Pubkey,
        backer: &Pubkey,
        backer_token: &Pubkey,
    ) -> Result<(), String> {
        let instruction = Instruction::new_with_bytes(
            tanda_jadi::id(),
            &tanda_jadi::instruction::ClaimRefund {}.data(),
            tanda_jadi::accounts::ClaimRefund {
                campaign: *campaign,
                pledge: pledge_address(campaign, backer),
                backer: *backer,
                mint: self.mint,
                vault: self.token_account(campaign),
                backer_token: *backer_token,
                token_program: token::ID,
            }
            .to_account_metas(None),
        );
        self.send(instruction, &[])
    }

    /// Sent without the creator's signature. The destination is always the creator's own account.
    pub fn withdraw(&mut self, campaign: &Pubkey) -> Result<(), String> {
        let creator = self.campaign(campaign).creator;
        let creator_token = self.token_account(&creator);
        self.withdraw_into(campaign, &creator_token)
    }

    pub fn withdraw_into(
        &mut self,
        campaign: &Pubkey,
        creator_token: &Pubkey,
    ) -> Result<(), String> {
        let instruction = Instruction::new_with_bytes(
            tanda_jadi::id(),
            &tanda_jadi::instruction::Withdraw {}.data(),
            tanda_jadi::accounts::Withdraw {
                campaign: *campaign,
                mint: self.mint,
                vault: self.token_account(campaign),
                creator_token: *creator_token,
                token_program: token::ID,
            }
            .to_account_metas(None),
        );
        self.send(instruction, &[])
    }

    pub fn collect_fee(&mut self, campaign: &Pubkey) -> Result<(), String> {
        let treasury = self.config().treasury;
        let instruction = Instruction::new_with_bytes(
            tanda_jadi::id(),
            &tanda_jadi::instruction::CollectFee {}.data(),
            tanda_jadi::accounts::CollectFee {
                config: config_address(),
                campaign: *campaign,
                mint: self.mint,
                vault: self.token_account(campaign),
                treasury_token: self.token_account(&treasury),
                token_program: token::ID,
            }
            .to_account_metas(None),
        );
        self.send(instruction, &[])
    }

    pub fn set_brake(
        &mut self,
        campaign: &Pubkey,
        backer: &Keypair,
        on: bool,
    ) -> Result<(), String> {
        let instruction = Instruction::new_with_bytes(
            tanda_jadi::id(),
            &tanda_jadi::instruction::SetBrake { on }.data(),
            tanda_jadi::accounts::SetBrake {
                backer: backer.pubkey(),
                campaign: *campaign,
                pledge: pledge_address(campaign, &backer.pubkey()),
            }
            .to_account_metas(None),
        );
        self.send(instruction, &[backer])
    }
}

pub fn listing_address(campaign: &Pubkey, seller: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[
            tanda_jadi::constants::LISTING_SEED,
            campaign.as_ref(),
            seller.as_ref(),
        ],
        &tanda_jadi::id(),
    )
    .0
}

pub fn market_address(campaign: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[tanda_jadi::constants::MARKET_SEED, campaign.as_ref()],
        &tanda_jadi::id(),
    )
    .0
}

/// The seat market.
impl World {
    pub fn market(&self, campaign: &Pubkey) -> tanda_jadi::state::Market {
        let account = self.svm.get_account(&market_address(campaign)).unwrap();
        tanda_jadi::state::Market::try_deserialize(&mut account.data.as_slice()).unwrap()
    }

    pub fn pledge_of(&self, campaign: &Pubkey, holder: &Pubkey) -> tanda_jadi::state::Pledge {
        let account = self
            .svm
            .get_account(&pledge_address(campaign, holder))
            .unwrap();
        tanda_jadi::state::Pledge::try_deserialize(&mut account.data.as_slice()).unwrap()
    }

    pub fn list_seat(
        &mut self,
        campaign: &Pubkey,
        seller: &Keypair,
        ask: u64,
    ) -> Result<(), String> {
        let instruction = Instruction::new_with_bytes(
            tanda_jadi::id(),
            &tanda_jadi::instruction::ListSeat { ask }.data(),
            tanda_jadi::accounts::ListSeat {
                seller: seller.pubkey(),
                campaign: *campaign,
                pledge: pledge_address(campaign, &seller.pubkey()),
                listing: listing_address(campaign, &seller.pubkey()),
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        self.send(instruction, &[seller])
    }

    pub fn unlist_seat(&mut self, campaign: &Pubkey, seller: &Keypair) -> Result<(), String> {
        let listing = listing_address(campaign, &seller.pubkey());
        self.unlist(&listing, seller)
    }

    /// Takes down `listing` with `signer` named as its seller, whoever really made it.
    pub fn unlist(&mut self, listing: &Pubkey, signer: &Keypair) -> Result<(), String> {
        let instruction = Instruction::new_with_bytes(
            tanda_jadi::id(),
            &tanda_jadi::instruction::UnlistSeat {}.data(),
            tanda_jadi::accounts::UnlistSeat {
                seller: signer.pubkey(),
                listing: *listing,
            }
            .to_account_metas(None),
        );
        self.send(instruction, &[signer])
    }

    pub fn buy_seat(
        &mut self,
        campaign: &Pubkey,
        seller: &Pubkey,
        buyer: &Keypair,
        max_price: u64,
    ) -> Result<(), String> {
        let market = market_address(campaign);
        self.buy_seat_recording_in(campaign, seller, buyer, max_price, &market)
    }

    /// Buys a seat while naming `market` as the account the sale is recorded in.
    pub fn buy_seat_recording_in(
        &mut self,
        campaign: &Pubkey,
        seller: &Pubkey,
        buyer: &Keypair,
        max_price: u64,
        market: &Pubkey,
    ) -> Result<(), String> {
        let instruction = Instruction::new_with_bytes(
            tanda_jadi::id(),
            &tanda_jadi::instruction::BuySeat { max_price }.data(),
            tanda_jadi::accounts::BuySeat {
                buyer: buyer.pubkey(),
                campaign: *campaign,
                mint: self.mint,
                seller: *seller,
                listing: listing_address(campaign, seller),
                seller_pledge: pledge_address(campaign, seller),
                buyer_pledge: pledge_address(campaign, &buyer.pubkey()),
                market: *market,
                buyer_token: self.token_account(&buyer.pubkey()),
                seller_token: self.token_account(seller),
                token_program: token::ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        self.send(instruction, &[buyer])
    }
}
