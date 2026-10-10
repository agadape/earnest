use anchor_lang::prelude::*;

#[error_code]
pub enum TandaJadiError {
    #[msg("Only the config admin can do this")]
    Unauthorized,
    #[msg("Fee is above the maximum")]
    FeeTooHigh,
    #[msg("Price must be greater than zero")]
    InvalidPrice,
    #[msg("Target must be at least one backer")]
    InvalidTarget,
    #[msg("Early slots must be between one and the target")]
    InvalidEarlySlots,
    #[msg("Bonus per early backer must be greater than zero")]
    InvalidBonus,
    #[msg("Duration is zero or above the maximum")]
    InvalidDuration,
    #[msg("Upfront share is above the maximum")]
    UpfrontTooHigh,
    #[msg("Title or URI is too long")]
    TextTooLong,
    #[msg("Amount does not fit in 64 bits")]
    MathOverflow,
    #[msg("Campaign is not accepting pledges")]
    NotFunding,
    #[msg("Brakes only apply while the campaign is being built")]
    NotBuilding,
    #[msg("Brake is already in that position")]
    BrakeUnchanged,
    #[msg("Refunds are only paid when a campaign failed or was braked")]
    NotRefundable,
    #[msg("Nothing to withdraw yet")]
    NothingToWithdraw,
    #[msg("Fee is only due once a campaign reached its target")]
    FeeNotDue,
    #[msg("Fee was already collected")]
    FeeAlreadyCollected,
    #[msg("Seats can only change hands before the deadline or while the campaign is being built")]
    NotTradable,
    #[msg("The asking price must be greater than zero")]
    InvalidAsk,
    #[msg("The seat now costs more than the buyer agreed to pay")]
    AskTooHigh,
    #[msg("An update needs some text")]
    EmptyUpdate,
    #[msg("An update can be at most 200 bytes long")]
    UpdateTooLong,
}
