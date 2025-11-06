/**
 * Socket Handlers for RPS Game
 * Manages real-time game interactions via WebSocket
 */

const { v4: uuidv4 } = require('uuid');
const gameManager = require('../game/gameManagerSingleton');
const databaseService = require('../services/databaseService');
const { useSimpleMove } = require('../utils/simpleMove');
const { VALID_MOVES } = require('../utils/constants');
const anchor = require('@coral-xyz/anchor');
const { Connection, PublicKey, SystemProgram, Keypair } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

// Constants for Anchor integration
const PROGRAM_ID = new PublicKey('GstXQkBpu26KABj6YZ3pYKJhQphoQ72YL1zL38NC6D9U');
const DEVNET_URL = 'https://api.devnet.solana.com';
const connection = new Connection(DEVNET_URL, 'confirmed');

// Load Anchor IDL
let idl;
try {
  const idlPath = path.join(__dirname, '../../../anchor/target/idl/rps_game.json');
  idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));
  console.log('Anchor IDL loaded successfully');
} catch (error) {
  console.error('Failed to load Anchor IDL:', error);
  idl = null;
}

// Simple hash function for Node.js compatibility (same as frontend)
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  // Convert to 16 bytes
  const result = new Uint8Array(16);
  const hashStr = Math.abs(hash).toString(16).padStart(8, '0');
  const idStr = str.slice(0, 8).padEnd(8, '0');
  const combined = (hashStr + idStr).slice(0, 16);
  for (let i = 0; i < 16; i++) {
    result[i] = combined.charCodeAt(i) % 256;
  }
  return result;
}

// Helper functions for Anchor integration
function findUserProfilePDA(walletPublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('user_profile'), walletPublicKey.toBuffer()],
    PROGRAM_ID
  )[0];
}

function findGamePDA(gameId) {
  // Hash the gameId to ensure it fits within seed length limits (32 bytes max)
  const gameIdHash = simpleHash(gameId);
  
  return PublicKey.findProgramAddressSync(
    [Buffer.from('game'), Buffer.from(gameIdHash)],
    PROGRAM_ID
  )[0];
}

// Game timers
const gameTimers = new Map();
const playerSockets = new Map(); // playerId -> socketId
const socketPlayers = new Map(); // socketId -> playerId
const simpleMove = useSimpleMove();

// Track on-chain completion status for SOL games
const onchainStatus = new Map(); // gameId -> { player1: boolean, player2: boolean }

/**
 * Start a countdown timer for a game round
 * @param {string} gameId - Game ID
 * @param {object} io - Socket.io server instance
 * @param {number} duration - Timer duration in seconds
 */
function startRoundTimer(gameId, io, duration = 15) {
  console.log(`⏰ Starting round timer for game ${gameId} with duration ${duration}s`);
  
  // Clear any existing timer for this game
  if (gameTimers.has(gameId)) {
    console.log(`⏰ Clearing existing timer for game ${gameId}`);
    clearInterval(gameTimers.get(gameId));
  }

  let countdown = duration;
  
  // Emit initial countdown
  io.to(gameId).emit('countdown_update', { countdown });
  
  const timer = setInterval(() => {
    countdown--;
    // Only log countdown at key intervals to reduce spam
    if (countdown % 5 === 0 || countdown <= 3) {
      console.log(`⏰ Countdown ${countdown} for game ${gameId}`);
    }
    
    // Check if game still exists and is active before sending countdown
    const currentGameState = gameManager.getGame(gameId);
    if (!currentGameState || currentGameState.gameStatus === 'finished') {
      console.log(`⏰ Game ${gameId} is finished or doesn't exist, stopping timer`);
      clearInterval(timer);
      gameTimers.delete(gameId);
      return;
    }
    
    io.to(gameId).emit('countdown_update', { countdown });
    
    if (countdown <= 0) {
      console.log(`⏰ Timer reached 0 for game ${gameId}, clearing timer`);
      clearInterval(timer);
      gameTimers.delete(gameId);
      
      // Time's up! Handle automatic moves for players who haven't moved
      handleTimeUp(gameId, io);
    }
  }, 1000);
  
  gameTimers.set(gameId, timer);
  console.log(`⏰ Timer created for game ${gameId}`);
}

/**
 * Handle when time runs out for a round
 * @param {string} gameId - Game ID
 * @param {object} io - Socket.io server instance
 */
function handleTimeUp(gameId, io) {
  const gameState = gameManager.getGame(gameId);
  if (!gameState) return;

  console.log(`⏰ Time up for game ${gameId}`);
  
  const moves = ['rock', 'paper', 'scissors'];
  
  // Assign random moves to players who haven't moved
  let autoAssignedMoves = [];
  
  // Check which players need moves assigned
  const needsMove = {
    player1: !gameState.player1.currentMove && gameState.player1.id,
    player2: !gameState.player2.currentMove && gameState.player2.id
  };
  
  if (needsMove.player1 && needsMove.player2) {
    // Both players timed out - ensure they get different moves for interesting outcome
    const shuffledMoves = [...moves].sort(() => Math.random() - 0.5);
    const player1Move = shuffledMoves[0];
    const player2Move = shuffledMoves[1]; // Guaranteed to be different from player1Move
    
    console.log(`🎲 Auto-assigning ${player1Move} to player1`);
    gameState.player1.currentMove = player1Move;
    autoAssignedMoves.push({ playerId: gameState.player1.id, move: player1Move });
    
    console.log(`🎲 Auto-assigning ${player2Move} to player2`);
    gameState.player2.currentMove = player2Move;
    autoAssignedMoves.push({ playerId: gameState.player2.id, move: player2Move });
  } else {
    // Only one player timed out - assign random move
    if (needsMove.player1) {
      const randomMove = moves[Math.floor(Math.random() * moves.length)];
      console.log(`🎲 Auto-assigning ${randomMove} to player1`);
      gameState.player1.currentMove = randomMove;
      autoAssignedMoves.push({ playerId: gameState.player1.id, move: randomMove });
    }
    
    if (needsMove.player2) {
      const randomMove = moves[Math.floor(Math.random() * moves.length)];
      console.log(`🎲 Auto-assigning ${randomMove} to player2`);
      gameState.player2.currentMove = randomMove;
      autoAssignedMoves.push({ playerId: gameState.player2.id, move: randomMove });
    }
  }
  
  console.log(`🔍 Timeout processing: autoAssignedMoves:`, autoAssignedMoves);
  
  // If we auto-assigned moves, process the round
  if (autoAssignedMoves.length > 0) {
    console.log(`🔍 Processing ${autoAssignedMoves.length} auto-assigned moves...`);
    
    console.log(`🔍 Game state after auto-assignment:`, {
      player1Move: gameState?.player1?.currentMove,
      player2Move: gameState?.player2?.currentMove,
      gameStatus: gameState?.gameStatus
    });
    
    if (gameState && gameState.player1.currentMove && gameState.player2.currentMove) {
      console.log(`🔍 Both players have moves, proceeding with round processing...`);
      
      // Emit move_submitted events for the auto-assigned moves to update UI
      autoAssignedMoves.forEach(({ playerId, move }) => {
        console.log(`📤 Emitting move_submitted for ${playerId}: ${move}`);
        io.to(gameId).emit('move_submitted', {
          success: true,
          playerId: playerId,
          move: move,
          gameState: gameState
        });
      });
      
      // Both players now have moves, process the round
      const result = gameManager.processRoundDirectly(gameId);
      console.log('processRoundDirectly result:', result);
      
      if (result.success && result.roundComplete) {
        console.log('Round completed via timeout, emitting round_completed event');
        
        // For final round, don't emit round_completed immediately
        // Instead show suspense screen and then reveal winner
        if (result.roundResult.gameFinished) {
          console.log('🎬 Final round - showing suspense screen before revealing winner');
          
          // No delay - show result immediately
          console.log('🏆 Revealing final winner immediately');
          handleGameFinished(gameId, result.gameState, io);
        } else {
          // Regular round - emit round_completed immediately
          io.to(gameId).emit('round_completed', {
            gameId,
            roundResult: result.roundResult,
            gameState: result.gameState
          });
          
          // Update game state for all players
          io.to(gameId).emit('game_state_updated', {
            gameState: result.gameState,
            event: 'timeout_round_processed'
          });
          
          // Start next round immediately
          startNextRound(gameId, io);
        }
      } else {
        console.error('❌ Failed to process round directly:', result);
      }
    }
  }
}

/**
 * Start the next round
 * @param {string} gameId - Game ID
 * @param {object} io - Socket.io server instance
 */
function startNextRound(gameId, io) {
  const gameState = gameManager.getGame(gameId);
  if (!gameState || gameState.gameStatus !== 'playing') return;
  
  // INCREMENT round number at the START of new round
  gameState.currentRound++;
  
  // Reset moves for next round - NOW is the right time to clear them
  gameState.player1.currentMove = null;
  gameState.player2.currentMove = null;
  gameState.player1.ready = false;
  gameState.player2.ready = false;
  
  console.log(`🔄 Starting round ${gameState.currentRound} for game ${gameId}`);
  
  io.to(gameId).emit('next_round', {
    gameId,
    round: gameState.currentRound, // Use new round number (just incremented)
    gameState
  });
  
  // Start timer for next round
  startRoundTimer(gameId, io, 15);
}

/**
 * Handle game completion
 * @param {string} gameId - Completed game ID
 * @param {object} gameState - Final game state
 * @param {object} io - Socket.io server instance
 */
function handleGameFinished(gameId, gameState, io) {
  console.log(`🏁 Game finished: ${gameId}, Winner: ${gameState.winner}`);
  console.log(`🔍 Game state details:`, {
    gameId,
    winner: gameState.winner,
    currency: gameState.currency,
    player1: { id: gameState.player1?.id, wallet: gameState.player1?.wallet },
    player2: { id: gameState.player2?.id, wallet: gameState.player2?.wallet },
    processed: gameState.processed
  });
  
  // Clear any timers for this game
  if (gameTimers.has(gameId)) {
    clearInterval(gameTimers.get(gameId));
    gameTimers.delete(gameId);
  }
  
  // CRITICAL: Process game completion for SOL/points distribution
  // This was missing and causing SOL not to be credited in random matches!
  // Only process if game hasn't been processed yet (avoid double processing)
  if (gameState && gameState.winner && !gameState.processed) {
    console.log(`✅ Processing game completion for ${gameId}`);
    
    const roundResult = {
      gameWinner: gameState.winner === gameState.player1.id ? 'player1' : 'player2',
      gameFinished: true,
      round: gameState.currentRound,
      moves: { player1: null, player2: null }, // Last moves not available here
      roundWinner: null,
      scores: {
        player1: gameState.player1.wins,
        player2: gameState.player2.wins
      }
    };
    
    console.log(`🎯 Round result:`, roundResult);
    
    // Check if already processed to avoid double processing
    if (gameState.processed) {
      console.log(`⚠️ Game ${gameId} already processed, skipping duplicate completion`);
      return;
    }
    
    // Mark as processed to avoid double processing
    gameState.processed = true;
    
    // Process game completion (this handles SOL distribution and database updates)
    console.log(`🚀 Calling gameManager.processGameCompletion...`);
    gameManager.processGameCompletion(gameId, gameState, roundResult);
  } else {
    console.log(`⚠️ Skipping game completion processing:`, {
      hasGameState: !!gameState,
      hasWinner: !!gameState?.winner,
      alreadyProcessed: !!gameState?.processed
    });
  }
  
  // Emit game finished event to all players
  io.to(gameId).emit('game_finished', {
    gameId,
    gameState,
    winner: {
      playerId: gameState.winner,
      position: gameState.winner === gameState.player1.id ? 'player1' : 'player2'
    },
    finalScores: {
      player1: gameState.player1.wins,
      player2: gameState.player2.wins
    },
    payout: {
      totalPot: gameState.totalPot,
      winnerPayout: gameState.winnerPayout,
      platformFee: gameState.platformFee
    }
  });

  // IMMEDIATELY remove players from playerGames map so they can start new games
  if (gameState.player1?.id) {
    gameManager.playerGames.delete(gameState.player1.id);
    console.log(`✅ Removed player1 (${gameState.player1.id}) from playerGames map`);
  }
  if (gameState.player2?.id) {
    gameManager.playerGames.delete(gameState.player2.id);
    console.log(`✅ Removed player2 (${gameState.player2.id}) from playerGames map`);
  }

  // Schedule cleanup of game from memory (after a delay for final state viewing)
  setTimeout(() => {
    gameManager.cleanupOldGames(0); // Clean up immediately for finished games
  }, 30000); // 30 seconds delay
}

/**
 * Set up on-chain completion event handlers for a socket
 * These handlers update the shared onchainStatus map
 */
function setupOnchainHandlersForSocket(socket, io) {
  // Listen for on-chain completion events from this socket
  console.log(`🔧 Setting up onchain handlers for socket ${socket.id}`);
  
  socket.on('onchain_game_created', (data) => {
    console.log('📥 [setupOnchainHandlersForSocket] Received onchain_game_created event:', data, 'from socket:', socket.id);
    console.log('📥 [setupOnchainHandlersForSocket] Full event data:', JSON.stringify(data));
    console.log('📥 [setupOnchainHandlersForSocket] Data type:', typeof data, 'Is object:', typeof data === 'object');
    const { gameId } = data || {};
    const gameIdKey = gameId ? String(gameId) : null;
    console.log('📥 [setupOnchainHandlersForSocket] Extracted gameId:', gameId, 'Type:', typeof gameId, 'Converted to:', gameIdKey);
    if (gameIdKey) {
      console.log('🔍 Checking onchainStatus for game:', gameIdKey, 'Status exists:', onchainStatus.has(gameIdKey));
      console.log('🔍 Available gameIds in onchainStatus:', Array.from(onchainStatus.keys()));
      if (onchainStatus.has(gameIdKey)) {
        const status = onchainStatus.get(gameIdKey);
        console.log('📊 Current status:', status);
        if (status && !status.player1) {
          status.player1 = true;
          console.log('✅ Player 1 on-chain game created for game:', gameIdKey);
          console.log('📊 Updated status:', onchainStatus.get(gameIdKey));
          
          // Get game state to send trigger to player 2
          const gameState = gameManager.getGame(gameIdKey);
          if (gameState && gameState.player2 && gameState.player2.socketId) {
            console.log('📤 Now triggering player2 to complete their transaction...');
            
            // Use different events based on game type
            const eventName = gameState.gameType === 'private' ? 'game_started_pre_tx' : 'join_onchain_game';
            
            io.to(gameState.player2.socketId).emit(eventName, {
              gameId: gameIdKey,
              gameState: {
                ...gameState,
                gameId: gameIdKey
              },
              playerType: 'player2' // Explicitly tell them they're player2
            });
          }
          
          checkAndStartGame(io, gameIdKey);
        } else if (status && status.player1) {
          console.log('⚠️ Player 1 already marked as completed for game:', gameIdKey);
        }
      } else {
        console.log('⚠️ No onchainStatus found for game:', gameIdKey, 'Available games:', Array.from(onchainStatus.keys()));
      }
    } else {
      console.error('❌ No gameId in onchain_game_created event:', data);
    }
  });
  
  socket.on('onchain_game_joined', (data) => {
    console.log('📥 [setupOnchainHandlersForSocket] Received onchain_game_joined event:', data, 'from socket:', socket.id);
    console.log('📥 [setupOnchainHandlersForSocket] Full event data:', JSON.stringify(data));
    console.log('📥 [setupOnchainHandlersForSocket] Data type:', typeof data, 'Is object:', typeof data === 'object');
    const { gameId } = data || {};
    const gameIdKey = gameId ? String(gameId) : null;
    console.log('📥 [setupOnchainHandlersForSocket] Extracted gameId:', gameId, 'Type:', typeof gameId, 'Converted to:', gameIdKey);
    if (gameIdKey) {
      console.log('🔍 Checking onchainStatus for game:', gameIdKey, 'Status exists:', onchainStatus.has(gameIdKey));
      console.log('🔍 Available gameIds in onchainStatus:', Array.from(onchainStatus.keys()));
      if (onchainStatus.has(gameIdKey)) {
        const status = onchainStatus.get(gameIdKey);
        console.log('📊 Current status:', status);
        if (status && !status.player2) {
          status.player2 = true;
          console.log('✅ Player 2 on-chain game joined for game:', gameIdKey);
          console.log('📊 Updated status:', onchainStatus.get(gameIdKey));
          checkAndStartGame(io, gameIdKey);
        } else if (status && status.player2) {
          console.log('⚠️ Player 2 already marked as completed for game:', gameIdKey);
        }
      } else {
        console.log('⚠️ No onchainStatus found for game:', gameIdKey, 'Available games:', Array.from(onchainStatus.keys()));
      }
    } else {
      console.error('❌ No gameId in onchain_game_joined event:', data);
    }
  });
}

/**
 * Check if both players completed on-chain setup and start the game
 */
function checkAndStartGame(io, gameId) {
  // Ensure gameId is a string for consistency
  const gameIdKey = String(gameId);
  const status = onchainStatus.get(gameIdKey);
  console.log('🎮 [checkAndStartGame] Checking game:', gameIdKey, 'Status:', status);
  if (status && status.player1 && status.player2) {
    console.log('🚀 Both players completed on-chain setup, starting game:', gameIdKey);
    
    // Get game state - try both string and original format
    let game = gameManager.getGame(gameIdKey);
    if (!game) {
      game = gameManager.getGame(gameId);
    }
    if (!game) {
      console.error('Game not found:', gameId);
      onchainStatus.delete(gameId);
      return;
    }
    
    // Clean up status
    onchainStatus.delete(gameIdKey);
    
    // Emit game_started to all players - use the game's actual ID
    const actualGameId = game.gameId || gameIdKey;
    console.log('📤 Emitting game_started with gameId:', actualGameId);
    io.to(actualGameId).emit('game_started', {
      gameId: actualGameId,
      gameState: game
    });
    
    // Start the first round timer
    setTimeout(() => {
      startRoundTimer(actualGameId, io, 15); // Timer for first round
    }, 2000);
  }
}

/**
 * Handle onchain_game_created event (can be called from global handler)
 */
function handleOnchainGameCreated(socket, io, data) {
  console.log('📥 [handleOnchainGameCreated] Processing event:', data, 'from socket:', socket.id);
  const { gameId } = data || {};
  const gameIdKey = gameId ? String(gameId) : null;
  if (gameIdKey) {
    console.log('🔍 Checking onchainStatus for game:', gameIdKey, 'Status exists:', onchainStatus.has(gameIdKey));
    console.log('🔍 Available gameIds in onchainStatus:', Array.from(onchainStatus.keys()));
    if (onchainStatus.has(gameIdKey)) {
      const status = onchainStatus.get(gameIdKey);
      console.log('📊 Current status:', status);
      if (status && !status.player1) {
        status.player1 = true;
        console.log('✅ Player 1 on-chain game created for game:', gameIdKey);
        console.log('📊 Updated status:', onchainStatus.get(gameIdKey));
        
        // Get game state to send trigger to player 2
        const gameState = gameManager.getGame(gameIdKey);
        if (gameState && gameState.player2 && gameState.player2.socketId) {
          console.log('📤 Now triggering player2 to complete their transaction...');
          
          // Use different events based on game type
          const eventName = gameState.gameType === 'private' ? 'game_started_pre_tx' : 'join_onchain_game';
          
          io.to(gameState.player2.socketId).emit(eventName, {
            gameId: gameIdKey,
            gameState: {
              ...gameState,
              gameId: gameIdKey
            },
            playerType: 'player2' // Explicitly tell them they're player2
          });
        }
        
        checkAndStartGame(io, gameIdKey);
      } else if (status && status.player1) {
        console.log('⚠️ Player 1 already marked as completed for game:', gameIdKey);
      }
    } else {
      console.log('⚠️ No onchainStatus found for game:', gameIdKey, 'Available games:', Array.from(onchainStatus.keys()));
    }
  } else {
    console.error('❌ No gameId in onchain_game_created event:', data);
  }
}

/**
 * Handle onchain_game_joined event (can be called from global handler)
 */
function handleOnchainGameJoined(socket, io, data) {
  console.log('📥 [handleOnchainGameJoined] Processing event:', data, 'from socket:', socket.id);
  const { gameId } = data || {};
  const gameIdKey = gameId ? String(gameId) : null;
  if (gameIdKey) {
    console.log('🔍 Checking onchainStatus for game:', gameIdKey, 'Status exists:', onchainStatus.has(gameIdKey));
    console.log('🔍 Available gameIds in onchainStatus:', Array.from(onchainStatus.keys()));
    if (onchainStatus.has(gameIdKey)) {
      const status = onchainStatus.get(gameIdKey);
      console.log('📊 Current status:', status);
      if (status && !status.player2) {
        status.player2 = true;
        console.log('✅ Player 2 on-chain game joined for game:', gameIdKey);
        console.log('📊 Updated status:', onchainStatus.get(gameIdKey));
        checkAndStartGame(io, gameIdKey);
      } else if (status && status.player2) {
        console.log('⚠️ Player 2 already marked as completed for game:', gameIdKey);
      }
    } else {
      console.log('⚠️ No onchainStatus found for game:', gameIdKey, 'Available games:', Array.from(onchainStatus.keys()));
    }
  } else {
    console.error('❌ No gameId in onchain_game_joined event:', data);
  }
}

/**
 * Handle player disconnection
 */
function handleSocketConnection(socket, io) {
  console.log(`New socket connection: ${socket.id}`);
  
  // Set up on-chain completion handlers for this socket
  setupOnchainHandlersForSocket(socket, io);
  console.log(`✅ On-chain handlers set up for socket: ${socket.id}`);

  // Store current player ID when available
  let currentPlayerId = null;
  
  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
    
    // Get player ID associated with this socket
    const playerId = socketPlayers.get(socket.id);
    
    if (playerId) {
      console.log(`Player ${playerId} disconnected`);
      
      // Find if player is in a game
      const gameId = gameManager.getPlayerGame(playerId);
      
      if (gameId) {
        const game = gameManager.getGame(gameId);
        
        if (game) {
          // Notify other players in the game
          socket.to(gameId).emit('player_disconnected', {
            gameId,
            disconnectedPlayerId: playerId,
            gameState: game
          });
          
          // If game is in progress, handle as forfeit after a delay
          if (game.gameStatus === 'playing') {
            console.log(`Player ${playerId} disconnected during active game`);
            
            // Wait a short time before handling as forfeit (in case of reconnect)
            setTimeout(() => {
              // Check if player is still disconnected
              if (!playerSockets.has(playerId)) {
                console.log(`Player ${playerId} did not reconnect, handling as forfeit`);
                
                // Determine winner (the player who didn't disconnect)
                const winner = game.player1.id === playerId ? game.player2.id : game.player1.id;
                
                // Finalize game
                io.to(gameId).emit('game_finished', {
                  gameId,
                  winner: {
                    playerId: winner,
                    reason: 'opponent_disconnect'
                  },
                  gameState: game
                });
                
                // Clean up game
                gameManager.removeGame(gameId);
              }
            }, 5000); // 5 second grace period for reconnection
          }
        }
      }
      
      // Clean up player mappings
      playerSockets.delete(playerId);
      socketPlayers.delete(socket.id);
    }
  });
  
  // Create a new game
  socket.on('create_game', async (data) => {
    try {
      const { stakeAmount, gameType, currency, playerId, playerWallet } = data;
      const gameId = data.gameId || uuidv4();
      
      console.log(`Creating ${currency} game with stake ${stakeAmount}:`, data);
      
      // Store player ID and socket mapping
      currentPlayerId = playerId;
      playerSockets.set(playerId, socket.id);
      socketPlayers.set(socket.id, playerId);
      
      // For SOL games, verify on-chain game creation
      if (currency === 'sol' && idl) {
        try {
          // Create a read-only provider (we don't need to sign anything here)
          const provider = new anchor.AnchorProvider(
            connection,
            { publicKey: new PublicKey(playerWallet) },
            { commitment: 'confirmed' }
          );
          
          // Add address to IDL for Anchor compatibility
          const idlWithAddress = { ...idl, address: PROGRAM_ID.toString() };
          const program = new anchor.Program(idlWithAddress, provider);
          
          // Check if the game exists on-chain
          const gamePDA = findGamePDA(gameId);
          try {
            console.log(`Checking if game ${gameId} exists on-chain at address ${gamePDA.toString()}`);
            const gameAccount = await program.account.game.fetchNullable(gamePDA);
            
            if (!gameAccount) {
              console.log(`Game ${gameId} not found on-chain. Creating game in backend only.`);
              // Continue with backend creation even if not on-chain yet
              // This allows the frontend to show the game while waiting for the blockchain transaction
            } else {
              console.log('Game exists on-chain:', gameAccount.gameId);
              
              // Verify game parameters
              if (gameAccount.gameId !== gameId) {
                console.error(`Game ID mismatch: ${gameAccount.gameId} vs ${gameId}`);
                socket.emit('error', { message: 'Game ID mismatch with on-chain game' });
                return;
              }
              
              if (!gameAccount.player1.equals(new PublicKey(playerWallet))) {
                console.error(`Creator wallet mismatch: ${gameAccount.player1.toString()} vs ${playerWallet}`);
                socket.emit('error', { message: 'Creator wallet mismatch with on-chain game' });
                return;
              }
              
              console.log('SOL game verified on-chain, proceeding with backend creation');
            }
          } catch (error) {
            console.error('Error fetching game from chain:', error);
            // Continue with backend creation even if not on-chain yet
            console.log(`Game ${gameId} not found on-chain. Creating game in backend only.`);
          }
        } catch (error) {
          console.error('Error verifying on-chain game:', error);
          // Continue with backend creation even if verification fails
          console.log('Proceeding with backend game creation despite verification error');
        }
      }
      
      // Create game in backend
      const result = await gameManager.createGame(
        gameType, 
        stakeAmount,
        currency,
        playerId,
        socket.id,
        playerWallet,
        gameId  // Pass the gameId from frontend
      );
      
      if (result.success) {
        // Join the socket room for this game
        socket.join(result.gameId);
        
        // For SOL private games, initialize onchainStatus tracking
        if (result.gameState && result.gameState.currency === 'sol' && result.gameState.gameType === 'private') {
          const gameIdKey = String(result.gameId);
          if (!onchainStatus.has(gameIdKey)) {
            onchainStatus.set(gameIdKey, {
              player1: false,
              player2: false
            });
            console.log('📝 [create_game] Initialized onchainStatus for SOL private game:', gameIdKey);
          } else {
            console.log('📝 [create_game] onchainStatus already exists for game:', gameIdKey);
          }
        }
        
        // Send game created event
        socket.emit('game_created', result);
        
        console.log(`Game created: ${result.gameId}`);
      } else {
        socket.emit('error', { message: result.error || 'Failed to create game' });
      }
    } catch (error) {
      console.error('Create game error:', error);
      socket.emit('error', { message: 'Failed to create game' });
    }
  });
  
  // Join an existing game
  socket.on('join_game', async (data) => {
    try {
      const { gameId, playerId, playerWallet, currency } = data;
      
      console.log(`Player ${playerId} joining game ${gameId}`);
      
      // Store player ID and socket mapping
      currentPlayerId = playerId;
      playerSockets.set(playerId, socket.id);
      socketPlayers.set(socket.id, playerId);
      
      // Get the game
      const game = gameManager.getGame(gameId);
      
      if (!game) {
        socket.emit('error', { message: 'Game not found' });
        return;
      }
      
      // For SOL games, verify on-chain game join
      if (game.currency === 'sol' && idl) {
        try {
          // Create a read-only provider (we don't need to sign anything here)
          const provider = new anchor.AnchorProvider(
            connection,
            { publicKey: new PublicKey(playerWallet) },
            { commitment: 'confirmed' }
          );
          
          // Add address to IDL for Anchor compatibility
          const idlWithAddress = { ...idl, address: PROGRAM_ID.toString() };
          const program = new anchor.Program(idlWithAddress, provider);
          
          // Check if the game exists on-chain
          const gamePDA = findGamePDA(gameId);
          try {
            console.log(`Checking if game ${gameId} exists on-chain at address ${gamePDA.toString()}`);
            const gameAccount = await program.account.game.fetchNullable(gamePDA);
            
            if (!gameAccount) {
              console.log(`Game ${gameId} not found on-chain. Proceeding with backend join only.`);
              // Continue with backend join even if not on-chain yet
            } else {
              console.log('Game exists on-chain:', gameAccount.gameId);
              
              // Verify game parameters
              if (gameAccount.gameId !== gameId) {
                console.error(`Game ID mismatch: ${gameAccount.gameId} vs ${gameId}`);
                socket.emit('error', { message: 'Game ID mismatch with on-chain game' });
                return;
              }
              
              // Check if player2 has joined on-chain
              if (gameAccount.player2 && gameAccount.player2.equals(new PublicKey(playerWallet))) {
                console.log('Player has joined on-chain, proceeding with backend join');
              } else if (!gameAccount.player2) {
                console.log('Player2 not yet joined on-chain. Proceeding with backend join only.');
                // Continue with backend join even if not on-chain yet
              } else if (gameAccount.player2 && !gameAccount.player2.equals(new PublicKey(playerWallet))) {
                console.error(`Player2 wallet mismatch: ${gameAccount.player2.toString()} vs ${playerWallet}`);
                socket.emit('error', { message: 'Player wallet mismatch with on-chain game' });
                return;
              }
            }
          } catch (error) {
            console.error('Error fetching game from chain:', error);
            // Continue with backend join even if not on-chain yet
            console.log(`Game ${gameId} not found on-chain. Proceeding with backend join only.`);
          }
        } catch (error) {
          console.error('Error verifying on-chain game join:', error);
          // Continue with backend join even if verification fails
          console.log('Proceeding with backend join despite verification error');
        }
      }
      
      // Join the game in backend
      const result = await gameManager.joinGame(gameId, playerId, socket.id, playerWallet);
      
      if (result.success) {
        // Join the socket room for this game
        socket.join(gameId);
        
        // For SOL private games, initialize onchainStatus tracking if not already initialized
        // This ensures tracking is set up even if player1 hasn't completed their transaction yet
        if (result.gameState && result.gameState.currency === 'sol' && result.gameState.gameType === 'private') {
          const gameIdKey = String(gameId);
          if (!onchainStatus.has(gameIdKey)) {
            onchainStatus.set(gameIdKey, {
              player1: false,
              player2: false
            });
            console.log('📝 [join_game] Initialized onchainStatus for SOL private game:', gameIdKey);
          } else {
            console.log('📝 [join_game] onchainStatus already exists for game:', gameIdKey, 'Status:', onchainStatus.get(gameIdKey));
          }
        }
        
        // Send events
        socket.emit('game_joined', result);
        socket.to(gameId).emit('player_joined', result);
        
        // If both players are present and game is ready to start
        if (
          result.gameState &&
          result.gameState.player1 &&
          result.gameState.player2 &&
          result.gameState.gameStatus === 'playing'
        ) {
          // For SOL private games, wait for both on-chain transactions before starting
          if (result.gameState.currency === 'sol' && result.gameState.gameType === 'private') {
            console.log('🔗 SOL private game - emitting pre-tx event and waiting for both transactions...');
            
            const gameState = result.gameState;
            
            // onchainStatus should already be initialized when player2 joined
            // Just verify it exists and log status
            const gameIdKey = String(gameId);
            if (!onchainStatus.has(gameIdKey)) {
              // Fallback: initialize if somehow not set (shouldn't happen)
              onchainStatus.set(gameIdKey, {
                player1: false,
                player2: false
              });
              console.log('⚠️ [join_game] Had to initialize onchainStatus as fallback for game:', gameIdKey);
            } else {
              console.log('📝 [join_game] onchainStatus verified for game:', gameIdKey, 'Status:', onchainStatus.get(gameIdKey));
            }
            
            // Handlers are already set up for all sockets in handleSocketConnection
            
            // Emit pre-transaction event ONLY to player1 first
            // Player2 will receive their trigger after player1 completes their transaction
            console.log('📤 Emitting game_started_pre_tx ONLY to player1:', gameState.player1.socketId);
            io.to(gameState.player1.socketId).emit('game_started_pre_tx', {
              gameId: gameIdKey,
              gameState: {
                ...gameState,
                gameId: gameIdKey  // Ensure gameId in gameState matches the key
              },
              playerType: 'player1' // Explicitly tell them they're player1
            });
            
            console.log('⏳ Waiting for player1 to complete on-chain transaction first...');
            console.log('📊 Current onchainStatus:', onchainStatus.get(gameIdKey));
          } else {
            // For points games or public games, start immediately
            io.to(gameId).emit('game_started', {
              gameId,
              gameState: result.gameState
            });
            
            setTimeout(() => {
              startRoundTimer(gameId, io, 15);
            }, 1000);
          }
        }

        console.log(`Player ${playerId} joined game ${gameId}`);
      } else {
        socket.emit('error', { message: result.error || 'Failed to join game' });
      }
    } catch (error) {
      console.error('Join game error:', error);
      socket.emit('error', { message: 'Failed to join game' });
    }
  });

  /**
   * Find random match (public matchmaking)
   */
  socket.on('find_random_match', async (data) => {
    try {
      const { 
        stakeAmount = 0, 
        currency = 'points',
        playerId: clientPlayerId, 
        playerWallet 
      } = data;
      
      // Set playerId from client data if provided
      if (clientPlayerId && !currentPlayerId) { // Use currentPlayerId from handleSocketConnection
        currentPlayerId = clientPlayerId;
        console.log(`Player ID set from find_random_match: ${currentPlayerId}`);
      }
      
      const currentPlayerIdForGame = currentPlayerId || socket.id;
      
      const result = await gameManager.findRandomMatch(
        currentPlayerIdForGame, 
        socket.id, 
        stakeAmount, 
        currency, 
        playerWallet
      );
      
      if (result.success) {
        // Join socket room for this game
        socket.join(result.gameId);
        console.log(`Random match for ${currentPlayerIdForGame}: ${result.gameId} (${currency} game)`);
        
        socket.emit('match_found', result);
        
        // Notify all players in the game
        io.to(result.gameId).emit('game_state_updated', {
          gameState: result.gameState,
          event: 'match_found'
        });

        // If game started immediately (matched with waiting player)
        if (result.gameStarted) {
          const gameState = result.gameState;
          
          // For SOL games, wait for on-chain transactions
          if (gameState.currency === 'sol') {
            // Initialize on-chain completion tracking for this game
            if (!onchainStatus.has(result.gameId)) {
              onchainStatus.set(result.gameId, {
                player1: false,
                player2: false
              });
            }
            
            // Emit ONLY to player1 first - player2 will get triggered after player1 completes
            // This ensures sequential execution and prevents both popups at once
            console.log('📤 Emitting create_onchain_game ONLY to player1:', gameState.player1.socketId);
            io.to(gameState.player1.socketId).emit('create_onchain_game', {
              gameId: result.gameId,
              stakeAmount: gameState.stakeAmount,
              currency: gameState.currency,
              gameState: gameState
            });
            
            // Player2 will receive join_onchain_game after player1 completes (handled in onchain_game_created handler)
            console.log('⏳ Waiting for player1 to complete on-chain transaction first for public match...');
          } else {
            // For points games, start immediately
            io.to(result.gameId).emit('game_started', {
              gameId: result.gameId,
              gameState: gameState
            });
            
            setTimeout(() => {
              startRoundTimer(result.gameId, io, 15);
            }, 1000);
          }
        }
      } else {
        console.log('Random match failed:', result.error);
        socket.emit('error', result);
      }
    } catch (error) {
      console.error('Random match error:', error);
      socket.emit('error', { message: 'Failed to find match' });
    }
  });

  // start_game socket handler removed - games now start automatically when both players join

  /**
   * Submit a move (rock/paper/scissors) - FORCE DIRECT REGISTRATION
   */
  console.log('🔧 Registering submit_move handler for socket:', socket.id);
  
  // Test handler to verify custom events work
  socket.on('submit_rock', (data) => {
    console.log('🪨 SUBMIT_ROCK received:', data);
    // Process as rock move
    const result = gameManager.submitMove(data.playerId, 'rock');
    if (result.success) {
      socket.emit('move_submitted', { success: true, move: 'rock', gameState: result.gameState });
    }
  });
  
  socket.on('submit_move', (data) => {
    console.log('🎯 SUBMIT_MOVE EVENT RECEIVED', data);
    try {
      console.log('📥 Move submission received:', data);
      console.log('   - Current playerId (socket handler):', currentPlayerId);
      console.log('   - Socket ID:', socket.id);
      console.log('   - Data playerId:', data.playerId);
      console.log('   - Data gameId:', data.gameId);
      
      const { move, playerId: dataPlayerId, gameId: dataGameId } = data;
      
      // Use the playerId from the move data if available, otherwise fall back to stored playerId or socket.id
      const currentPlayerIdForMove = dataPlayerId || currentPlayerId || socket.id;
      
      console.log('   - Final playerId for move:', currentPlayerIdForMove);
      console.log('   - Move:', move);
      console.log('   - Requested gameId:', dataGameId);
      
      // Submit the move - pass gameId to help with fallback search if playerGames is empty
      const result = gameManager.submitMove(currentPlayerIdForMove, move, dataGameId);
      
      if (result.success) {
        console.log(`Move submitted by ${currentPlayerIdForMove}: ${move}`);
        
        // Confirm move to ALL players in the game room
        io.to(result.gameId).emit('move_submitted', {
          success: true,
          playerId: currentPlayerIdForMove,
          move,
          gameState: result.gameState
        });

        // Notify other player that a move was submitted (without revealing the move)
        socket.to(result.gameId).emit('opponent_move_submitted', {
          gameId: result.gameId,
          bothMovesSubmitted: result.gameState.player1.currentMove && result.gameState.player2.currentMove
        });

        // If round is complete, clear timer and broadcast results
        if (result.roundComplete) {
          // Clear the timer since round is complete
          if (gameTimers.has(result.gameId)) {
            clearInterval(gameTimers.get(result.gameId));
            gameTimers.delete(result.gameId);
          }
          
          // For final round, don't emit round_completed immediately
          // Instead show suspense screen and then reveal winner
          if (result.roundResult.gameFinished) {
            console.log('🎬 Final round - showing suspense screen before revealing winner');
            
            // No delay - show result immediately
            console.log('🏆 Revealing final winner immediately');
            handleGameFinished(result.gameId, result.gameState, io);
          } else {
            // Regular round - emit round_completed immediately
            io.to(result.gameId).emit('round_completed', {
              gameId: result.gameId,
              roundResult: result.roundResult,
              gameState: result.gameState
            });
            
            // Start next round immediately
            startNextRound(result.gameId, io);
          }
        }

        // Update game state for all players
        io.to(result.gameId).emit('game_state_updated', {
          gameState: result.gameState,
          event: 'move_processed'
        });
      } else {
        socket.emit('error', result);
      }
    } catch (error) {
      console.error('Submit move error:', error);
      socket.emit('error', { message: 'Failed to submit move' });
    }
  });

  /**
   * Get current game state
   */
  socket.on('get_game_state', () => {
    try {
      const currentPlayerIdForState = currentPlayerId || socket.id;
      const gameState = gameManager.getPlayerGame(currentPlayerIdForState);
      
      if (gameState) {
        socket.emit('game_state', {
          success: true,
          gameState
        });
      } else {
        socket.emit('game_state', {
          success: false,
          message: 'Not in any game'
        });
      }
    } catch (error) {
      console.error('Get game state error:', error);
      socket.emit('error', { message: 'Failed to get game state' });
    }
  });

  /**
   * Get server statistics
   */
  socket.on('get_stats', () => {
    try {
      const stats = gameManager.getStats();
      socket.emit('server_stats', stats);
    } catch (error) {
      console.error('Get stats error:', error);
      socket.emit('error', { message: 'Failed to get stats' });
    }
  });



  /**
   * Leave current game
   */
  // Handle player declining invitation to private game
  socket.on('player_declined_invitation', async (data = {}) => {
    try {
      const { gameId } = data;
      
      if (!gameId) {
        console.log('⚠️ player_declined_invitation: No gameId provided');
        return;
      }
      
      console.log(`❌ Player declined invitation to game ${gameId}`);
      
      const game = gameManager.getGame(gameId);
      
      if (!game) {
        console.log(`⚠️ Game ${gameId} not found`);
        return;
      }
      
      console.log(`🔍 Game state check:`, {
        gameType: game.gameType,
        gameStatus: game.gameStatus,
        hasPlayer1: !!game.player1,
        player1SocketId: game.player1?.socketId
      })
      
      // Only notify for private games that are still waiting for a player
      if (game.gameType === 'private' && 
          game.gameStatus === 'waiting_for_player' && 
          game.player1 && 
          game.player1.socketId) {
        
        console.log(`📤 Notifying game creator (player1) that invitation was declined for game ${gameId}`);
        console.log(`📤 Player1 socket ID: ${game.player1.socketId}`);
        
        // Notify the game creator
        io.to(game.player1.socketId).emit('player_declined_invitation', {
          gameId,
          message: 'Player declined your invitation'
        });
        
        console.log(`✅ Decline notification sent to player1 socket: ${game.player1.socketId}`);
        
        // Optionally clean up the game if you want to automatically remove it
        // For now, we'll just notify and let the creator decide
      } else {
        console.log(`⚠️ Cannot notify - conditions not met:`, {
          isPrivate: game.gameType === 'private',
          isWaiting: game.gameStatus === 'waiting_for_player',
          hasPlayer1: !!game.player1,
          hasSocketId: !!game.player1?.socketId
        })
      }
    } catch (error) {
      console.error('Error handling player_declined_invitation:', error);
    }
  });

  socket.on('leave_game', async (data = {}) => {
    try {
      const { gameId: dataGameId, playerId: dataPlayerId } = data;
      const currentPlayerIdForLeave = dataPlayerId || currentPlayerId || socket.id;
      
      console.log(`Player ${currentPlayerIdForLeave} leaving game via leave_game event`);
      
      // If gameId is provided, get the game state for opponent notification
      if (dataGameId) {
        const gameState = gameManager.getGame(dataGameId);
        if (gameState && gameState.gameStatus === 'playing') {
          // This is a quit during active gameplay - handle as forfeit
          let opponent = null;
          
          if (gameState.player1.id === currentPlayerIdForLeave) {
            opponent = gameState.player2;
          } else if (gameState.player2.id === currentPlayerIdForLeave) {
            opponent = gameState.player1;
          }
          
          if (opponent && opponent.id) {
            // Mark opponent as winner
            gameState.winner = opponent.id;
            gameState.gameStatus = 'finished';
            
            console.log(`Game ${dataGameId} finished - ${opponent.id} wins by opponent forfeit`);
            
            // Clear any timers for this game
            if (gameTimers.has(dataGameId)) {
              clearInterval(gameTimers.get(dataGameId));
              gameTimers.delete(dataGameId);
            }
            
            // Process abandonment in database for points games
            const abandonmentResult = {
              winner: opponent === gameState.player1 ? 'player1' : 'player2',
              quittingPlayer: gameState.player1.id === currentPlayerIdForLeave ? 'player1' : 'player2',
              reason: 'opponent_quit'
            };
            
            // Process game abandonment completion for database updates
            await gameManager.processGameAbandonmentCompletion(dataGameId, gameState, abandonmentResult);
            
            // Notify opponent they won
            io.to(dataGameId).emit('game_finished', {
              gameId: dataGameId,
              gameState,
              winner: {
                playerId: opponent.id,
                position: opponent === gameState.player1 ? 'player1' : 'player2',
                reason: 'opponent_quit'
              },
              finalScores: {
                player1: gameState.player1.wins,
                player2: gameState.player2.wins
              },
              payout: {
                totalPot: gameState.totalPot,
                winnerPayout: gameState.winnerPayout,
                platformFee: gameState.platformFee
              },
              quitReason: 'player_quit'
            });
            
            // Update game state
            io.to(dataGameId).emit('game_state_updated', {
              gameState,
              event: 'player_quit'
            });
          }
        }
      }
      
      const result = gameManager.removePlayer(currentPlayerIdForLeave);
      
      if (result.success) {
        console.log(`Player ${currentPlayerIdForLeave} left game: ${result.gameId}`);
        
        // Clear any timers for this game
        if (gameTimers.has(result.gameId)) {
          clearInterval(gameTimers.get(result.gameId));
          gameTimers.delete(result.gameId);
        }
        
        // Leave socket room
        socket.leave(result.gameId);
        
        socket.emit('game_left', {
          success: true,
          gameId: result.gameId
        });

        // Notify remaining players (only if not already handled above as forfeit)
        if (result.gameState.gameStatus !== 'finished') {
          socket.to(result.gameId).emit('player_left', {
            gameId: result.gameId,
            leftPlayerId: currentPlayerIdForLeave,
            gameState: result.gameState
          });
        }
      } else {
        socket.emit('error', result);
      }
    } catch (error) {
      console.error('Leave game error:', error);
      socket.emit('error', { message: 'Failed to leave game' });
    }
  });

  /**
   * Handle player disconnection
   */
  // This block is now handled by the new handleSocketConnection function
}

/**
 * Get current onchainStatus for debugging
 */
function getOnchainStatus() {
  const status = {};
  for (const [gameId, data] of onchainStatus.entries()) {
    status[gameId] = data;
  }
  return status;
}

module.exports = { 
  handleSocketConnection,
  handleOnchainGameCreated,
  handleOnchainGameJoined,
  getOnchainStatus
}; 