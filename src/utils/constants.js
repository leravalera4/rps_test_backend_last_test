/**
 * Constants for RPS MagicBlock Game
 */

// Game constants
const VALID_MOVES = ['rock', 'paper', 'scissors'];
const WINNING_SCORE = 3; // First to 3 wins (best of 5)
const PLATFORM_FEE_PERCENTAGE = 0.05; // 5% fee
const WINNER_PAYOUT_PERCENTAGE = 0.95; // 95% to winner

// SOL escrow constants
const SOL_LAMPORTS = 1000000000; // 1 SOL = 10^9 lamports
const MIN_SOL_STAKE = 0.01; // Minimum SOL stake
const MAX_SOL_STAKE = 10; // Maximum SOL stake

// MagicBlock constants
const MAGICBLOCK_DEVNET_URL = 'https://devnet.magicblock.app';
const MAGICBLOCK_ROUTER_URL = 'https://devnet-rpc.magicblock.app';

module.exports = {
  VALID_MOVES,
  WINNING_SCORE,
  PLATFORM_FEE_PERCENTAGE,
  WINNER_PAYOUT_PERCENTAGE,
  SOL_LAMPORTS,
  MIN_SOL_STAKE,
  MAX_SOL_STAKE,
  MAGICBLOCK_DEVNET_URL,
  MAGICBLOCK_ROUTER_URL
}; 