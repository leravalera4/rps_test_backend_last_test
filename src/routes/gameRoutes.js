/**
 * Game API Routes
 * HTTP REST endpoints for RPS game management
 */

const express = require('express');
const router = express.Router();

// Use singleton GameManager instance shared with socket handlers
const gameManager = require('../game/gameManagerSingleton');
const databaseService = require('../services/databaseService');
const ReferralService = require('../services/referralService');
// socketHandlers will be passed via route initialization - see server.js
let socketHandlersRef = null;
let ioRef = null;

// Initialize socket handlers reference (called from server.js)
function initializeSocketHandlers(socketHandlers, io) {
  socketHandlersRef = socketHandlers;
  ioRef = io;
}

// Initialize referral service
const referralService = new ReferralService();

/**
 * GET /api/games/winnings
 * Get recent game winnings for display
 */
router.get('/winnings', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    
    console.log('📊 Fetching winnings history:', { limit, offset });
    
    const winnings = await databaseService.getWinningsHistory(limit, offset);
    
    const response = {
      success: true,
      winnings: winnings || [],
      hasMore: winnings?.length === limit
    };
    
    console.log('📤 Sending winnings response:', {
      winningsCount: winnings?.length || 0,
      hasMore: response.hasMore,
      limit,
      offset
    });
    
    res.json(response);
  } catch (error) {
    console.error('Error fetching winnings:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/games/stats
 * Get server statistics (combines active game stats and database stats)
 */
router.get('/stats', async (req, res) => {
  try {
    // Get active game stats from GameManager
    const activeStats = gameManager.getStats();
    
    // Get historical stats from database
    const dbStats = await databaseService.getStats();
    
    // Combine both stats
    const combinedStats = {
      // Active game stats (from memory)
      activeGames: activeStats.activeGames,
      waitingGames: activeStats.waitingGames,
      totalPlayers: activeStats.totalPlayers,
      
      // Historical stats (from database)
      totalGames: dbStats.totalGames,
      totalUsers: dbStats.totalUsers,
      totalPointsGames: dbStats.totalPointsGames,
      totalSolGames: dbStats.totalSolGames,
      
      // Additional computed stats
      finishedGames: activeStats.finishedGames
    };
    
    console.log('📊 Combined stats:', combinedStats);
    
    res.json({
      success: true,
      stats: combinedStats
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get server stats'
    });
  }
});

/**
 * GET /api/games/:gameId
 * Get game information by ID
 */
router.get('/:gameId', (req, res) => {
  try {
    const { gameId } = req.params;
    const gameState = gameManager.getGame(gameId);
    
    if (!gameState) {
      return res.status(404).json({
        success: false,
        error: 'Game not found'
      });
    }

    // Return public game information (hide sensitive data like current moves)
    const publicGameInfo = {
      gameId: gameState.gameId,
      gameType: gameState.gameType,
      currency: gameState.currency,
      stakeAmount: gameState.stakeAmount,
      totalPot: gameState.totalPot,
      gameStatus: gameState.gameStatus,
      currentRound: gameState.currentRound,
      players: {
        player1: {
          id: gameState.player1.id,
          wins: gameState.player1.wins,
          connected: gameState.player1.socketId !== null
        },
        player2: {
          id: gameState.player2.id,
          wins: gameState.player2.wins,
          connected: gameState.player2.socketId !== null
        }
      },
      winner: gameState.winner,
      moveHistory: gameState.moveHistory,
      createdAt: gameState.createdAt
    };

    res.json({
      success: true,
      game: publicGameInfo
    });
  } catch (error) {
    console.error('Get game error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get game information'
    });
  }
});

/**
 * POST /api/games/create
 * Create a new game (HTTP alternative to WebSocket)
 */
router.post('/create', (req, res) => {
  try {
    const { gameType = 'public', stakeAmount = 0, currency = 'points', playerId } = req.body;
    
    if (!playerId) {
      return res.status(400).json({
        success: false,
        error: 'Player ID is required'
      });
    }

    const result = gameManager.createGame(gameType, stakeAmount, currency, playerId, null);
    
    res.json(result);
  } catch (error) {
    console.error('Create game error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create game'
    });
  }
});

/**
 * POST /api/games/:gameId/join
 * Join a game by ID (HTTP alternative to WebSocket)
 */
router.post('/:gameId/join', (req, res) => {
  try {
    const { gameId } = req.params;
    const { playerId } = req.body;
    
    if (!playerId) {
      return res.status(400).json({
        success: false,
        error: 'Player ID is required'
      });
    }

    const result = gameManager.joinGame(gameId, playerId, null);
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Join game error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to join game'
    });
  }
});

/**
 * GET /api/games/public/available
 * Get list of available public games for matchmaking
 */
router.get('/public/available', (req, res) => {
  try {
    const availableGames = [];
    
    for (const [gameId, gameState] of gameManager.games.entries()) {
      if (
        gameState.gameType === 'public' &&
        gameState.gameStatus === 'waiting_for_player'
      ) {
        availableGames.push({
          gameId: gameState.gameId,
          stakeAmount: gameState.stakeAmount,
          createdAt: gameState.createdAt,
          waitingFor: 'player2'
        });
      }
    }

    res.json({
      success: true,
      availableGames,
      count: availableGames.length
    });
  } catch (error) {
    console.error('Get available games error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get available games'
    });
  }
});

/**
 * POST /api/games/onchain/created
 * HTTP fallback endpoint for onchain_game_created event
 */
router.post('/onchain/created', (req, res) => {
  try {
    const { gameId } = req.body;
    
    if (!gameId) {
      return res.status(400).json({
        success: false,
        error: 'gameId is required'
      });
    }

    console.log('📥 [HTTP FALLBACK] Received onchain_game_created via HTTP for gameId:', gameId);
    
    // Process the event using socket handlers if available
    if (socketHandlersRef && ioRef) {
      // Create a dummy socket-like object for the handler
      const dummySocket = {
        id: 'http-fallback',
        emit: () => {},
        join: () => {},
        to: () => ({ emit: () => {} })
      };
      
      socketHandlersRef.handleOnchainGameCreated(dummySocket, ioRef, { gameId: String(gameId) });
      console.log('✅ Processed onchain_game_created via HTTP fallback');
    } else {
      console.warn('⚠️ Socket handlers not initialized, cannot process HTTP fallback event');
    }
    
    res.json({
      success: true,
      message: 'Event received and processed',
      gameId: String(gameId)
    });
  } catch (error) {
    console.error('Onchain created HTTP error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process event'
    });
  }
});

/**
 * POST /api/games/onchain/joined
 * HTTP fallback endpoint for onchain_game_joined event
 */
router.post('/onchain/joined', (req, res) => {
  try {
    const { gameId } = req.body;
    
    if (!gameId) {
      return res.status(400).json({
        success: false,
        error: 'gameId is required'
      });
    }

    console.log('📥 [HTTP FALLBACK] Received onchain_game_joined via HTTP for gameId:', gameId);
    
    // Process the event using socket handlers if available
    if (socketHandlersRef && ioRef) {
      // Create a dummy socket-like object for the handler
      const dummySocket = {
        id: 'http-fallback',
        emit: () => {},
        join: () => {},
        to: () => ({ emit: () => {} })
      };
      
      socketHandlersRef.handleOnchainGameJoined(dummySocket, ioRef, { gameId: String(gameId) });
      console.log('✅ Processed onchain_game_joined via HTTP fallback');
    } else {
      console.warn('⚠️ Socket handlers not initialized, cannot process HTTP fallback event');
    }
    
    res.json({
      success: true,
      message: 'Event received and processed',
      gameId: String(gameId)
    });
  } catch (error) {
    console.error('Onchain joined HTTP error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process event'
    });
  }
});

/**
 * POST /api/games/validate-invite
 * Validate an invitation link
 */
router.post('/validate-invite', (req, res) => {
  try {
    const { inviteCode } = req.body;
    
    if (!inviteCode) {
      return res.status(400).json({
        success: false,
        error: 'Invite code is required'
      });
    }

    // For now, invite code is just the game ID
    const gameState = gameManager.getGame(inviteCode);
    
    if (!gameState) {
      return res.status(404).json({
        success: false,
        error: 'Invalid invite code'
      });
    }

    if (gameState.gameStatus === 'finished') {
      return res.status(400).json({
        success: false,
        error: 'Game already finished'
      });
    }

    if (gameState.gameStatus === 'playing') {
      return res.status(400).json({
        success: false,
        error: 'Game already in progress'
      });
    }

    res.json({
      success: true,
      valid: true,
      gameInfo: {
        gameId: gameState.gameId,
        gameType: gameState.gameType,
        stakeAmount: gameState.stakeAmount,
        gameStatus: gameState.gameStatus,
        createdAt: gameState.createdAt
      }
    });
  } catch (error) {
    console.error('Validate invite error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to validate invite'
    });
  }
});

/**
 * DELETE /api/games/:gameId
 * Cancel/delete a game (only if not started)
 */
router.delete('/:gameId', (req, res) => {
  try {
    const { gameId } = req.params;
    const { playerId } = req.body;
    
    const gameState = gameManager.getGame(gameId);
    
    if (!gameState) {
      return res.status(404).json({
        success: false,
        error: 'Game not found'
      });
    }

    // Only game creator (player1) can delete the game
    if (gameState.player1.id !== playerId) {
      return res.status(403).json({
        success: false,
        error: 'Only game creator can delete the game'
      });
    }

    if (gameState.gameStatus === 'playing') {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete game in progress'
      });
    }

    // Remove game
    gameManager.games.delete(gameId);
    
    // Remove players from tracking
    if (gameState.player1.id) {
      gameManager.playerGames.delete(gameState.player1.id);
    }
    if (gameState.player2.id) {
      gameManager.playerGames.delete(gameState.player2.id);
    }

    res.json({
      success: true,
      message: 'Game deleted successfully'
    });
  } catch (error) {
    console.error('Delete game error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete game'
    });
  }
});

/**
 * GET /api/games/leaderboard
 * Get leaderboard data
 */
router.get('/leaderboard', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const leaderboard = await databaseService.getLeaderboard(limit);
    
    res.json({
      success: true,
      leaderboard,
      total: leaderboard.length
    });
  } catch (error) {
    console.error('Get leaderboard error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get leaderboard'
    });
  }
});

/**
 * GET /api/games/leaderboard/user/:walletAddress
 * Get user's rank on leaderboard
 */
router.get('/leaderboard/user/:walletAddress', async (req, res) => {
  try {
    const { walletAddress } = req.params;
    const userRank = await databaseService.getUserRank(walletAddress);
    
    if (!userRank) {
      return res.status(404).json({
        success: false,
        error: 'User not found on leaderboard'
      });
    }
    
    res.json({
      success: true,
      userRank
    });
  } catch (error) {
    console.error('Get user rank error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get user rank'
    });
  }
});

/**
 * REFERRAL SYSTEM ROUTES
 */

/**
 * POST /api/games/referral/create
 * Create referral relationship when user signs up with referral code
 */
router.post('/referral/create', async (req, res) => {
  try {
    const { referralCode, userWallet } = req.body;
    
    if (!referralCode || !userWallet) {
      return res.status(400).json({
        success: false,
        error: 'Referral code and user wallet are required'
      });
    }

    const result = await referralService.createReferral(referralCode, userWallet);
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Create referral error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create referral'
    });
  }
});

/**
 * POST /api/games/referral/validate
 * Validate referral code
 */
router.post('/referral/validate', async (req, res) => {
  try {
    const { referralCode } = req.body;
    
    if (!referralCode) {
      return res.status(400).json({
        success: false,
        error: 'Referral code is required'
      });
    }

    const result = await referralService.validateReferralCode(referralCode);
    
    res.json(result);
  } catch (error) {
    console.error('Validate referral error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to validate referral code'
    });
  }
});

/**
 * GET /api/games/referral/stats/:walletAddress
 * Get user's referral statistics
 */
router.get('/referral/stats/:walletAddress', async (req, res) => {
  try {
    const { walletAddress } = req.params;
    const stats = await referralService.getReferralStats(walletAddress);
    
    if (!stats) {
      return res.status(404).json({
        success: false,
        error: 'No referral stats found for user'
      });
    }
    
    res.json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('Get referral stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get referral stats'
    });
  }
});

/**
 * GET /api/games/referral/list/:walletAddress
 * Get list of users referred by this user
 */
router.get('/referral/list/:walletAddress', async (req, res) => {
  try {
    const { walletAddress } = req.params;
    const referrals = await referralService.getUserReferrals(walletAddress);
    
    res.json({
      success: true,
      referrals,
      count: referrals.length
    });
  } catch (error) {
    console.error('Get user referrals error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get user referrals'
    });
  }
});

/**
 * GET /api/games/referral/rewards/:walletAddress
 * Get user's referral rewards history
 */
router.get('/referral/rewards/:walletAddress', async (req, res) => {
  try {
    const { walletAddress } = req.params;
    const rewards = await referralService.getReferralRewards(walletAddress);
    
    res.json({
      success: true,
      rewards,
      count: rewards.length
    });
  } catch (error) {
    console.error('Get referral rewards error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get referral rewards'
    });
  }
});

/**
 * GET /api/games/referral/leaderboard
 * Get top referrers leaderboard
 */
router.get('/referral/leaderboard', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const topReferrers = await referralService.getTopReferrers(limit);
    
    res.json({
      success: true,
      leaderboard: topReferrers,
      count: topReferrers.length
    });
  } catch (error) {
    console.error('Get referral leaderboard error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get referral leaderboard'
    });
  }
});

module.exports = { router, initializeSocketHandlers }; 