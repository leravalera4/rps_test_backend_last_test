/**
 * Rock Paper Scissors Game Logic
 * Core game mechanics for RPS MagicBlock Game
 */

const { 
  VALID_MOVES, 
  WINNING_SCORE, 
  PLATFORM_FEE_PERCENTAGE, 
  WINNER_PAYOUT_PERCENTAGE 
} = require('../utils/constants');

/**
 * Determine the winner of a single round
 * @param {string} move1 - Player 1's move
 * @param {string} move2 - Player 2's move
 * @returns {string} - 'player1', 'player2', or 'draw'
 */
function determineWinner(move1, move2) {
  if (!VALID_MOVES.includes(move1) || !VALID_MOVES.includes(move2)) {
    throw new Error('Invalid move provided');
  }

  if (move1 === move2) {
    return 'draw';
  }

  // Rock beats Scissors, Scissors beats Paper, Paper beats Rock
  const winConditions = {
    'rock': 'scissors',
    'scissors': 'paper', 
    'paper': 'rock'
  };

  return winConditions[move1] === move2 ? 'player1' : 'player2';
}

/**
 * Create a new game state
 * @param {string} gameId - Game ID
 * @param {string} gameType - 'private' or 'public'
 * @param {number} stakeAmount - Amount staked (points or SOL)
 * @param {string} currency - 'points' or 'sol'
 * @returns {object} - Initial game state
 */
function createGameState(gameId, gameType = 'private', stakeAmount = 0, currency = 'points') {
  // Calculate platform fee and winner payout
  let platformFee = 0;
  let winnerPayout = stakeAmount * 2; // Default for points
  
  // For SOL games, apply dynamic platform fee based on stake amount
  if (currency === 'sol') {
    const feeRate = stakeAmount <= 0.01 ? 0.05 : stakeAmount <= 0.05 ? 0.03 : 0.02;
    platformFee = stakeAmount * 2 * feeRate; // Remove Math.floor for SOL calculations
    winnerPayout = (stakeAmount * 2) - platformFee;
  }
  
  return {
    gameId,
    gameType,
    currency,
    stakeAmount,
    totalPot: stakeAmount * 2, // Will be updated when player 2 joins
    platformFee,
    winnerPayout,
    player1: {
      id: null,
      socketId: null,
      wallet: null,
      wins: 0,
      currentMove: null,
      ready: false,
      stakeDeposited: false
    },
    player2: {
      id: null,
      socketId: null,
      wallet: null,
      wins: 0,
      currentMove: null,
      ready: false,
      stakeDeposited: false
    },
    currentRound: 1,
    gameStatus: 'waiting_for_player',
    winner: null,
    moveHistory: [],
    createdAt: new Date().toISOString()
  };
}

/**
 * Process a player's move and update game state
 * @param {object} gameState - Current game state
 * @param {string} playerId - Player making the move
 * @param {string} move - The move (rock/paper/scissors)
 * @returns {object} - Updated game state and round result
 */
function processMove(gameState, playerId, move) {
  if (!VALID_MOVES.includes(move)) {
    throw new Error(`Invalid move: ${move}`);
  }

  if (gameState.gameStatus !== 'playing') {
    throw new Error('Game is not in playing state');
  }

  // Determine which player made the move
  const isPlayer1 = gameState.player1.id === playerId;
  const isPlayer2 = gameState.player2.id === playerId;

  if (!isPlayer1 && !isPlayer2) {
    throw new Error('Player not in this game');
  }

  // Update player's move
  if (isPlayer1) {
    gameState.player1.currentMove = move;
  } else {
    gameState.player2.currentMove = move;
  }
    
  // Check if both players have made their moves
  if (gameState.player1.currentMove && gameState.player2.currentMove) {
    return processRound(gameState);
  }

  return {
    gameState,
    roundComplete: false,
    roundResult: null
  };
}
  
/**
 * Process a complete round when both players have moved
 * @param {object} gameState - Current game state
 * @returns {object} - Updated game state and round result
 */
function processRound(gameState) {
  const move1 = gameState.player1.currentMove;
  const move2 = gameState.player2.currentMove;
  
  // Determine round winner
  const roundWinner = determineWinner(move1, move2);
  
  // Create round history entry with CURRENT round number (before incrementing)
  const roundHistory = {
    round: gameState.currentRound,
    player1Move: move1,
    player2Move: move2,
    winner: roundWinner,
    timestamp: new Date().toISOString()
  };
  
  gameState.moveHistory.push(roundHistory);
  
  // Update wins only if not a draw
  if (roundWinner === 'player1') {
    gameState.player1.wins++;
  } else if (roundWinner === 'player2') {
    gameState.player2.wins++;
  }
  
  // Check for game winner (first to 3 wins)
  let gameWinner = null;
  if (gameState.player1.wins >= WINNING_SCORE) {
    gameWinner = 'player1';
    gameState.gameStatus = 'finished';
    gameState.winner = gameState.player1.id;
    console.log(`🏆 Player 1 wins! ID: ${gameState.player1.id}, Wallet: ${gameState.player1.wallet}`);
  } else if (gameState.player2.wins >= WINNING_SCORE) {
    gameWinner = 'player2';
    gameState.gameStatus = 'finished';
    gameState.winner = gameState.player2.id;
    console.log(`🏆 Player 2 wins! ID: ${gameState.player2.id}, Wallet: ${gameState.player2.wallet}`);
  }
  
  // DON'T increment round number here - it will be incremented when next round starts
  // This keeps the round number consistent with what was just played
  
  // DON'T reset current moves here - let frontend display them first
  // They will be reset when next round starts
  
  return {
    gameState,
    roundComplete: true,
    roundResult: {
      round: roundHistory.round, // Use the round number from history (current round that just completed)
      moves: { player1: move1, player2: move2 },
      roundWinner,
      gameWinner,
      scores: {
        player1: gameState.player1.wins,
        player2: gameState.player2.wins
      },
      gameFinished: gameState.gameStatus === 'finished'
    }
  };
}

/**
 * Add a player to the game
 * @param {object} gameState - Current game state
 * @param {string} playerId - Player identifier
 * @param {string} socketId - Socket connection ID
 * @param {string} walletAddress - Player's wallet address
 * @returns {object} - Updated game state and player position
 */
function addPlayer(gameState, playerId, socketId, walletAddress = null) {
  // Check if this player was previously in the game and reclaim their position
  if (gameState.player1.id === playerId) {
    // Player1 rejoining - update socket and clear moves for new game
    gameState.player1.socketId = socketId;
    if (walletAddress) {
      gameState.player1.wallet = walletAddress;
    }
    // Clear previous game state when rejoining
    gameState.player1.currentMove = null;
    gameState.player1.ready = false;
    return { gameState, playerPosition: 'player1' };
  }
  
  if (gameState.player2.id === playerId) {
    // Player2 rejoining - update socket and clear moves for new game
    gameState.player2.socketId = socketId;
    if (walletAddress) {
      gameState.player2.wallet = walletAddress;
    }
    // Clear previous game state when rejoining
    gameState.player2.currentMove = null;
    gameState.player2.ready = false;
    // Check if both players are now present and start automatically if not playing yet
    if (gameState.player1.id && gameState.player2.id && gameState.gameStatus === 'waiting_for_player') {
      gameState.gameStatus = 'playing';
      gameState.currentRound = 1;
    }
    return { gameState, playerPosition: 'player2' };
  }

  // New player joining
  if (gameState.player1.id === null) {
    gameState.player1.id = playerId;
    gameState.player1.socketId = socketId;
    gameState.player1.wallet = walletAddress;
    return { gameState, playerPosition: 'player1' };
  } else if (gameState.player2.id === null) {
    gameState.player2.id = playerId;
    gameState.player2.socketId = socketId;
    gameState.player2.wallet = walletAddress;
    // Start game automatically when both players join
    gameState.gameStatus = 'playing';
    gameState.currentRound = 1;
    return { gameState, playerPosition: 'player2' };
  } else {
    throw new Error('Game is full');
  }
}

/**
 * Validate if a game state is valid
 * @param {object} gameState - Game state to validate
 * @returns {boolean} - True if valid
 */
function validateGameState(gameState) {
  return (
    gameState &&
    typeof gameState.gameId === 'string' &&
    ['waiting_for_player', 'playing', 'finished'].includes(gameState.gameStatus) &&
    gameState.player1 &&
    gameState.player2 &&
    typeof gameState.currentRound === 'number' &&
    Array.isArray(gameState.moveHistory)
  );
}

module.exports = {
  VALID_MOVES,
  WINNING_SCORE,
  determineWinner,
  createGameState,
  processMove,
  processRound,
  addPlayer,
  validateGameState
}; 