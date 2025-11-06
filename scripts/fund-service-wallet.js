#!/usr/bin/env node
/**
 * Helper script to display service wallet information for funding
 */

require('dotenv').config();
const { getServiceWallet } = require('../src/config/serviceWallet');
const { Connection, LAMPORTS_PER_SOL } = require('@solana/web3.js');

async function displayWalletInfo() {
  console.log('💰 Service Wallet Funding Information\n');
  
  try {
    const serviceWallet = getServiceWallet();
    const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
    
    console.log('📧 Service Wallet Address:', serviceWallet.publicKey.toString());
    console.log('🌐 Network: Devnet');
    console.log('🚰 Faucet URL: https://faucet.solana.com');
    
    try {
      const balance = await connection.getBalance(serviceWallet.publicKey);
      const solBalance = balance / LAMPORTS_PER_SOL;
      console.log('💰 Current Balance:', solBalance.toFixed(6), 'SOL');
      
      if (balance < 10000000) { // Less than 0.01 SOL
        console.log('\n⚠️  Status: NEEDS FUNDING');
        console.log('💡 Minimum recommended: 0.01 SOL for transaction fees');
      } else {
        console.log('\n✅ Status: FUNDED');
        console.log('✨ Ready for auto-finalization transactions');
      }
    } catch (balanceError) {
      console.log('⚠️  Could not check balance:', balanceError.message);
    }
    
    console.log('\n📝 Instructions:');
    console.log('1. Visit https://faucet.solana.com');
    console.log('2. Paste the wallet address above');
    console.log('3. Request devnet SOL (usually 1-2 SOL)');
    console.log('4. Wait for the transaction to confirm');
    console.log('5. Restart the backend server');
    
    console.log('\n🔧 For production, set SERVICE_WALLET_PRIVATE_KEY environment variable');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

displayWalletInfo();