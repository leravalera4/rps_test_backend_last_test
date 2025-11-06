/**
 * Database Service
 * Handles all Supabase operations for user profiles, points, and game history
 */

const { supabase, isConfigured } = require('../config/supabase');

class DatabaseService {
  constructor() {
    this.isReady = isConfigured;
    if (!this.isReady) {
      console.warn('⚠️  DatabaseService: Supabase not configured. Set environment variables.');
    }
  }

  /**
   * Get or create user profile
   * @param {string} walletAddress - User's wallet address
   * @returns {Promise<Object|null>} User profile or null if error
   */
  async getOrCreateUserProfile(walletAddress) {
    if (!this.isReady) {
      console.warn('DatabaseService: Supabase not configured');
      return null;
    }

    try {
      const { data, error } = await supabase
        .rpc('get_or_create_user_profile', { user_wallet: walletAddress });

      if (error) {
        console.error('Error getting/creating user profile:', error);
        return null;
      }

      console.log(`📊 User profile for ${walletAddress}:`, {
        points: data.points_balance,
        totalEarned: data.total_points_earned,
        games: data.total_games,
        wins: data.wins
      });

      return data;
    } catch (error) {
      console.error('Database error in getOrCreateUserProfile:', error);
      return null;
    }
  }

  /**
   * Check if user has enough points for a game
   * @param {string} walletAddress - User's wallet address
   * @param {number} requiredPoints - Points needed (default 100)
   * @returns {Promise<boolean>} True if user has enough points
   */
  async hasEnoughPoints(walletAddress, requiredPoints = 100) {
    const profile = await this.getOrCreateUserProfile(walletAddress);
    return profile ? profile.points_balance >= requiredPoints : false;
  }

  /**
   * Update user game statistics after game completion
   * @param {string} walletAddress - User's wallet address
   * @param {boolean} won - Whether the user won the game
   * @param {string} currency - 'points' or 'sol'
   * @param {string} gameId - Game ID for referral tracking
   * @returns {Promise<Object|null>} Updated user profile
   */
  async updateUserGameStats(walletAddress, won, currency = 'points', gameId = null) {
    if (!this.isReady) {
      console.warn('DatabaseService: Supabase not configured');
      return null;
    }

    try {
      // Calculate points change for winner-takes-all system with consolation points
      let pointsChange = 0;
      if (currency === 'points') {
        pointsChange = won ? 200 : 50; // Winner gets +200 (their bet + loser's bet), loser gets 50 consolation points
      } else if (currency === 'sol') {
        pointsChange = won ? 100 : 50; // SOL game winners get 100 bonus points, losers get 50 consolation points
      }

      const { data, error } = await supabase
        .rpc('update_user_game_stats', {
          user_wallet: walletAddress,
          won: won,
          points_change: pointsChange,
          game_currency: currency
          // game_id intentionally omitted to match deployed function signature
        });

      if (error) {
        console.error('Error updating user game stats:', error);
        return null;
      }

      console.log(`🎯 Updated stats for ${walletAddress}:`, {
        won,
        currency,
        gameId,
        newBalance: data.points_balance,
        totalEarned: data.total_points_earned,
        totalGames: data.total_games
      });

      return data;
    } catch (error) {
      console.error('Database error in updateUserGameStats:', error);
      return null;
    }
  }

  /**
   * Process points game abandonment with proper winner/loser handling
   * @param {string} gameId - Game ID
   * @param {string} player1Wallet - Player 1 wallet address
   * @param {string} player2Wallet - Player 2 wallet address
   * @param {string} winnerWallet - Winner wallet address
   * @param {string} loserWallet - Loser wallet address
   * @param {string} startedAt - Game start timestamp
   * @returns {Promise<Object>} Processing result
   */
  async processPointsGameAbandonment(gameId, player1Wallet, player2Wallet, winnerWallet, loserWallet, startedAt) {
    if (!this.isReady) {
      console.warn('DatabaseService: Supabase not configured');
      return { success: false, error: 'Database not configured' };
    }

    try {
      console.log(`🚪 Processing points game abandonment:`, {
        gameId,
        player1Wallet,
        player2Wallet,
        winnerWallet,
        loserWallet
      });

      // Update winner stats (win + 100 points)
      const winnerResult = await this.updateUserGameStats(winnerWallet, true, 'points', gameId);
      
      // Update loser stats (loss - 100 points)
      const loserResult = await this.updateUserGameStats(loserWallet, false, 'points', gameId);

      // Record game history
      await this.recordGameHistory({
        gameId,
        player1Wallet,
        player2Wallet,
        winnerWallet,
        currency: 'points',
        amountBet: 100,
        potAmount: 200,
        platformFee: 0,
        winnerPayout: 200,
        status: 'abandoned',
        startedAt,
        completedAt: new Date().toISOString(),
        abandonedBy: loserWallet === player1Wallet ? 'player1' : 'player2',
        abandonReason: 'opponent_quit'
      });

      console.log(`✅ Points game abandonment processed successfully`);

      return {
        success: true,
        winnerProfile: winnerResult,
        loserProfile: loserResult,
        gameId
      };

    } catch (error) {
      console.error('Error processing points game abandonment:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Refund points to a player who quit before game started
   * @param {string} walletAddress - Player's wallet address
   * @param {number} refundAmount - Amount to refund
   * @param {string} gameId - Game ID for logging
   * @returns {Promise<Object>} Refund result
   */
  async refundPoints(walletAddress, refundAmount, gameId) {
    if (!this.isReady) {
      console.warn('DatabaseService: Supabase not configured');
      return { success: false, error: 'Database not configured' };
    }

    try {
      console.log(`Processing points refund: ${refundAmount} to ${walletAddress} for game ${gameId}`);

      // Get current user profile
      const { data: profile, error: fetchError } = await this.supabase
        .from('user_profiles')
        .select('*')
        .eq('wallet_address', walletAddress)
        .single();

      if (fetchError) {
        console.error('Error fetching user profile for refund:', fetchError);
        return { success: false, error: fetchError.message };
      }

      if (!profile) {
        console.error('User profile not found for refund');
        return { success: false, error: 'User profile not found' };
      }

      // Add the refund amount back to points balance
      const newBalance = profile.points_balance + refundAmount;

      const { error: updateError } = await this.supabase
        .from('user_profiles')
        .update({ 
          points_balance: newBalance,
          updated_at: new Date().toISOString()
        })
        .eq('wallet_address', walletAddress);

      if (updateError) {
        console.error('Error updating points balance for refund:', updateError);
        return { success: false, error: updateError.message };
      }

      console.log(`Points refund successful: ${walletAddress} now has ${newBalance} points (refunded ${refundAmount})`);

      return { 
        success: true, 
        newBalance,
        refundAmount 
      };

    } catch (error) {
      console.error('Error processing points refund:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Record a completed game in history
   * @param {Object} gameData - Game information
   * @returns {Promise<Object|null>} Game history record
   */
  async recordGameHistory(gameData) {
    if (!this.isReady) {
      console.warn('DatabaseService: Supabase not configured');
      return null;
    }

    try {
      const { data, error } = await supabase
        .from('game_history')
        .insert([{
          game_id: gameData.gameId,
          player1_wallet: gameData.player1Wallet,
          player2_wallet: gameData.player2Wallet,
          winner_wallet: gameData.winnerWallet,
          currency_used: gameData.currency,
          amount_bet: gameData.amountBet,
          pot_amount: gameData.potAmount,
          platform_fee: gameData.platformFee,
          winner_payout: gameData.winnerPayout,
          game_status: gameData.status || 'completed',
          started_at: gameData.startedAt,
          completed_at: gameData.completedAt || new Date().toISOString()
        }])
        .select()
        .single();

      if (error) {
        console.error('Error recording game history:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('Database error in recordGameHistory:', error);
      return null;
    }
  }

  /**
   * Record a game that needs finalization on-chain
   * @param {string} gameId - Game ID
   * @param {string} player1Wallet - Player 1 wallet address
   * @param {string} player2Wallet - Player 2 wallet address
   * @param {string} winnerWallet - Winner wallet address
   * @returns {Promise<Object|null>} Game finalization record
   */
  async recordGameFinalizationNeeded(gameId, player1Wallet, player2Wallet, winnerWallet) {
    if (!this.isReady) {
      console.warn('DatabaseService: Supabase not configured');
      return null;
    }

    try {
      // Check if we have a games_to_finalize table
      const { data: tableExists } = await supabase
        .from('games_to_finalize')
        .select('count')
        .limit(1)
        .catch(() => ({ data: null }));

      // If table doesn't exist, we'll just log and return
      if (tableExists === null) {
        console.log('games_to_finalize table does not exist, skipping record');
        return null;
      }

      const { data, error } = await supabase
        .from('games_to_finalize')
        .insert([{
          game_id: gameId,
          player1_wallet: player1Wallet,
          player2_wallet: player2Wallet,
          winner_wallet: winnerWallet,
          created_at: new Date().toISOString(),
          status: 'pending'
        }])
        .select();

      if (error) {
        console.error('Error recording game finalization needed:', error);
        return null;
      }

      console.log(`📝 Recorded game ${gameId} needing on-chain finalization`);
      return data[0];
    } catch (error) {
      console.error('Database error in recordGameFinalizationNeeded:', error);
      return null;
    }
  }

  /**
   * Get leaderboard
   * @param {number} limit - Number of entries to return (default 50)
   * @returns {Promise<Array>} Leaderboard entries
   */
  async getLeaderboard(limit = 50) {
    if (!this.isReady) {
      console.warn('DatabaseService: Supabase not configured');
      return [];
    }

    try {
      const { data, error } = await supabase
        .from('leaderboard')
        .select('*')
        .limit(limit);

      if (error) {
        console.error('Error getting leaderboard:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Database error in getLeaderboard:', error);
      return [];
    }
  }

  /**
   * Get user's rank on leaderboard
   * @param {string} walletAddress - User's wallet address
   * @returns {Promise<Object|null>} User's leaderboard entry
   */
  async getUserRank(walletAddress) {
    if (!this.isReady) {
      console.warn('DatabaseService: Supabase not configured');
      return null;
    }

    try {
      const { data, error } = await supabase
        .from('leaderboard')
        .select('*')
        .eq('wallet_address', walletAddress)
        .single();

      if (error && error.code !== 'PGRST116') { // Not found error is OK
        console.error('Error getting user rank:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('Database error in getUserRank:', error);
      return null;
    }
  }

  /**
   * Process points-based game completion
   * @param {string} gameId - Game ID
   * @param {string} player1Wallet - Player 1 wallet
   * @param {string} player2Wallet - Player 2 wallet
   * @param {string} winnerWallet - Winner wallet
   * @param {string} startedAt - Game start time
   * @returns {Promise<Object>} Processing result
   */
  async processPointsGame(gameId, player1Wallet, player2Wallet, winnerWallet, startedAt) {
    if (!this.isReady) {
      console.warn('DatabaseService: Supabase not configured');
      return { success: false, error: 'Database not configured' };
    }

    try {
      // Update both players' stats
      const player1Won = winnerWallet === player1Wallet;
      const player2Won = winnerWallet === player2Wallet;

      const [player1Updated, player2Updated] = await Promise.all([
        this.updateUserGameStats(player1Wallet, player1Won, 'points', gameId),
        this.updateUserGameStats(player2Wallet, player2Won, 'points', gameId)
      ]);

      // Record game history
      const gameHistory = await this.recordGameHistory({
        gameId,
        player1Wallet,
        player2Wallet,
        winnerWallet,
        currency: 'points',
        amountBet: 100, // Fixed 100 points per game
        potAmount: null, // No pot for points games
        platformFee: null, // No fee for points games
        winnerPayout: 100, // Winner gets 100 points
        status: 'completed',
        startedAt,
        completedAt: new Date().toISOString()
      });

      console.log(`✅ Processed points game ${gameId}:`, {
        winner: winnerWallet,
        player1Balance: player1Updated?.points_balance,
        player2Balance: player2Updated?.points_balance
      });

      return {
        success: true,
        player1Profile: player1Updated,
        player2Profile: player2Updated,
        gameHistory
      };

    } catch (error) {
      console.error('Error processing points game:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get game statistics
   * @returns {Promise<Object>} Database statistics
   */
  async getStats() {
    if (!this.isReady) {
      return {
        totalUsers: 0,
        totalGames: 0,
        totalPointsGames: 0,
        totalSolGames: 0,
        avgPointsPerUser: 0
      };
    }

    try {
      const [usersResult, gamesResult] = await Promise.all([
        supabase.from('user_profiles').select('count', { count: 'exact', head: true }),
        supabase.from('game_history').select('currency_used', { count: 'exact' })
      ]);

      const totalUsers = usersResult.count || 0;
      const totalGames = gamesResult.count || 0;
      
      const pointsGames = gamesResult.data?.filter(g => g.currency_used === 'points').length || 0;
      const solGames = gamesResult.data?.filter(g => g.currency_used === 'sol').length || 0;

      return {
        totalUsers,
        totalGames,
        totalPointsGames: pointsGames,
        totalSolGames: solGames,
        avgPointsPerUser: 0 // TODO: Calculate if needed
      };
    } catch (error) {
      console.error('Error getting database stats:', error);
      return {
        totalUsers: 0,
        totalGames: 0,
        totalPointsGames: 0,
        totalSolGames: 0,
        avgPointsPerUser: 0
      };
    }
  }

  /**
   * Get recent game winnings for display
   * @param {number} limit - Number of records to fetch
   * @param {number} offset - Offset for pagination
   * @returns {Promise<Array>} Array of winning games
   */
  async getWinningsHistory(limit = 50, offset = 0) {
    if (!this.isReady) {
      console.warn('DatabaseService: Supabase not configured');
      return [];
    }

    try {
      console.log('🔍 Fetching winnings history from database...', { limit, offset });
      
      const { data, error } = await supabase
        .from('game_history')
        .select(`
          id,
          game_id,
          winner_wallet,
          currency_used,
          amount_bet,
          winner_payout,
          created_at
        `)
        .not('winner_wallet', 'is', null)
        .not('amount_bet', 'is', null)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) {
        console.error('Error fetching winnings history:', error);
        return [];
      }

      console.log(`✅ Fetched ${data?.length || 0} winning games from database`, {
        limit,
        offset,
        actualCount: data?.length || 0,
        hasMore: (data?.length || 0) === limit
      });
      
      // Format the data for display
      return data?.map(game => ({
        id: game.id,
        gameId: game.game_id,
        winnerWallet: game.winner_wallet,
        // No username join; only wallet shown
        currency: game.currency_used,
        stakeAmount: game.amount_bet,
        pointsWon: game.currency_used === 'points' ? (game.amount_bet || 0) : 0,
        winningsAmount: game.currency_used === 'sol' ? 
          (game.winner_payout || game.amount_bet * 2 * 0.95) : 
          (game.amount_bet || 0),
        createdAt: game.created_at
      })) || [];

    } catch (error) {
      console.error('Error in getWinningsHistory:', error);
      return [];
    }
  }
}

// Export singleton instance
module.exports = new DatabaseService(); 