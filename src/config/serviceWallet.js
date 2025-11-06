/**
 * Service Wallet Configuration
 * Manages the backend service wallet used for auto-finalization
 */

const { Keypair } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

const SERVICE_WALLET_PATH = path.join(__dirname, '../../service-wallet.json');

/**
 * Load or create service wallet
 * Priority: 1) Environment variable, 2) File, 3) Generate new
 */
function getServiceWallet() {
  try {
    // 1. Try to load from environment variable
    if (process.env.SERVICE_WALLET_PRIVATE_KEY) {
      const privateKeyArray = JSON.parse(process.env.SERVICE_WALLET_PRIVATE_KEY);
      if (Array.isArray(privateKeyArray) && privateKeyArray.length === 64) {
        console.log('🔑 Service wallet loaded from environment variable');
        return Keypair.fromSecretKey(new Uint8Array(privateKeyArray));
      }
    }

    // 2. Try to load from file
    if (fs.existsSync(SERVICE_WALLET_PATH)) {
      const fileContent = fs.readFileSync(SERVICE_WALLET_PATH, 'utf8');
      const privateKeyArray = JSON.parse(fileContent);
      if (Array.isArray(privateKeyArray) && privateKeyArray.length === 64) {
        console.log('🔑 Service wallet loaded from file');
        return Keypair.fromSecretKey(new Uint8Array(privateKeyArray));
      }
    }

    // 3. Generate new wallet and save to file
    console.log('🔑 Generating new service wallet...');
    const newWallet = Keypair.generate();
    
    // Save to file for persistence
    const privateKeyArray = Array.from(newWallet.secretKey);
    fs.writeFileSync(SERVICE_WALLET_PATH, JSON.stringify(privateKeyArray, null, 2));
    
    console.log('📁 Service wallet saved to:', SERVICE_WALLET_PATH);
    console.log('🔑 Service wallet public key:', newWallet.publicKey.toString());
    console.log('');
    console.log('⚠️  IMPORTANT: Fund this wallet with devnet SOL for auto-finalization to work');
    console.log('💰 Get devnet SOL from: https://faucet.solana.com');
    console.log('📧 Wallet address:', newWallet.publicKey.toString());
    console.log('');
    console.log('💡 To use the same wallet in production, set SERVICE_WALLET_PRIVATE_KEY environment variable:');
    console.log(`   SERVICE_WALLET_PRIVATE_KEY='${JSON.stringify(privateKeyArray)}'`);
    
    return newWallet;

  } catch (error) {
    console.error('❌ Error loading/creating service wallet:', error);
    // Fallback to generated wallet
    const fallbackWallet = Keypair.generate();
    console.log('🔄 Using fallback generated wallet (not persistent)');
    return fallbackWallet;
  }
}

module.exports = {
  getServiceWallet
};