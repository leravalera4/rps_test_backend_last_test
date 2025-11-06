/**
 * Platform Wallet Configuration
 * 
 * This file defines the platform wallet address for collecting fees from SOL games.
 * 
 * IMPORTANT: Replace the placeholder address below with your actual platform wallet address
 * before deploying to production.
 */

const { PublicKey } = require('@solana/web3.js');

// Platform wallet address - Replace with your actual wallet address
// Current address is a placeholder (System Program address)
const PLATFORM_WALLET_ADDRESS = '6ayLUKjR2HUahBoRLeRKVkE6bLtUhRA9eNX7LoRFgzDt';

// Export platform wallet public key
const PLATFORM_WALLET = new PublicKey(PLATFORM_WALLET_ADDRESS);

module.exports = {
  PLATFORM_WALLET,
  PLATFORM_WALLET_ADDRESS
};
