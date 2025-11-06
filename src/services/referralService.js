/**
 * Referral Service
 * Handles referral system logic including code generation, tracking, and rewards
 */

const { createClient } = require('@supabase/supabase-js');

class ReferralService {
  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );
  }

  /**
   * Create referral relationship when user signs up with referral code
   * @param {string} referralCode - The referral code used
   * @param {string} newUserWallet - New user's wallet address
   * @returns {Promise<Object>} Result with success status and details
   */
  async createReferral(referralCode, newUserWallet) {
    try {
      console.log(`🔗 Creating referral for ${newUserWallet} with code ${referralCode}`);

      const { data, error } = await this.supabase
        .rpc('create_referral', {
          referrer_code: referralCode,
          new_user_wallet: newUserWallet
        });

      if (error) {
        console.error('❌ Error creating referral:', error);
        return { success: false, error: error.message };
      }

      if (!data.success) {
        console.log('⚠️ Referral creation failed:', data.error);
        return data;
      }

      console.log('✅ Referral created successfully:', {
        referrer: data.referrer,
        signupBonus: data.signup_bonus,
        referrerBonus: data.referrer_bonus
      });

      return data;
    } catch (error) {
      console.error('❌ Error in createReferral:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Activate referral when referred user plays their first game
   * @param {string} userWallet - User's wallet address
   * @param {string} gameId - Game ID where referral is activated
   * @returns {Promise<Object>} Result with success status and details
   */
  async activateReferral(userWallet, gameId) {
    try {
      console.log(`🎮 Activating referral for ${userWallet} in game ${gameId}`);

      const { data, error } = await this.supabase
        .rpc('activate_referral', {
          user_wallet: userWallet,
          game_id: gameId
        });

      if (error) {
        console.error('❌ Error activating referral:', error);
        return { success: false, error: error.message };
      }

      if (!data.success) {
        console.log('ℹ️ No referral to activate:', data.message);
        return data;
      }

      console.log('✅ Referral activated successfully:', {
        referrer: data.referrer,
        firstGameBonus: data.first_game_bonus
      });

      return data;
    } catch (error) {
      console.error('❌ Error in activateReferral:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Process referral commission when referred user wins a game (1% of winnings)
   * @param {string} winnerWallet - Winner's wallet address
   * @param {string} gameId - Game ID
   * @param {number} pointsWon - Points won by the user
   * @returns {Promise<Object>} Result with success status and details
   */
  async processReferralCommission(winnerWallet, gameId, pointsWon) {
    try {
      console.log(`💰 Processing referral commission (1%) for ${winnerWallet} - ${pointsWon} points won`);

      const { data, error } = await this.supabase
        .rpc('process_referral_commission', {
          winner_wallet: winnerWallet,
          game_id: gameId,
          points_won: pointsWon
        });

      if (error) {
        console.error('❌ Error processing referral commission:', error);
        return { success: false, error: error.message };
      }

      if (!data.success) {
        console.log('ℹ️ No commission to process:', data.message);
        return data;
      }

      console.log('✅ Referral commission processed (1%):', {
        referrer: data.referrer,
        commission: data.commission,
        originalWin: pointsWon
      });

      return data;
    } catch (error) {
      console.error('❌ Error in processReferralCommission:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get user's referral statistics
   * @param {string} walletAddress - User's wallet address
   * @returns {Promise<Object>} Referral stats or null
   */
  async getReferralStats(walletAddress) {
    try {
      console.log(`📊 Getting referral stats for ${walletAddress}`);

      const { data, error } = await this.supabase
        .from('referral_stats')
        .select('*')
        .eq('wallet_address', walletAddress)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // No data found
          return null;
        }
        console.error('❌ Error getting referral stats:', error);
        return null;
      }

      console.log('✅ Referral stats retrieved:', {
        code: data.referral_code,
        count: data.referral_count,
        earnings: data.referral_earnings
      });

      return data;
    } catch (error) {
      console.error('❌ Error in getReferralStats:', error);
      return null;
    }
  }

  /**
   * Get user's referral history (people they referred)
   * @param {string} walletAddress - User's wallet address
   * @returns {Promise<Array>} List of referrals
   */
  async getUserReferrals(walletAddress) {
    try {
      console.log(`👥 Getting referrals for ${walletAddress}`);

      const { data, error } = await this.supabase
        .from('referrals')
        .select(`
          *,
          referred_profile:user_profiles!referrals_referred_wallet_fkey(
            wallet_address,
            total_games,
            wins,
            created_at
          )
        `)
        .eq('referrer_wallet', walletAddress)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('❌ Error getting user referrals:', error);
        return [];
      }

      console.log(`✅ Found ${data.length} referrals for user`);
      return data;
    } catch (error) {
      console.error('❌ Error in getUserReferrals:', error);
      return [];
    }
  }

  /**
   * Get user's referral rewards history
   * @param {string} walletAddress - User's wallet address
   * @returns {Promise<Array>} List of rewards
   */
  async getReferralRewards(walletAddress) {
    try {
      console.log(`🏆 Getting referral rewards for ${walletAddress}`);

      const { data, error } = await this.supabase
        .from('referral_rewards')
        .select('*')
        .eq('referrer_wallet', walletAddress)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('❌ Error getting referral rewards:', error);
        return [];
      }

      console.log(`✅ Found ${data.length} referral rewards for user`);
      return data;
    } catch (error) {
      console.error('❌ Error in getReferralRewards:', error);
      return [];
    }
  }

  /**
   * Validate referral code format and existence
   * @param {string} referralCode - Code to validate
   * @returns {Promise<Object>} Validation result
   */
  async validateReferralCode(referralCode) {
    try {
      if (!referralCode || referralCode.length !== 8) {
        return { valid: false, error: 'Invalid referral code format' };
      }

      const { data, error } = await this.supabase
        .from('user_profiles')
        .select('wallet_address, referral_code')
        .eq('referral_code', referralCode.toUpperCase())
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return { valid: false, error: 'Referral code not found' };
        }
        console.error('❌ Error validating referral code:', error);
        return { valid: false, error: 'Error validating code' };
      }

      return { 
        valid: true, 
        referrer: data.wallet_address 
      };
    } catch (error) {
      console.error('❌ Error in validateReferralCode:', error);
      return { valid: false, error: error.message };
    }
  }

  /**
   * Process SOL referral commission when referred user wins a SOL game
   * @param {string} winnerWallet - Winner's wallet address
   * @param {string} gameId - Game ID
   * @param {number} totalPot - Total pot in SOL
   * @param {number} stakeAmount - Original stake amount in SOL
   * @returns {Promise<Object>} Result with success status and details
   */
  async processSolReferralCommission(winnerWallet, gameId, totalPot, stakeAmount) {
    try {
      console.log(`💰 Processing SOL referral commission for ${winnerWallet} - Total pot: ${totalPot} SOL, Stake: ${stakeAmount} SOL`);

      const { data, error } = await this.supabase
        .rpc('process_sol_referral_commission', {
          winner_wallet: winnerWallet,
          game_id: gameId,
          total_pot: totalPot,
          stake_amount: stakeAmount
        });

      if (error) {
        console.error('❌ Error processing SOL referral commission:', error);
        return { success: false, error: error.message };
      }

      if (!data.success) {
        console.log('ℹ️ No SOL commission to process:', data.message);
        return data;
      }

      console.log('✅ SOL referral commission processed:', {
        referrer: data.referrer,
        commission: data.referrer_commission,
        platformFeeRate: data.platform_fee_rate,
        referrerFeeRate: data.referrer_fee_rate
      });

      return data;
    } catch (error) {
      console.error('❌ Error in processSolReferralCommission:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get leaderboard of top referrers
   * @param {number} limit - Number of top referrers to return
   * @returns {Promise<Array>} Top referrers list
   */
  async getTopReferrers(limit = 10) {
    try {
      console.log(`🏅 Getting top ${limit} referrers`);

      const { data, error } = await this.supabase
        .from('referral_stats')
        .select('*')
        .order('referral_earnings', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('❌ Error getting top referrers:', error);
        return [];
      }

      console.log(`✅ Retrieved ${data.length} top referrers`);
      return data;
    } catch (error) {
      console.error('❌ Error in getTopReferrers:', error);
      return [];
    }
  }
}

module.exports = ReferralService;
