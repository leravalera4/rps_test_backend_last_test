/**
 * Auto-Finalization Service for SOL Games
 * 
 * MODERN STANDARD: Automatically handles winner payouts when SOL games complete
 * - Winner receives proper winnings (stake * 2 * 0.95) automatically  
 * - Zero popups for users (backend handles smart contract calls)
 * - Follows standard blockchain gaming UX patterns
 */

require('dotenv').config();

const { Connection, PublicKey, SystemProgram, LAMPORTS_PER_SOL, Transaction, TransactionInstruction } = require('@solana/web3.js');
const anchor = require('@coral-xyz/anchor');
const fs = require('fs');
const path = require('path');
const { getServiceWallet } = require('../config/serviceWallet');
const { PLATFORM_WALLET } = require('../config/platformWallet');
const ReferralService = require('./referralService');

// Load IDL and program ID
const idlPath = path.join(__dirname, '../../idl/rps_game.json');
const idlJson = JSON.parse(fs.readFileSync(idlPath, 'utf8'));
const PROGRAM_ID = new PublicKey('GstXQkBpu26KABj6YZ3pYKJhQphoQ72YL1zL38NC6D9U');

// Solana connection - use environment variable or fallback to devnet
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const connection = new Connection(SOLANA_RPC_URL, 'confirmed');
console.log(`🔗 Solana RPC URL: ${SOLANA_RPC_URL}`);

// Service wallet - loaded from persistent configuration
let serviceWallet = null;

// Referral service instance (lazy initialization)
let referralService = null;

/**
 * Initialize the auto-finalization service
 */
async function initializeService() {
  try {
    // Load persistent service wallet
    serviceWallet = getServiceWallet();
    console.log('✅ Auto-finalization service initialized');
    console.log('🔑 Service wallet:', serviceWallet.publicKey.toString());
    console.log('🔗 RPC URL:', SOLANA_RPC_URL);
    
    // Verify wallet source
    if (process.env.SERVICE_WALLET_PRIVATE_KEY) {
      console.log('📝 Service wallet loaded from: ENVIRONMENT VARIABLE');
    } else {
      console.log('📝 Service wallet loaded from: FILE (service-wallet.json)');
      console.log('⚠️  WARNING: For production, use SERVICE_WALLET_PRIVATE_KEY environment variable!');
    }
    
    // Check if service wallet is funded
    try {
      const balance = await connection.getBalance(serviceWallet.publicKey);
      const solBalance = balance / LAMPORTS_PER_SOL;
      console.log('💰 Service wallet balance:', solBalance.toFixed(3), 'SOL');
      
      if (balance < 10000000) { // Less than 0.01 SOL
        console.error('❌ CRITICAL: Service wallet needs funding for transactions!');
        console.error('   Current balance:', solBalance.toFixed(3), 'SOL');
        console.error('   Minimum required: 0.01 SOL');
        console.error('   Wallet address:', serviceWallet.publicKey.toString());
        console.error('   Get devnet SOL from: https://faucet.solana.com');
        console.error('   This will cause auto-finalization to FAIL in production!');
      } else {
        console.log('✅ Service wallet is funded and ready');
      }
    } catch (balanceError) {
      console.error('❌ Could not check service wallet balance:', balanceError.message);
      console.error('   This may indicate RPC connection issues');
      console.error('   Check SOLANA_RPC_URL environment variable');
    }
    
    return true;
  } catch (error) {
    console.error('❌ Failed to initialize auto-finalization service:', error);
    console.error('   Error details:', error.message);
    console.error('   Stack:', error.stack);
    return false;
  }
}


/**
 * Find PDA for game account
 */
function findGamePDA(gameId) {
  // Truncate gameId to fit Solana PDA seed requirements (max 32 bytes per seed)
  // Remove dashes and trim to 32 chars (same logic as gameManager.createGame)
  let truncatedGameId = gameId.replace(/-/g, '').substring(0, 32);
  console.log(`🔍 Finding PDA for gameId: "${gameId}" -> truncated: "${truncatedGameId}"`);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('game'), Buffer.from(truncatedGameId, 'utf8')],
    PROGRAM_ID
  )[0];
}

/**
 * Find PDA for user profile
 */
function findUserProfilePDA(userPublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('user_profile'), userPublicKey.toBuffer()],
    PROGRAM_ID
  )[0];
}

/**
 * Automatically finalize a SOL game and distribute winnings
 * 
 * @param {string} gameId - The game ID to finalize
 * @param {string} winnerPublicKey - Winner's wallet address  
 * @param {string} loserPublicKey - Loser's wallet address
 * @param {number} stakeAmount - Original stake amount in SOL
 * @returns {Promise<boolean>} Success status
 */
async function autoFinalizeSolGame(gameId, winnerPublicKey, loserPublicKey, stakeAmount) {
  console.log('🚀 ===== STARTING AUTO-FINALIZATION =====');
  console.log('📋 Game ID:', gameId);
  console.log('🏆 Winner:', winnerPublicKey);
  console.log('💸 Stake:', stakeAmount, 'SOL');
  console.log('⏰ Timestamp:', new Date().toISOString());
  console.log('🔗 RPC URL:', SOLANA_RPC_URL);
  
  try {
    // Ensure service wallet is initialized
    if (!serviceWallet) {
      console.log('⚠️ Service wallet not initialized, attempting to initialize...');
      serviceWallet = getServiceWallet();
      if (!serviceWallet) {
        throw new Error('Service wallet not initialized and could not be created');
      }
      console.log('✅ Service wallet initialized:', serviceWallet.publicKey.toString());
    }
    
    // Verify service wallet has balance
    try {
      const balance = await connection.getBalance(serviceWallet.publicKey);
      const solBalance = balance / LAMPORTS_PER_SOL;
      console.log(`💰 Service wallet balance: ${solBalance.toFixed(3)} SOL`);
      
      if (balance < 10000000) { // Less than 0.01 SOL
        console.error('❌ Service wallet has insufficient balance for transactions');
        console.error(`   Current balance: ${solBalance.toFixed(3)} SOL`);
        console.error(`   Required: at least 0.01 SOL`);
        console.error(`   Wallet address: ${serviceWallet.publicKey.toString()}`);
        throw new Error(`Service wallet has insufficient balance: ${solBalance.toFixed(3)} SOL`);
      }
    } catch (balanceError) {
      console.error('❌ Failed to check service wallet balance:', balanceError.message);
      throw balanceError;
    }

    // Create Anchor provider and program
    const wallet = {
      publicKey: serviceWallet.publicKey,
      signTransaction: async (tx) => {
        tx.partialSign(serviceWallet);
        return tx;
      },
      signAllTransactions: async (txs) => {
        txs.forEach(tx => tx.partialSign(serviceWallet));
        return txs;
      }
    };

    const provider = new anchor.AnchorProvider(connection, wallet, { 
      commitment: 'confirmed',
      preflightCommitment: 'confirmed'
    });
    
    // Create Anchor program instance for method calls
    const idlWithAddress = { ...idlJson, address: PROGRAM_ID.toString() };
    const program = new anchor.Program(idlWithAddress, provider);
    console.log('✅ Anchor program created for auto-finalization');

    // Get PDAs
    const gamePDA = findGamePDA(gameId);

    console.log('🎯 Game PDA:', gamePDA.toString());

    // Check if game account exists and get the actual player addresses
    let gameAccount = await connection.getAccountInfo(gamePDA);
    if (!gameAccount) {
      const error = 'Game account not found on-chain. SOL games must be created through smart contract with escrow.';
      console.error('❌', error);
      throw new Error(error);
    }
    
    // We need to read the game account to get player1 and player2 addresses
    // Skip the discriminator (8 bytes) and parse the struct manually
    const gameData = gameAccount.data;
    
    // Game struct layout (simplified parsing - just get player addresses):
    // - discriminator: 8 bytes
    // - game_id (string): 4 bytes length + string data  
    // - player1: 32 bytes (pubkey)
    // - player2: 1 byte (option tag) + 32 bytes (pubkey)
    
    let offset = 8; // Skip discriminator
    
    // Skip game_id string (4-byte length + string data)
    const gameIdLength = gameData.readUInt32LE(offset);
    offset += 4 + gameIdLength;
    
    // Read player1 (32 bytes)
    const player1Bytes = gameData.slice(offset, offset + 32);
    const player1Key = new PublicKey(player1Bytes);
    offset += 32;
    
    // Read player2 option (1 byte tag + 32 bytes if Some)
    const player2OptionTag = gameData[offset];
    offset += 1;
    let player2Key;
    if (player2OptionTag === 1) { // Some
      const player2Bytes = gameData.slice(offset, offset + 32);
      player2Key = new PublicKey(player2Bytes);
    } else {
      throw new Error('Game has no player2 - cannot finalize');
    }
    
    console.log('Game players from on-chain data:');
    console.log('Player1:', player1Key.toString());
    console.log('Player2:', player2Key.toString());
    
    // Also parse the game status to see current state
    // Continue parsing from where we left off after player2
    offset += 32; // Skip player2 pubkey
    
    // Skip the move commitments and revealed moves (complex parsing, skip for now)
    // Jump to approximate position of game_status and winner
    
    // For debugging, let's see what the raw bytes look like around where status should be
    console.log('Game account data length:', gameData.length);
    console.log('Current offset after players:', offset);
    
    // Calculate PDAs using the ACTUAL players from the game account
    const player1ProfilePDA = findUserProfilePDA(player1Key);
    const player2ProfilePDA = findUserProfilePDA(player2Key);
    
    console.log('Player1 Profile PDA:', player1ProfilePDA.toString());
    console.log('Player2 Profile PDA:', player2ProfilePDA.toString());

    // Use Anchor's set_winner method (updated function name from IDL)
    console.log('Setting game winner on-chain using set_winner instruction...');
    
    const actualWinnerPubkey = new PublicKey(winnerPublicKey);
    
    // LOG BALANCES BEFORE set_winner
    console.log('💰 ===== BALANCE LOGGING (set_winner) =====');
    const balancesBeforeSetWinner = {
      service: await connection.getBalance(serviceWallet.publicKey),
      gamePDA: await connection.getBalance(gamePDA)
    };
    console.log(`  Service Wallet BEFORE set_winner: ${(balancesBeforeSetWinner.service / LAMPORTS_PER_SOL).toFixed(9)} SOL`);
    console.log(`  Game PDA BEFORE set_winner: ${(balancesBeforeSetWinner.gamePDA / LAMPORTS_PER_SOL).toFixed(9)} SOL`);
    
    // Use Anchor program API to call set_winner
    try {
      const setWinnerSig = await program.methods
        .setWinner(gameId, actualWinnerPubkey)
        .accounts({
          game: gamePDA,
          user: serviceWallet.publicKey,
          systemProgram: SystemProgram.programId
        })
        .signers([serviceWallet])
        .rpc();
      console.log('Game winner set on-chain:', setWinnerSig);
      console.log('Winner:', winnerPublicKey);
      console.log('Game status: Finished');
      
      // LOG BALANCES AFTER set_winner
      const balancesAfterSetWinner = {
        service: await connection.getBalance(serviceWallet.publicKey),
        gamePDA: await connection.getBalance(gamePDA)
      };
      console.log(`  Service Wallet AFTER set_winner: ${(balancesAfterSetWinner.service / LAMPORTS_PER_SOL).toFixed(9)} SOL (delta: ${((balancesAfterSetWinner.service - balancesBeforeSetWinner.service) / LAMPORTS_PER_SOL).toFixed(9)} SOL)`);
      console.log(`  Game PDA AFTER set_winner: ${(balancesAfterSetWinner.gamePDA / LAMPORTS_PER_SOL).toFixed(9)} SOL (delta: ${((balancesAfterSetWinner.gamePDA - balancesBeforeSetWinner.gamePDA) / LAMPORTS_PER_SOL).toFixed(9)} SOL)`);
      
      // LOG TRANSACTION FEE
      try {
        const txInfo = await connection.getTransaction(setWinnerSig, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0
        });
        if (txInfo && txInfo.meta) {
          const feeLamports = txInfo.meta.fee || 0;
          console.log(`🧾 [set_winner] Transaction fee: ${(feeLamports / LAMPORTS_PER_SOL).toFixed(9)} SOL (${feeLamports} lamports)`);
        }
      } catch (feeError) {
        console.log('Could not fetch set_winner transaction fee:', feeError.message);
      }
      
      // Let's verify what was actually stored in the game account
      const gameAccountAfter = await connection.getAccountInfo(gamePDA);
      if (gameAccountAfter) {
        // Parse the winner from the game account to verify it was set correctly
        const gameDataAfter = gameAccountAfter.data;
        
        // Skip to winner field (after discriminator, game_id, player1, player2, commitments, moves, stake, currency, status)
        // This is a rough approximation - the exact offset depends on string lengths
        // But let's just verify what we can
        console.log('Game account size after setting winner:', gameDataAfter.length);
      }
      
    } catch (setWinnerError) {
      console.log('Failed to set winner:', setWinnerError.message);
      throw setWinnerError;
    }
    
    
    // finalize_game instruction discriminator from IDL
    const FINALIZE_GAME_DISCRIMINATOR = [203, 227, 3, 167, 186, 102, 76, 10];
    
    // Create instruction data (discriminator + game_id string)
    const gameIdBuffer = Buffer.from(gameId, 'utf8');
    const gameIdLengthBuffer = Buffer.alloc(4);
    gameIdLengthBuffer.writeUInt32LE(gameIdBuffer.length, 0);
    
    const instructionData = Buffer.concat([
      Buffer.from(FINALIZE_GAME_DISCRIMINATOR),
      gameIdLengthBuffer,
      gameIdBuffer
    ]);
    
    // Get winner's profile to check for referrer
    const winnerKey = new PublicKey(winnerPublicKey);
    const winnerProfilePDA = findUserProfilePDA(winnerKey);
    
    let referrerWallet = PLATFORM_WALLET; // Default to platform wallet
    let referrerProfilePDA = player1ProfilePDA; // Default to any profile
    let hasReferrer = false;
    
    try {
      const winnerProfileAccount = await connection.getAccountInfo(winnerProfilePDA);
      if (winnerProfileAccount) {
        const profileData = winnerProfileAccount.data;
        // Skip discriminator (8 bytes) + points_balance (8) + wins (4) + losses (4) + total_games (4) + total_points_earned (8)
        let offset = 8 + 8 + 4 + 4 + 4 + 8;
        
        // Skip referral_code ([u8; 8] - 8 bytes)
        offset += 8;
        
        // Read referred_by (Option<Pubkey> - 1 byte tag + 32 bytes if Some)
        const referredByTag = profileData[offset];
        offset += 1;
        
        if (referredByTag === 1) { // Some - winner has a referrer
          const referrerBytes = profileData.slice(offset, offset + 32);
          referrerWallet = new PublicKey(referrerBytes);
          referrerProfilePDA = findUserProfilePDA(referrerWallet);
          hasReferrer = true;
          console.log('Winner has referrer:', referrerWallet.toString());
        } else {
          console.log('Winner has no referrer, using platform wallet as default');
          hasReferrer = false;
        }
      }
    } catch (error) {
      console.log('Failed to read winner profile, using defaults:', error.message);
    }

    // Keep accounts in the same order as stored in the game
    // The smart contract will automatically transfer to the right player based on the winner
    console.log('Account ordering (matching game storage):');
    console.log('Player1 from game:', player1Key.toString());
    console.log('Player2 from game:', player2Key.toString());
    console.log('Winner should be:', winnerPublicKey);
    console.log('Platform wallet:', PLATFORM_WALLET.toString());
    console.log('Referrer wallet:', referrerWallet.toString());
    console.log('Referrer profile:', referrerProfilePDA.toString());
    console.log('Winner has referrer:', hasReferrer);
    
    // Create the instruction using the same order as in the game account
    // Use actual referrer if winner has one, otherwise use platform wallet
    const finalizeInstruction = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: gamePDA, isSigner: false, isWritable: true },
        { pubkey: player1ProfilePDA, isSigner: false, isWritable: true }, // player1_profile
        { pubkey: player2ProfilePDA, isSigner: false, isWritable: true }, // player2_profile  
        { pubkey: player1Key, isSigner: false, isWritable: true },        // player1
        { pubkey: player2Key, isSigner: false, isWritable: true },        // player2
        { pubkey: PLATFORM_WALLET, isSigner: false, isWritable: true },   // platform_wallet
        { pubkey: referrerWallet, isSigner: false, isWritable: true },    // referrer (actual referrer or platform wallet)
        { pubkey: referrerProfilePDA, isSigner: false, isWritable: true }, // referrer_profile (actual referrer profile or default)
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
      ],
      data: instructionData
    });
    
    // LOG BALANCES BEFORE FINALIZATION
    console.log('💰 ===== BALANCE LOGGING =====');
    const balancesBefore = {
      winner: await connection.getBalance(new PublicKey(winnerPublicKey)),
      player1: await connection.getBalance(player1Key),
      player2: await connection.getBalance(player2Key),
      platform: await connection.getBalance(PLATFORM_WALLET),
      referrer: await connection.getBalance(referrerWallet),
      gamePDA: await connection.getBalance(gamePDA),
      service: await connection.getBalance(serviceWallet.publicKey)
    };
    console.log('📊 Balances BEFORE finalize_game:');
    console.log(`  Winner (${winnerPublicKey}): ${(balancesBefore.winner / LAMPORTS_PER_SOL).toFixed(9)} SOL`);
    console.log(`  Player1 (${player1Key.toString()}): ${(balancesBefore.player1 / LAMPORTS_PER_SOL).toFixed(9)} SOL`);
    console.log(`  Player2 (${player2Key.toString()}): ${(balancesBefore.player2 / LAMPORTS_PER_SOL).toFixed(9)} SOL`);
    console.log(`  Platform: ${(balancesBefore.platform / LAMPORTS_PER_SOL).toFixed(9)} SOL`);
    console.log(`  Referrer: ${(balancesBefore.referrer / LAMPORTS_PER_SOL).toFixed(9)} SOL`);
    console.log(`  Game PDA: ${(balancesBefore.gamePDA / LAMPORTS_PER_SOL).toFixed(9)} SOL`);
    console.log(`  Service Wallet: ${(balancesBefore.service / LAMPORTS_PER_SOL).toFixed(9)} SOL`);
    
    // Create and send transaction
    const transaction = new Transaction().add(finalizeInstruction);
    
    console.log('📤 Sending finalization transaction...');
    console.log('📋 Transaction details:', {
      gameId,
      gamePDA: gamePDA.toString(),
      winner: winnerPublicKey,
      serviceWallet: serviceWallet.publicKey.toString()
    });
    
    try {
      const finalizeSig = await provider.sendAndConfirm(transaction, [], {
        commitment: 'confirmed',
        skipPreflight: false
      });
      console.log('✅ Game finalized successfully!');
      console.log('✅ Transaction signature:', finalizeSig);
    } catch (txError) {
      console.error('❌ Transaction failed:', txError);
      console.error('❌ Error details:', {
        message: txError.message,
        logs: txError.logs,
        stack: txError.stack
      });
      throw txError;
    }
    
    // LOG BALANCES AFTER FINALIZATION
    const balancesAfter = {
      winner: await connection.getBalance(new PublicKey(winnerPublicKey)),
      player1: await connection.getBalance(player1Key),
      player2: await connection.getBalance(player2Key),
      platform: await connection.getBalance(PLATFORM_WALLET),
      referrer: await connection.getBalance(referrerWallet),
      gamePDA: await connection.getBalance(gamePDA),
      service: await connection.getBalance(serviceWallet.publicKey)
    };
    
    console.log('📊 Balances AFTER finalize_game:');
    console.log(`  Winner (${winnerPublicKey}): ${(balancesAfter.winner / LAMPORTS_PER_SOL).toFixed(9)} SOL (delta: ${((balancesAfter.winner - balancesBefore.winner) / LAMPORTS_PER_SOL).toFixed(9)} SOL)`);
    console.log(`  Player1 (${player1Key.toString()}): ${(balancesAfter.player1 / LAMPORTS_PER_SOL).toFixed(9)} SOL (delta: ${((balancesAfter.player1 - balancesBefore.player1) / LAMPORTS_PER_SOL).toFixed(9)} SOL)`);
    console.log(`  Player2 (${player2Key.toString()}): ${(balancesAfter.player2 / LAMPORTS_PER_SOL).toFixed(9)} SOL (delta: ${((balancesAfter.player2 - balancesBefore.player2) / LAMPORTS_PER_SOL).toFixed(9)} SOL)`);
    console.log(`  Platform: ${(balancesAfter.platform / LAMPORTS_PER_SOL).toFixed(9)} SOL (delta: ${((balancesAfter.platform - balancesBefore.platform) / LAMPORTS_PER_SOL).toFixed(9)} SOL)`);
    console.log(`  Referrer: ${(balancesAfter.referrer / LAMPORTS_PER_SOL).toFixed(9)} SOL (delta: ${((balancesAfter.referrer - balancesBefore.referrer) / LAMPORTS_PER_SOL).toFixed(9)} SOL)`);
    console.log(`  Game PDA: ${(balancesAfter.gamePDA / LAMPORTS_PER_SOL).toFixed(9)} SOL (delta: ${((balancesAfter.gamePDA - balancesBefore.gamePDA) / LAMPORTS_PER_SOL).toFixed(9)} SOL)`);
    console.log(`  Service Wallet: ${(balancesAfter.service / LAMPORTS_PER_SOL).toFixed(9)} SOL (delta: ${((balancesAfter.service - balancesBefore.service) / LAMPORTS_PER_SOL).toFixed(9)} SOL)`);
    
    // LOG TRANSACTION FEE FROM TRANSACTION METADATA
    try {
      const txInfo = await connection.getTransaction(finalizeSig, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0
      });
      if (txInfo && txInfo.meta) {
        const feeLamports = txInfo.meta.fee || 0;
        console.log(`🧾 [finalize_game] Transaction fee: ${(feeLamports / LAMPORTS_PER_SOL).toFixed(9)} SOL (${feeLamports} lamports)`);
        console.log('💰 ===== END BALANCE LOGGING =====');
      }
    } catch (feeError) {
      console.log('Could not fetch transaction fee:', feeError.message);
    }

    // Calculate expected amounts based on stake
    const totalPot = stakeAmount * 2;
    const feeRate = stakeAmount <= 0.01 ? 0.05 : stakeAmount <= 0.05 ? 0.03 : 0.02;
    const platformFee = totalPot * feeRate;
    const expectedWinnings = totalPot - platformFee;
    
    console.log('Auto-finalization complete');
    console.log(`Total pot: ${totalPot.toFixed(3)} SOL`);
    console.log(`Platform fee (${(feeRate * 100).toFixed(1)}%): ${platformFee.toFixed(3)} SOL`);
    console.log(`Winner receives: ${expectedWinnings.toFixed(3)} SOL`);
    console.log(`Platform wallet receives: ${platformFee.toFixed(3)} SOL`);
    
    // Close game account to return rent exemption to creator (player1)
    console.log('🔒 Closing game account to return rent exemption to creator...');
    console.log('🔒 Expected rent return: ~0.002463840 SOL');
    console.log('🔒 Game PDA:', gamePDA.toString());
    console.log('🔒 Creator (player1):', player1Key.toString());
    
    try {
      // Check Game PDA balance before closing
      const gameBalanceBeforeClose = await connection.getBalance(gamePDA);
      console.log(`🔒 Game PDA balance BEFORE close: ${(gameBalanceBeforeClose / LAMPORTS_PER_SOL).toFixed(9)} SOL`);
      
      const closeSig = await program.methods
        .closeGame(gameId)
        .accounts({
          game: gamePDA,
          player1: player1Key,
          user: serviceWallet.publicKey, // Service wallet signs, but rent goes to player1
          systemProgram: SystemProgram.programId
        })
        .signers([serviceWallet])
        .rpc();
      
      console.log('✅ Game account closed successfully!');
      console.log('✅ Close transaction signature:', closeSig);
      
      // Verify Game PDA was closed
      const gameAccountAfterClose = await connection.getAccountInfo(gamePDA);
      console.log('🔒 Game account exists after close:', gameAccountAfterClose !== null);
      
      // Log balance after closing
      const player1BalanceAfterClose = await connection.getBalance(player1Key);
      const rentReturned = player1BalanceAfterClose - balancesAfter.player1;
      console.log(`💰 Player1 (creator) balance BEFORE close: ${(balancesAfter.player1 / LAMPORTS_PER_SOL).toFixed(9)} SOL`);
      console.log(`💰 Player1 (creator) balance AFTER close: ${(player1BalanceAfterClose / LAMPORTS_PER_SOL).toFixed(9)} SOL`);
      console.log(`💰 Rent returned to creator: ${(rentReturned / LAMPORTS_PER_SOL).toFixed(9)} SOL`);
    } catch (closeError) {
      console.error('❌ Failed to close game account:', closeError.message);
      console.error('❌ Close error stack:', closeError.stack);
      // Don't fail the entire finalization if closing fails
    }
    
    return true;

  } catch (error) {
    console.error('❌ ===== AUTO-FINALIZATION FAILED =====');
    console.error('💥 Error details:', error.message);
    console.error('📊 Error stack:', error.stack);
    console.error('🔍 Game details:');
    console.error('  Game ID:', gameId);
    console.error('  Winner:', winnerPublicKey);
    console.error('  Stake:', stakeAmount, 'SOL');
    console.error('  RPC URL:', SOLANA_RPC_URL);
    console.error('  Service wallet:', serviceWallet?.publicKey?.toString() || 'NOT INITIALIZED');
    
    // Specific error handling
    if (error.message.includes('insufficient')) {
      console.error('❌ CRITICAL: Service wallet has insufficient balance!');
      if (serviceWallet) {
        connection.getBalance(serviceWallet.publicKey).then(balance => {
          console.error(`   Current balance: ${(balance / LAMPORTS_PER_SOL).toFixed(3)} SOL`);
          console.error(`   Wallet address: ${serviceWallet.publicKey.toString()}`);
        }).catch(e => console.error('   Could not check balance:', e.message));
      }
    }
    
    // Fallback to abandon pathway for safe stake recovery
    try {
      console.log('🔄 Attempting safe stake recovery via abandon pathway...');
      // TODO: Implement abandon pathway fallback
      console.log('Fallback recovery not yet implemented');
    } catch (fallbackError) {
      console.error('Fallback recovery also failed:', fallbackError);
    }
    
    return false;
  }
}

/**
 * Process auto-finalization queue 
 * This would run periodically to check for games marked for auto-finalization
 */
async function processAutoFinalizationQueue() {
  try {
    // TODO: Query database for games with status 'ready_for_auto_finalization'
    // TODO: For each game, call autoFinalizeSolGame()
    // TODO: Update database status to 'auto_finalized' on success
    
    console.log('Auto-finalization queue processing (not yet implemented)');
    return true;
  } catch (error) {
    console.error('Queue processing failed:', error);
    return false;
  }
}

/**
 * Process SOL refund when a player cancels before game starts
 * @param {string} gameId - Game ID
 * @param {string} playerWallet - Player's wallet address (to refund to)
 * @param {number} stakeAmount - Amount to refund in SOL
 * @returns {Promise<boolean>} Success status
 */
async function refundSolBeforeStart(gameId, playerWallet, stakeAmount) {
  try {
    console.log('💰 Processing SOL refund for cancelled game:', gameId);
    console.log('💰 Refunding to:', playerWallet);
    console.log('💰 Amount:', stakeAmount, 'SOL');
    
    const gamePDA = findGamePDA(gameId);
    const playerKey = new PublicKey(playerWallet);
    
    // Check if game account exists
    const gameAccount = await connection.getAccountInfo(gamePDA);
    if (!gameAccount) {
      console.log('⚠️ Game account does not exist on-chain, no refund needed');
      return true; // No game was created on-chain, so no refund needed
    }
    
    // For private games that haven't started (no player2)
    // We need to transfer SOL back from Game PDA to player1
    console.log('💰 Refunding stake from Game PDA to player...');
    
    const refundLamports = stakeAmount * LAMPORTS_PER_SOL;
    
    const refundInstruction = SystemProgram.transfer({
      fromPubkey: gamePDA,
      toPubkey: playerKey,
      lamports: refundLamports
    });
    
    // Service wallet cannot sign for Game PDA
    // For now, we'll need to call the smart contract to handle this
    // OR we could use a simpler approach: just notify the frontend
    console.log('⚠️ Automatic refund not yet implemented - requires player to manually call contract');
    
    return true;
  } catch (error) {
    console.error('❌ Failed to process SOL refund:', error);
    return false;
  }
}

module.exports = {
  initializeService,
  autoFinalizeSolGame,
  processAutoFinalizationQueue,
  refundSolBeforeStart
}; 