/**
 * Game Manager
 * Handles multiple concurrent RPS games and player matchmaking
 * Now supports dual currency system (Points and SOL)
 */

const { v4: uuidv4 } = require('uuid');
const { createGameState, addPlayer, processMove, validateGameState } = require('./gameLogic');
const databaseService = require('../services/databaseService');
const ReferralService = require('../services/referralService');
const autoFinalizationService = require('../services/autoFinalizationService');

class GameManager {
  constructor() {
    this.games = new Map(); // gameId -> gameState
    this.playerGames = new Map(); // playerId -> gameId
    this.publicQueue = []; // Queue of players waiting for random match
    this.referralService = new ReferralService();
  }

  /**
   * Create a new game with currency support
   * @param {string} gameType - 'private' or 'public'
   * @param {number} stakeAmount - Stake amount (points or SOL)
   * @param {string} currency - 'points' or 'sol'
   * @param {string} creatorId - Player ID who created the game
   * @param {string} socketId - Creator's socket ID
   * @param {string} walletAddress - Creator's wallet address
   * @param {string} providedGameId - Optional gameId to use (for on-chain consistency)
   * @returns {object} - Game creation result
   */
  async createGame(gameType = 'public', stakeAmount = 0, currency = 'points', creatorId = null, socketId = null, walletAddress = null, providedGameId = null) {
    // Validate currency and stake amount
    if (currency === 'points') {
      if (stakeAmount !== 100) {
        return { success: false, error: 'Points games must cost exactly 100 points' };
      }
      
      // Check if user has enough points
      if (walletAddress) {
        const hasPoints = await databaseService.hasEnoughPoints(walletAddress, 100);
        if (!hasPoints) {
          return { success: false, error: 'Insufficient points. You need 100 points to play.' };
        }
      }
    } else if (currency === 'sol') {
      if (stakeAmount <= 0) {
        return { success: false, error: 'SOL games must have a positive stake amount' };
      }
      
      // For SOL games, we don't need to check balance here
      // The on-chain transaction will fail if they don't have enough SOL
      console.log(`Creating SOL game with stake ${stakeAmount} SOL`);
    } else {
      return { success: false, error: 'Invalid currency. Must be "points" or "sol"' };
    }

    // Use provided gameId if available, otherwise generate UUID
    // For SOL games, trim UUID to max 32 chars (Solana PDA seed limit)
    let gameId = providedGameId || uuidv4();
    if (currency === 'sol' && gameId.length > 32) {
      gameId = gameId.replace(/-/g, '').slice(0, 32); // Remove dashes and trim to 32 chars
    }
    const gameState = createGameState(gameId, gameType, stakeAmount, currency);

    // Add creator as player1 if provided
    if (creatorId && socketId) {
      // IMPORTANT: If player was in a previous game, remove old entry first
      // This ensures clean state when starting a new game after finishing a previous one
      if (this.playerGames.has(creatorId)) {
        const oldGameId = this.playerGames.get(creatorId);
        console.log(`🔄 Player ${creatorId} was in old game ${oldGameId}, removing before creating new game ${gameId}`);
        this.playerGames.delete(creatorId);
      }
      
      const { gameState: updatedState, playerPosition } = addPlayer(gameState, creatorId, socketId, walletAddress);
      
      // Mark stake as deposited for SOL games
      if (currency === 'sol') {
        updatedState.player1.stakeDeposited = true;
      }
      
      this.games.set(gameId, updatedState);
      this.playerGames.set(creatorId, gameId);
      
      console.log(`✅ Created game ${gameId} for player ${creatorId}`);
      console.log(`📝 Updated playerGames map:`, Array.from(this.playerGames.entries()));
      console.log(`🔍 Verification: playerGames.get(${creatorId}) =`, this.playerGames.get(creatorId));
      console.log(`🔍 Game state after creation: player1=${updatedState.player1?.id}, player2=${updatedState.player2?.id}`);
      
      return {
        success: true,
        gameId,
        gameState: updatedState,
        playerPosition,
        inviteLink: gameType === 'private' ? gameId : null
      };
    }       
                                                                                                                                         
    this.games.set(gameId, gameState);
    
    return {
      success: true,
      gameId,
      gameState,
      inviteLink: gameType === 'private' ? gameId : null
    };
  }

  /**
   * Join a game by game ID (for private games or direct joining)
   * @param {string} gameId - Game to join
   * @param {string} playerId - Player joining
   * @param {string} socketId - Player's socket ID
   * @param {string} walletAddress - Player's wallet address
   * @returns {object} - Join result
   */
  async joinGame(gameId, playerId, socketId, walletAddress = null) {
    const gameState = this.games.get(gameId);
    
    if (!gameState) {
      return { success: false, error: 'Game not found' };
    }

    if (gameState.gameStatus === 'finished') {
      return { success: false, error: 'Game already finished' };
    }

    if (gameState.gameStatus === 'playing') {
      return { success: false, error: 'Game already in progress' };
    }

    // Check currency requirements for joining player
    if (gameState.currency === 'points' && walletAddress) {
      const hasPoints = await databaseService.hasEnoughPoints(walletAddress, 100);
      if (!hasPoints) {
        return { success: false, error: 'Insufficient points. You need 100 points to join this game.' };
      }
    } else if (gameState.currency === 'sol') {
      // For SOL games, we don't need to check balance here
      // The on-chain transaction will fail if they don't have enough SOL
      console.log(`Joining SOL game with stake ${gameState.stakeAmount} SOL`);
    }

    try {
      // IMPORTANT: If player was in a previous game, remove old entry first
      // This ensures clean state when joining a new game after finishing a previous one
      if (this.playerGames.has(playerId)) {
        const oldGameId = this.playerGames.get(playerId);
        if (oldGameId !== gameId) {
          console.log(`🔄 Player ${playerId} was in old game ${oldGameId}, removing before joining new game ${gameId}`);
          this.playerGames.delete(playerId);
        } else {
          console.log(`✅ Player ${playerId} already in playerGames for game ${gameId}, keeping entry`);
        }
      }
      
      const { gameState: updatedState, playerPosition } = addPlayer(gameState, playerId, socketId, walletAddress);
      
      // Mark stake as deposited for SOL games
      if (gameState.currency === 'sol') {
        updatedState.player2.stakeDeposited = true;
      }
      
      this.games.set(gameId, updatedState);
      
      // CRITICAL: Always update playerGames for BOTH players when game is ready
      // This ensures playerGames is correct after reconnection or when restoring game state
      this.playerGames.set(playerId, gameId);
      
      // Also ensure player1 is in playerGames if they exist
      if (updatedState.player1?.id) {
        this.playerGames.set(updatedState.player1.id, gameId);
      }
      
      console.log(`✅ Player ${playerId} joined ${gameState.currency} game ${gameId}`);
      console.log(`📝 Updated playerGames map:`, Array.from(this.playerGames.entries()));
      console.log(`🔍 Verification: playerGames.get(${playerId}) =`, this.playerGames.get(playerId));
      console.log(`🔍 Game state players: player1=${updatedState.player1?.id}, player2=${updatedState.player2?.id}`);
      console.log(`🔍 Both players in playerGames: player1=${this.playerGames.get(updatedState.player1?.id)}, player2=${this.playerGames.get(updatedState.player2?.id)}`);

      return {
        success: true,
        gameId,
        gameState: updatedState,
        playerPosition,
        gameStarted: updatedState.gameStatus === 'playing'
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Find or create a public game for random matchmaking with currency preference
   * @param {string} playerId - Player looking for a match
   * @param {string} socketId - Player's socket ID
   * @param {number} stakeAmount - Desired stake amount
   * @param {string} currency - Preferred currency ('points' or 'sol')
   * @param {string} walletAddress - Player's wallet address
   * @returns {object} - Matchmaking result
   */
  async findRandomMatch(playerId, socketId, stakeAmount = 0, currency = 'points', walletAddress = null) {
    // Check if player is already in a game
    if (this.playerGames.has(playerId)) {
      const existingGameId = this.playerGames.get(playerId);
      const existingGame = this.games.get(existingGameId);
      if (existingGame && existingGame.gameStatus !== 'finished') {
        // Auto-remove player from old game instead of rejecting
        console.log(`⚠️ Player ${playerId} still in game ${existingGameId}, auto-removing...`);
        this.removePlayer(playerId);
        console.log(`✅ Player ${playerId} removed from old game, proceeding with matchmaking`);
      }
    }

    // Validate currency and check user's ability to play
    if (currency === 'points') {
      stakeAmount = 100; // Force 100 points for points games
      if (walletAddress) {
        const hasPoints = await databaseService.hasEnoughPoints(walletAddress, 100);
        if (!hasPoints) {
          // Auto-switch to SOL if no points
          currency = 'sol';
          stakeAmount = 0.01; // Default SOL amount
          console.log(`Player ${playerId} has insufficient points, switching to SOL`);
        }
      }
    }

    // Look for an existing public game waiting for a player with matching stake and currency
    for (const [gameId, gameState] of this.games.entries()) {
      if (
        gameState.gameType === 'public' &&
        gameState.gameStatus === 'waiting_for_player' &&
        gameState.stakeAmount === stakeAmount &&
        gameState.currency === currency &&
        gameState.player1.id !== playerId // Don't match with yourself
      ) {
        console.log(`Found existing public game for player ${playerId}: ${gameId}`);
        return this.joinGame(gameId, playerId, socketId, walletAddress);
      }
    }

    // Check if there's another player in the matchmaking queue with similar preferences
    const queuedPlayer = this.publicQueue.find(p => 
      p.playerId !== playerId && 
      p.stakeAmount === stakeAmount && 
      p.currency === currency
    );

    if (queuedPlayer) {
      // Found a match in the queue! Create a game with both players
      console.log(`Found queued player match: ${playerId} vs ${queuedPlayer.playerId}`);
      
      // Remove the queued player from the queue
      this.publicQueue = this.publicQueue.filter(p => p.playerId !== queuedPlayer.playerId);
      
      // Create a new game
      const gameResult = await this.createGame('public', stakeAmount, currency, queuedPlayer.playerId, queuedPlayer.socketId, queuedPlayer.walletAddress);
      
      if (gameResult.success) {
        // Add the second player (current player) to the game
        const joinResult = await this.joinGame(gameResult.gameId, playerId, socketId, walletAddress);
        
        if (joinResult.success) {
          console.log(`Successfully matched ${playerId} with ${queuedPlayer.playerId} in game ${gameResult.gameId}`);
          return {
            ...joinResult,
            gameStarted: true // Indicate that the game started immediately
          };
        }
      }
    }

    // No existing game or queued player found, add to matchmaking queue
    console.log(`Adding player ${playerId} to matchmaking queue`);
    
    // Remove any existing queue entry for this player
    this.publicQueue = this.publicQueue.filter(p => p.playerId !== playerId);
    
    // Add player to queue
    this.publicQueue.push({
      playerId,
      socketId,
      stakeAmount,
      currency,
      walletAddress,
      queuedAt: Date.now()
    });

    // Create a placeholder game for the UI to show "waiting" state
    const gameResult = await this.createGame('public', stakeAmount, currency, playerId, socketId, walletAddress);
    
    if (gameResult.success) {
      console.log(`Created waiting game for player ${playerId}: ${gameResult.gameId}`);
      return {
        ...gameResult,
        gameStarted: false, // Indicate that we're still waiting for an opponent
        inQueue: true
      };
    }

    return { success: false, error: 'Failed to enter matchmaking queue' };
  }

  /**
   * Submit a move for a player
   * @param {string} playerId - Player making the move
   * @param {string} move - The move (rock/paper/scissors)
   * @returns {object} - Move result
   */
  submitMove(playerId, move, requestedGameId = null) {
    console.log(`GameManager.submitMove called:`);
    console.log(`   - playerId: "${playerId}"`);
    console.log(`   - move: "${move}"`);
    console.log(`   - requestedGameId: "${requestedGameId}"`);
    console.log(`   - playerGames map size:`, this.playerGames.size);
    console.log(`   - playerGames map:`, Array.from(this.playerGames.entries()));
    
    // Fallback: if playerGames is empty but game exists, try to find game by searching all games
    let gameId = this.playerGames.get(playerId);
    
    if (!gameId) {
      console.warn(`⚠️ Player "${playerId}" not found in playerGames map, searching all games...`);
      console.warn(`   Available players in playerGames:`, Array.from(this.playerGames.keys()));
      
      // Fallback: search through all games to find this player
      // Priority 1: If requestedGameId is provided, check that game first
      if (requestedGameId) {
        const requestedGame = this.games.get(requestedGameId);
        if (requestedGame && 
            (requestedGame.player1?.id === playerId || requestedGame.player2?.id === playerId) &&
            requestedGame.gameStatus === 'playing') {
          console.log(`🔍 Found player ${playerId} in REQUESTED game ${requestedGameId} by searching games`);
          gameId = requestedGameId;
          // Restore playerGames entry
          this.playerGames.set(playerId, gameId);
          console.log(`✅ Restored playerGames entry: ${playerId} -> ${gameId}`);
        }
      }
      
      // Priority 2: Search active games (playing status)
      if (!gameId) {
        const gamesArray = Array.from(this.games.entries()).reverse();
        for (const [gId, gameState] of gamesArray) {
          if ((gameState.player1?.id === playerId || gameState.player2?.id === playerId) && 
              gameState.gameStatus === 'playing') {
            console.log(`🔍 Found player ${playerId} in ACTIVE game ${gId} by searching games`);
            gameId = gId;
            // Restore playerGames entry
            this.playerGames.set(playerId, gameId);
            console.log(`✅ Restored playerGames entry: ${playerId} -> ${gameId}`);
            break;
          }
        }
      }
      
      // Priority 3: If still not found, try any game (including waiting games)
      if (!gameId) {
        const gamesArray = Array.from(this.games.entries()).reverse();
        for (const [gId, gameState] of gamesArray) {
          if (gameState.player1?.id === playerId || gameState.player2?.id === playerId) {
            console.log(`🔍 Found player ${playerId} in game ${gId} (any status) by searching games`);
            gameId = gId;
            // Restore playerGames entry
            this.playerGames.set(playerId, gameId);
            console.log(`✅ Restored playerGames entry: ${playerId} -> ${gameId}`);
            break;
          }
        }
      }
    }
    
    if (!gameId) {
      console.error(`❌ Player "${playerId}" not found in any game`);
      console.error(`   Available players:`, Array.from(this.playerGames.keys()));
      console.error(`   Available games:`, Array.from(this.games.keys()));
      return { success: false, error: 'Player not in any game' };
    }

    const gameState = this.games.get(gameId);
    
    if (!gameState) {
      console.error(`❌ Game ${gameId} not found in games map`);
      console.error(`   Available games:`, Array.from(this.games.keys()));
      return { success: false, error: 'Game not found' };
    }
    
    // Additional validation: check if player is actually in this game
    const isPlayer1 = gameState.player1?.id === playerId;
    const isPlayer2 = gameState.player2?.id === playerId;
    
    if (!isPlayer1 && !isPlayer2) {
      console.error(`❌ Player ${playerId} is not actually in game ${gameId}`);
      console.error(`   Game has player1: ${gameState.player1?.id}, player2: ${gameState.player2?.id}`);
      return { success: false, error: 'Player is not in this game' };
    }

    try {
      const { gameState: updatedState, roundComplete, roundResult } = processMove(gameState, playerId, move);
      this.games.set(gameId, updatedState);

      // If game is complete, mark for processing but don't process here
      // Processing will be handled by socketHandlers to avoid double execution
      if (roundResult && roundResult.gameFinished) {
        console.log(`🎮 Game ${gameId} finished, will be processed by socket handler`);
        updatedState.readyForCompletion = true;
        updatedState.completionData = roundResult;
      }

      return {
        success: true,
        gameId,
        gameState: updatedState,
        roundComplete,
        roundResult,
        moveSubmitted: true
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Process game completion and update database
   * @param {string} gameId - Game ID
   * @param {object} gameState - Final game state
   * @param {object} roundResult - Round result with winner info
   */
  async processGameCompletion(gameId, gameState, roundResult) {
    try {
      // Additional safety check to prevent double processing
      if (gameState.completionProcessed) {
        console.log(`⚠️ Game ${gameId} completion already processed, skipping duplicate`);
        return;
      }
      
      // Mark as being processed
      gameState.completionProcessed = true;
      
      const player1Wallet = gameState.player1.wallet;
      const player2Wallet = gameState.player2.wallet;
      const winnerWallet = roundResult.gameWinner === 'player1' ? player1Wallet : player2Wallet;

      console.log(`🎮 Processing ${gameState.currency} game completion:`, {
        gameId,
        winner: roundResult.gameWinner,
        winnerWallet,
        currency: gameState.currency,
        player1Wallet,
        player2Wallet
      });

      // Check if we have wallet addresses
      if (!player1Wallet || !player2Wallet) {
        console.error(`❌ Missing wallet addresses:`, {
          player1Wallet,
          player2Wallet,
          gameId
        });
        return;
      }

      if (!winnerWallet) {
        console.error(`❌ Could not determine winner wallet:`, {
          roundResult,
          gameState: {
            player1: gameState.player1,
            player2: gameState.player2
          }
        });
        return;
      }

      console.log(`🔍 About to check currency condition: gameState.currency = "${gameState.currency}"`);

      if (gameState.currency === 'points') {
        // Process points game
        const result = await databaseService.processPointsGame(
          gameId,
          player1Wallet,
          player2Wallet,
          winnerWallet,
          gameState.createdAt
        );

        if (result.success) {
          console.log(`Points game processed successfully:`, {
            player1Balance: result.player1Profile?.points_balance,
            player2Balance: result.player2Profile?.points_balance
          });

          // Process referral commission for points winnings (1% of 100 points won = 1 point)
          try {
            const pointsWon = 100; // Winner gets 100 points in points games
            console.log(`💰 Processing referral commission for points winner: ${winnerWallet}, Points won: ${pointsWon}`);
            
            await this.referralService.processReferralCommission(winnerWallet, gameId, pointsWon);
          } catch (referralError) {
            console.error('❌ Error processing referral commission for points game:', referralError);
            // Don't fail the whole game completion if referral processing fails
          }
        } else {
          console.error(`Failed to process points game:`, result.error);
        }
      } else if (gameState.currency === 'sol') {
        // MODERN STANDARD: Auto-finalize SOL games with proper winner rewards  
        console.log(`🚀 SOL game completed - implementing auto-finalization`);
        console.log(`🔍 Currency check passed: ${gameState.currency} === 'sol'`);
        
        try {
          // Backend automatically handles winner distribution
          console.log(`Winner: ${winnerWallet}`);
          console.log(`Should receive: ${gameState.winnerPayout} SOL (total pot minus platform fee)`);
          console.log(`Triggering auto-finalization...`);
          
          // Update database stats for both players (including 100 bonus points for winner)
          const player1Won = winnerWallet === player1Wallet;
          const player2Won = winnerWallet === player2Wallet;

          console.log(`Updating database stats - Winner gets 100 bonus points`);
          const [player1Updated, player2Updated] = await Promise.all([
            databaseService.updateUserGameStats(player1Wallet, player1Won, 'sol', gameId),
            databaseService.updateUserGameStats(player2Wallet, player2Won, 'sol', gameId)
          ]);

          console.log(`Database stats updated:`, {
            player1: { won: player1Won, newBalance: player1Updated?.points_balance },
            player2: { won: player2Won, newBalance: player2Updated?.points_balance }
          });

          // SOL referral commission is now handled directly in auto-finalization service
          console.log(`💰 SOL referral commission will be processed during auto-finalization`);
          
          // Record game completion  
          await databaseService.recordGameHistory({
            gameId,
            player1Wallet,
            player2Wallet,
            winnerWallet,
            currency: 'sol',
            amountBet: gameState.stakeAmount,
            potAmount: gameState.totalPot,
            platformFee: gameState.platformFee,
            winnerPayout: gameState.winnerPayout,
            status: 'completed', // Use existing status instead of auto_finalizing
            startedAt: gameState.createdAt,
            completedAt: new Date().toISOString()
          });

          // IMMEDIATELY trigger auto-finalization
          const loserWallet = winnerWallet === player1Wallet ? player2Wallet : player1Wallet;
          
          console.log(`🚀 Calling auto-finalization service...`);
          console.log(`🎯 Auto-finalization parameters:`, {
            gameId,
            winnerWallet,
            loserWallet,
            stakeAmount: gameState.stakeAmount
          });
          
          let success = false;
          try {
            success = await autoFinalizationService.autoFinalizeSolGame(
              gameId,
              winnerWallet,
              loserWallet,
              gameState.stakeAmount
            );
            
            console.log(`✅ Auto-finalization result:`, success);
            
            if (success) {
              console.log(`🎉 Auto-finalization successful`);
              console.log(`💰 Winner ${winnerWallet} should now have ${gameState.winnerPayout} SOL`);
              console.log(`🚀 Winner receives SOL automatically`);
            } else {
              console.log(`❌ Auto-finalization returned false - no SOL transferred`);
            }
          } catch (autoFinalizeError) {
            console.error(`💥 Auto-finalization CRASHED:`, autoFinalizeError);
            console.error(`💥 Error details:`, {
              message: autoFinalizeError.message,
              stack: autoFinalizeError.stack,
              name: autoFinalizeError.name
            });
            
            // Log specific error types for debugging
            if (autoFinalizeError.message.includes('insufficient balance')) {
              console.error(`❌ CRITICAL: Service wallet needs funding!`);
              console.error(`   This is likely why auto-finalization is failing on production`);
            }
            if (autoFinalizeError.message.includes('Service wallet not initialized')) {
              console.error(`❌ CRITICAL: Service wallet not initialized!`);
              console.error(`   Check SERVICE_WALLET_PRIVATE_KEY environment variable`);
            }
            if (autoFinalizeError.message.includes('RPC')) {
              console.error(`❌ CRITICAL: RPC connection issue!`);
              console.error(`   Check SOLANA_RPC_URL environment variable`);
            }
            
            success = false;
          }
          
          if (!success) {
            console.error(`❌ Auto-finalization failed - winner will need to claim manually`);
            console.error(`   This should be investigated - check service wallet balance and RPC connection`);
          }
          
        } catch (error) {
          console.error('Auto-finalization failed:', error);
          console.log('Game will fall back to manual claiming if needed');
        }
      } else {
        console.log(`❌ Unknown currency type: "${gameState.currency}" - no processing logic available`);
        console.log(`Available options: 'points' or 'sol'`);
      }
    } catch (error) {
      console.error('Error processing game completion:', error);
    }
  }

  /**
   * Process game abandonment completion and update database
   * @param {string} gameId - Game ID
   * @param {object} gameState - Final game state
   * @param {object} abandonmentResult - Abandonment result with winner info
   */
  async processGameAbandonmentCompletion(gameId, gameState, abandonmentResult) {
    try {
      const player1Wallet = gameState.player1.wallet;
      const player2Wallet = gameState.player2.wallet;
      const winnerWallet = abandonmentResult.winner === 'player1' ? player1Wallet : player2Wallet;
      const loserWallet = abandonmentResult.winner === 'player1' ? player2Wallet : player1Wallet;

      console.log(`Processing ${gameState.currency} game abandonment:`, {
        gameId,
        winner: abandonmentResult.winner,
        quittingPlayer: abandonmentResult.quittingPlayer,
        winnerWallet,
        loserWallet,
        currency: gameState.currency,
        reason: abandonmentResult.reason
      });

      if (gameState.currency === 'points') {
        // Process points game abandonment
        const result = await databaseService.processPointsGameAbandonment(
          gameId,
          player1Wallet,
          player2Wallet,
          winnerWallet,
          loserWallet,
          gameState.createdAt
        );

        if (result.success) {
          console.log(`Points game abandonment processed successfully:`, {
            winnerBalance: result.winnerProfile?.points_balance,
            loserBalance: result.loserProfile?.points_balance
          });
        } else {
          console.error(`Failed to process points game abandonment:`, result.error);
        }
      } else if (gameState.currency === 'sol') {
        // Record SOL game history as abandoned
        await databaseService.recordGameHistory({
          gameId,
          player1Wallet,
          player2Wallet,
          winnerWallet,
          currency: 'sol',
          amountBet: gameState.stakeAmount,
          potAmount: gameState.totalPot,
          platformFee: gameState.platformFee,
          winnerPayout: gameState.winnerPayout,
          status: 'abandoned',
          startedAt: gameState.createdAt,
          completedAt: new Date().toISOString(),
          abandonedBy: abandonmentResult.quittingPlayer,
          abandonReason: abandonmentResult.reason
        });

        console.log(`SOL game abandonment recorded in history`);
      }
    } catch (error) {
      console.error('Error processing game abandonment completion:', error);
    }
  }

  /**
   * Get game state by game ID
   * @param {string} gameId - Game ID
   * @returns {object|null} - Game state or null if not found
   */
  getGame(gameId) {
    return this.games.get(gameId) || null;
  }

  /**
   * Get game state for a player
   * @param {string} playerId - Player ID
   * @returns {object|null} - Game state or null if player not in game
   */
  getPlayerGame(playerId) {
    const gameId = this.playerGames.get(playerId);
    if (!gameId) return null;
    return this.games.get(gameId) || null;
  }

  /**
   * Remove a player from their current game and clean up
   * @param {string} playerId - Player to remove
   * @returns {object} - Removal result
   */
  removePlayer(playerId) {
    // Remove from matchmaking queue if present
    const queueIndex = this.publicQueue.findIndex(p => p.playerId === playerId);
    if (queueIndex !== -1) {
      this.publicQueue.splice(queueIndex, 1);
      console.log(`Removed player ${playerId} from matchmaking queue`);
    }

    const gameId = this.playerGames.get(playerId);
    
    if (!gameId) {
      return { success: false, error: 'Player not in any game' };
    }

    const gameState = this.games.get(gameId);
    
    if (!gameState) {
      return { success: false, error: 'Game not found' };
    }

    // Remove player from game
    if (gameState.player1.id === playerId) {
      gameState.player1 = {
        id: null,
        socketId: null,
        wallet: null,
        wins: 0,
        currentMove: null,
        stakeDeposited: false
      };
    } else if (gameState.player2.id === playerId) {
      gameState.player2 = {
        id: null,
        socketId: null,
        wallet: null,
        wins: 0,
        currentMove: null,
        stakeDeposited: false
      };
    }

    // Remove from player games mapping
    this.playerGames.delete(playerId);

    // Handle different game states
    if (!gameState.player1.id && !gameState.player2.id) {
      gameState.gameStatus = 'finished';
      console.log(`Game ${gameId} marked for cleanup - no players remaining`);
    } else if (gameState.gameStatus === 'playing') {
      // If game was active, end it with remaining player as winner
      const remainingPlayer = gameState.player1.id || gameState.player2.id;
      gameState.gameStatus = 'finished';
      gameState.winner = remainingPlayer;
      console.log(`Game ${gameId} ended - ${remainingPlayer} wins by forfeit`);
    } else if (gameState.gameStatus === 'waiting_for_player') {
      // Game hasn't started yet - process refund for the quitting player
      console.log(`Player ${playerId} quit before game started - processing refund`);
      
      // Process refund based on currency type
      if (gameState.currency === 'points') {
        // For points games, refund the stake amount
        this.processPointsRefund(gameId, playerId, gameState.stakeAmount);
      } else if (gameState.currency === 'sol') {
        // For SOL games, handle on-chain refund
        console.log(`SOL game refund needed for player ${playerId} - stake: ${gameState.stakeAmount}`);
        
        // Get player wallet from game state
        let playerWallet = null;
        if (gameState.player1.id === playerId) {
          playerWallet = gameState.player1.wallet;
        } else if (gameState.player2.id === playerId) {
          playerWallet = gameState.player2.wallet;
        }
        
        if (playerWallet) {
          const { refundSolBeforeStart } = require('../services/autoFinalizationService');
          refundSolBeforeStart(gameId, playerWallet, gameState.stakeAmount).catch(err => {
            console.error('Failed to process SOL refund:', err);
          });
        }
      }
    }

    return {
      success: true,
      gameId,
      gameState
    };
  }

  /**
   * Process points refund for player who quit before game started
   * @param {string} gameId - Game ID
   * @param {string} playerId - Player ID
   * @param {number} stakeAmount - Amount to refund
   */
  async processPointsRefund(gameId, playerId, stakeAmount) {
    try {
      const gameState = this.games.get(gameId);
      if (!gameState) {
        console.error(`Game ${gameId} not found for refund processing`);
        return;
      }

      // Find the player's wallet address
      let playerWallet = null;
      if (gameState.player1.id === playerId) {
        playerWallet = gameState.player1.wallet;
      } else if (gameState.player2 && gameState.player2.id === playerId) {
        playerWallet = gameState.player2.wallet;
      }

      if (!playerWallet) {
        console.error(`Player ${playerId} wallet not found for refund`);
        return;
      }

      console.log(`Processing points refund: ${stakeAmount} points to ${playerWallet}`);

      // Refund the points to the player
      const refundResult = await databaseService.refundPoints(playerWallet, stakeAmount, gameId);
      
      if (refundResult.success) {
        console.log(`Points refund successful: ${stakeAmount} points returned to ${playerWallet}`);
      } else {
        console.error(`Points refund failed:`, refundResult.error);
      }
    } catch (error) {
      console.error('Error processing points refund:', error);
    }
  }

  /**
   * Get statistics about active games
   * @returns {object} - Game statistics
   */
  getStats() {
    const totalGames = this.games.size;
    const activeGames = Array.from(this.games.values()).filter(g => g.gameStatus === 'playing').length;
    const waitingGames = Array.from(this.games.values()).filter(g => g.gameStatus === 'waiting_for_player').length;
    const finishedGames = Array.from(this.games.values()).filter(g => g.gameStatus === 'finished').length;

    return {
      totalGames,
      activeGames,
      waitingGames,
      finishedGames,
      totalPlayers: this.playerGames.size
    };
  }

  /**
   * Clean up finished games (optional maintenance)
   * @param {number} maxAge - Maximum age in milliseconds
   */
  cleanupOldGames(maxAge = 24 * 60 * 60 * 1000) { // 24 hours default
    const now = new Date();
    const gamesToRemove = [];

    for (const [gameId, gameState] of this.games.entries()) {
      const gameAge = now - new Date(gameState.createdAt);
      
      if (gameState.gameStatus === 'finished' && gameAge > maxAge) {
        gamesToRemove.push(gameId);
        
        // Remove players from playerGames map
        if (gameState.player1.id) {
          this.playerGames.delete(gameState.player1.id);
        }
        if (gameState.player2.id) {
          this.playerGames.delete(gameState.player2.id);
        }
      }
    }

    gamesToRemove.forEach(gameId => this.games.delete(gameId));
    
    return { removed: gamesToRemove.length };
  }

  /**
   * Process a round directly (used for auto-processing when time runs out)
   * @param {string} gameId - Game ID
   * @returns {object} - Process result
   */
  processRoundDirectly(gameId) {
    const gameState = this.games.get(gameId);
    
    if (!gameState) {
      return { success: false, error: 'Game not found' };
    }

    if (!gameState.player1.currentMove || !gameState.player2.currentMove) {
      return { success: false, error: 'Both players must have moves to process round' };
    }

    try {
      const { processRound } = require('./gameLogic');
      const { gameState: updatedState, roundComplete, roundResult } = processRound(gameState);
      this.games.set(gameId, updatedState);

      return {
        success: true,
        gameId,
        gameState: updatedState,
        roundComplete,
        roundResult
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = GameManager; 