-- RPS MagicBlock Game Database Schema
-- Points system with user profiles and game history

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- User profiles table
-- Stores user data, points balance, and game statistics
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  wallet_address TEXT UNIQUE NOT NULL,
  points_balance INTEGER DEFAULT 0 NOT NULL, -- New users start with 0 points
  total_points_earned INTEGER DEFAULT 0 NOT NULL, -- For leaderboard ranking
  total_games INTEGER DEFAULT 0 NOT NULL,
  wins INTEGER DEFAULT 0 NOT NULL,
  losses INTEGER DEFAULT 0 NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Game history table
-- Records all completed games for tracking and leaderboard
CREATE TABLE IF NOT EXISTS game_history (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  game_id TEXT UNIQUE NOT NULL, -- From game manager
  player1_wallet TEXT NOT NULL,
  player2_wallet TEXT NOT NULL,
  winner_wallet TEXT, -- NULL if game didn't complete
  currency_used TEXT NOT NULL CHECK (currency_used IN ('points', 'sol')),
  amount_bet DECIMAL(10, 2) NOT NULL, -- Points (integer) or SOL (decimal)
  pot_amount DECIMAL(10, 2), -- Total pot for SOL games
  platform_fee DECIMAL(10, 2), -- Fee taken for SOL games
  winner_payout DECIMAL(10, 2), -- Amount paid to winner
  game_status TEXT NOT NULL CHECK (game_status IN ('completed', 'abandoned', 'error')),
  started_at TIMESTAMP WITH TIME ZONE NOT NULL,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_profiles_wallet ON user_profiles(wallet_address);
CREATE INDEX IF NOT EXISTS idx_user_profiles_points_earned ON user_profiles(total_points_earned DESC);
CREATE INDEX IF NOT EXISTS idx_game_history_game_id ON game_history(game_id);
CREATE INDEX IF NOT EXISTS idx_game_history_player1 ON game_history(player1_wallet);
CREATE INDEX IF NOT EXISTS idx_game_history_player2 ON game_history(player2_wallet);
CREATE INDEX IF NOT EXISTS idx_game_history_winner ON game_history(winner_wallet);
CREATE INDEX IF NOT EXISTS idx_game_history_completed ON game_history(completed_at DESC);

-- Updated at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply updated_at trigger to user_profiles
CREATE TRIGGER update_user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- View for leaderboard (top players by points earned)
CREATE OR REPLACE VIEW leaderboard AS
SELECT 
  ROW_NUMBER() OVER (ORDER BY total_points_earned DESC, wins DESC, total_games ASC) as rank,
  wallet_address,
  total_points_earned,
  wins,
  losses,
  total_games,
  CASE 
    WHEN total_games > 0 THEN ROUND((wins::DECIMAL / total_games::DECIMAL) * 100, 2)
    ELSE 0
  END as win_rate_percentage,
  points_balance,
  created_at
FROM user_profiles
WHERE total_games > 0  -- Only show players who have played games
ORDER BY total_points_earned DESC, wins DESC, total_games ASC;

-- Row Level Security (RLS) policies
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_history ENABLE ROW LEVEL SECURITY;

-- Policy: Users can read their own profile
CREATE POLICY "Users can read own profile" ON user_profiles
  FOR SELECT USING (true); -- Allow all reads for leaderboard

-- Policy: Users can update their own profile (for points balance updates)
CREATE POLICY "Service can update profiles" ON user_profiles
  FOR ALL USING (true); -- Service role can manage all profiles

-- Policy: Anyone can read game history for transparency
CREATE POLICY "Anyone can read game history" ON game_history
  FOR SELECT USING (true);

-- Policy: Service can insert game history
CREATE POLICY "Service can manage game history" ON game_history
  FOR ALL USING (true); -- Service role can manage all game history

-- Old function removed - using the updated version below that includes referral code generation

-- Function to create or get user profile with referral code
CREATE OR REPLACE FUNCTION get_or_create_user_profile(user_wallet TEXT)
RETURNS user_profiles AS $$
DECLARE
  user_profile user_profiles;
  new_referral_code TEXT;
BEGIN
  -- Try to get existing profile
  SELECT * INTO user_profile FROM user_profiles WHERE wallet_address = user_wallet;
  
  -- If not found, create new profile with referral code
  IF NOT FOUND THEN
    -- Generate referral code
    new_referral_code := generate_referral_code(user_wallet);
    
    INSERT INTO user_profiles (
      wallet_address, 
      points_balance, 
      total_points_earned, 
      referral_code,
      referral_count,
      referral_earnings
    )
    VALUES (user_wallet, 0, 0, new_referral_code, 0, 0)
    RETURNING * INTO user_profile;
  ELSE
    -- Ensure existing users have referral codes
    IF user_profile.referral_code IS NULL THEN
      new_referral_code := generate_referral_code(user_wallet);
      UPDATE user_profiles 
      SET referral_code = new_referral_code
      WHERE wallet_address = user_wallet
      RETURNING * INTO user_profile;
    END IF;
  END IF;
  
  RETURN user_profile;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update user points after game completion
CREATE OR REPLACE FUNCTION update_user_game_stats(
  user_wallet TEXT,
  won BOOLEAN,
  points_change INTEGER DEFAULT 0,
  game_currency TEXT DEFAULT 'points',
  game_id TEXT DEFAULT NULL
)
RETURNS user_profiles AS $$
DECLARE
  user_profile user_profiles;
  is_first_game BOOLEAN DEFAULT FALSE;
  points_won INTEGER DEFAULT 0;
BEGIN
  -- Get or create user profile
  SELECT * INTO user_profile FROM get_or_create_user_profile(user_wallet);
  
  -- Check if this is user's first game
  is_first_game := user_profile.total_games = 0;
  
  -- Calculate points won for referral commission
  IF won AND game_currency = 'points' THEN
    points_won := 100;  -- Standard points win
  ELSIF won AND game_currency = 'sol' THEN
    points_won := 100;  -- SOL winner bonus points
  END IF;
  
  -- Update stats based on game outcome
  UPDATE user_profiles 
  SET 
    total_games = total_games + 1,
    wins = CASE WHEN won THEN wins + 1 ELSE wins END,
    losses = CASE WHEN NOT won THEN losses + 1 ELSE losses END,
    points_balance = CASE 
      WHEN game_currency = 'points' THEN points_balance + points_change
      WHEN game_currency = 'sol' THEN points_balance + points_change  -- SOL games use points_change (100 for winner, 50 for loser)
      ELSE points_balance
    END,
    total_points_earned = CASE 
      WHEN game_currency = 'points' THEN total_points_earned + points_change  -- Points games use points_change (200 for winner, 50 for loser)
      WHEN game_currency = 'sol' THEN total_points_earned + points_change     -- SOL games use points_change (100 for winner, 50 for loser)
      ELSE total_points_earned
    END
  WHERE wallet_address = user_wallet
  RETURNING * INTO user_profile;
  
  -- Handle referral system
  IF is_first_game AND game_id IS NOT NULL THEN
    -- Activate referral if this is first game
    PERFORM activate_referral(user_wallet, game_id);
  END IF;
  
  IF won AND points_won > 0 AND game_id IS NOT NULL THEN
    -- Process referral commission for winner
    PERFORM process_referral_commission(user_wallet, game_id, points_won);
  END IF;
  
  RETURN user_profile;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add referral system tables and functions
-- Add referral fields to user_profiles
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS referred_by TEXT REFERENCES user_profiles(wallet_address);
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS referral_count INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS referral_earnings INTEGER DEFAULT 0 NOT NULL;

-- Referrals tracking table
CREATE TABLE IF NOT EXISTS referrals (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  referrer_wallet TEXT NOT NULL REFERENCES user_profiles(wallet_address),
  referred_wallet TEXT NOT NULL REFERENCES user_profiles(wallet_address),
  referral_code TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'rewarded')) DEFAULT 'pending',
  activation_game_id TEXT, -- Game ID when referral became active
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  activated_at TIMESTAMP WITH TIME ZONE,
  rewarded_at TIMESTAMP WITH TIME ZONE,
  UNIQUE(referrer_wallet, referred_wallet)
);

-- Referral rewards history
CREATE TABLE IF NOT EXISTS referral_rewards (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  referral_id UUID NOT NULL REFERENCES referrals(id),
  referrer_wallet TEXT NOT NULL REFERENCES user_profiles(wallet_address),
  referred_wallet TEXT NOT NULL REFERENCES user_profiles(wallet_address),
  reward_type TEXT NOT NULL CHECK (reward_type IN ('signup_bonus', 'first_game_bonus', 'game_commission', 'sol_commission')),
  points_awarded INTEGER NOT NULL,
  sol_amount DECIMAL(10, 6) DEFAULT 0, -- SOL amount for sol_commission rewards
  game_id TEXT, -- If reward is from a specific game
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_profiles_referral_code ON user_profiles(referral_code);
CREATE INDEX IF NOT EXISTS idx_user_profiles_referred_by ON user_profiles(referred_by);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_wallet);
CREATE INDEX IF NOT EXISTS idx_referrals_referred ON referrals(referred_wallet);
CREATE INDEX IF NOT EXISTS idx_referrals_code ON referrals(referral_code);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer_status ON referrals(referrer_wallet, status);
CREATE INDEX IF NOT EXISTS idx_referral_rewards_referrer ON referral_rewards(referrer_wallet);
CREATE INDEX IF NOT EXISTS idx_referral_rewards_game ON referral_rewards(game_id);

-- RLS policies for referral tables
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_rewards ENABLE ROW LEVEL SECURITY;

-- Referrals policies
CREATE POLICY "Users can read own referrals" ON referrals
  FOR SELECT USING (referrer_wallet = current_user OR referred_wallet = current_user);

CREATE POLICY "Service can manage referrals" ON referrals
  FOR ALL USING (true);

-- Referral rewards policies  
CREATE POLICY "Users can read own rewards" ON referral_rewards
  FOR SELECT USING (referrer_wallet = current_user OR referred_wallet = current_user);

CREATE POLICY "Service can manage rewards" ON referral_rewards
  FOR ALL USING (true);

-- Function to generate unique referral code
CREATE OR REPLACE FUNCTION generate_referral_code(user_wallet TEXT)
RETURNS TEXT AS $$
DECLARE
  code TEXT;
  exists_count INTEGER;
BEGIN
  -- Generate code from wallet address (first 8 chars + random suffix)
  code := UPPER(LEFT(REPLACE(user_wallet, '1', ''), 4)) || LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0');
  
  -- Ensure uniqueness
  SELECT COUNT(*) INTO exists_count FROM user_profiles WHERE referral_code = code;
  WHILE exists_count > 0 LOOP
    code := UPPER(LEFT(REPLACE(user_wallet, '1', ''), 4)) || LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0');
    SELECT COUNT(*) INTO exists_count FROM user_profiles WHERE referral_code = code;
  END LOOP;
  
  RETURN code;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to create referral relationship
CREATE OR REPLACE FUNCTION create_referral(
  referrer_code TEXT,
  new_user_wallet TEXT
)
RETURNS JSONB AS $$
DECLARE
  referrer_profile user_profiles;
  new_user_profile user_profiles;
  existing_referral referrals;
  result JSONB;
BEGIN
  -- Find referrer by code
  SELECT * INTO referrer_profile 
  FROM user_profiles 
  WHERE referral_code = referrer_code;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid referral code');
  END IF;
  
  -- Can't refer yourself
  IF referrer_profile.wallet_address = new_user_wallet THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot refer yourself');
  END IF;
  
  -- Get new user profile to check if already referred
  SELECT * INTO new_user_profile 
  FROM user_profiles 
  WHERE wallet_address = new_user_wallet;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'User profile not found');
  END IF;
  
  -- Check if user was already referred by someone
  IF new_user_profile.referred_by IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User already has a referrer');
  END IF;
  
  -- Check if referral relationship already exists
  SELECT * INTO existing_referral
  FROM referrals 
  WHERE referrer_wallet = referrer_profile.wallet_address 
    AND referred_wallet = new_user_wallet;
  
  IF FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Referral relationship already exists');
  END IF;
  
  -- Update new user's referred_by field
  UPDATE user_profiles 
  SET referred_by = referrer_profile.wallet_address
  WHERE wallet_address = new_user_wallet;
  
  -- Create referral record
  INSERT INTO referrals (referrer_wallet, referred_wallet, referral_code, status)
  VALUES (referrer_profile.wallet_address, new_user_wallet, referrer_code, 'pending');
  
  -- Give signup bonus to new user (100 points)
  UPDATE user_profiles
  SET points_balance = points_balance + 100
  WHERE wallet_address = new_user_wallet;
  
  -- Give referrer bonus (50 points)
  UPDATE user_profiles
  SET 
    points_balance = points_balance + 50,
    referral_count = referral_count + 1,
    referral_earnings = referral_earnings + 50
  WHERE wallet_address = referrer_profile.wallet_address;
  
  -- Record signup bonuses
  INSERT INTO referral_rewards (referral_id, referrer_wallet, referred_wallet, reward_type, points_awarded)
  SELECT r.id, r.referrer_wallet, r.referred_wallet, 'signup_bonus', 50
  FROM referrals r 
  WHERE r.referrer_wallet = referrer_profile.wallet_address 
    AND r.referred_wallet = new_user_wallet;
  
  RETURN jsonb_build_object(
    'success', true, 
    'referrer', referrer_profile.wallet_address,
    'signup_bonus', 100,
    'referrer_bonus', 50
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to activate referral on first game
CREATE OR REPLACE FUNCTION activate_referral(
  user_wallet TEXT,
  game_id TEXT
)
RETURNS JSONB AS $$
DECLARE
  referral_record referrals;
  result JSONB;
BEGIN
  -- Find pending referral for this user
  SELECT * INTO referral_record
  FROM referrals
  WHERE referred_wallet = user_wallet AND status = 'pending';
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'No pending referral found');
  END IF;
  
  -- Activate referral
  UPDATE referrals
  SET 
    status = 'active',
    activation_game_id = game_id,
    activated_at = NOW()
  WHERE id = referral_record.id;
  
  -- Give first game bonus to referrer (25 points)
  UPDATE user_profiles
  SET 
    points_balance = points_balance + 25,
    referral_earnings = referral_earnings + 25
  WHERE wallet_address = referral_record.referrer_wallet;
  
  -- Record first game bonus
  INSERT INTO referral_rewards (referral_id, referrer_wallet, referred_wallet, reward_type, points_awarded, game_id)
  VALUES (referral_record.id, referral_record.referrer_wallet, referral_record.referred_wallet, 'first_game_bonus', 25, game_id);
  
  RETURN jsonb_build_object(
    'success', true,
    'referrer', referral_record.referrer_wallet,
    'first_game_bonus', 25
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to give referrer commission on referred user wins
CREATE OR REPLACE FUNCTION process_referral_commission(
  winner_wallet TEXT,
  game_id TEXT,
  points_won INTEGER
)
RETURNS JSONB AS $$
DECLARE
  referral_record referrals;
  commission INTEGER;
BEGIN
  -- Find pending or active referral for winner
  SELECT * INTO referral_record
  FROM referrals
  WHERE referred_wallet = winner_wallet AND status IN ('pending', 'active');
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'No referral found');
  END IF;
  
  -- Activate referral if it's still pending
  IF referral_record.status = 'pending' THEN
    UPDATE referrals 
    SET status = 'active' 
    WHERE id = referral_record.id;
  END IF;
  
  -- Calculate commission (1% of points won, minimum 1 point)
  commission := GREATEST(FLOOR(points_won * 0.01), 1);
  
  -- Give commission to referrer
  UPDATE user_profiles
  SET 
    points_balance = points_balance + commission,
    referral_earnings = referral_earnings + commission
  WHERE wallet_address = referral_record.referrer_wallet;
  
  -- Record commission
  INSERT INTO referral_rewards (referral_id, referrer_wallet, referred_wallet, reward_type, points_awarded, game_id)
  VALUES (referral_record.id, referral_record.referrer_wallet, referral_record.referred_wallet, 'game_commission', commission, game_id);
  
  RETURN jsonb_build_object(
    'success', true,
    'referrer', referral_record.referrer_wallet,
    'commission', commission
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to process SOL referral commission (referrer gets 1% of total pot, platform gets 4%)
CREATE OR REPLACE FUNCTION process_sol_referral_commission(
  winner_wallet TEXT,
  game_id TEXT,
  total_pot DECIMAL(10, 6),
  stake_amount DECIMAL(10, 6)
)
RETURNS JSONB AS $$
DECLARE
  referral_record referrals;
  referrer_commission DECIMAL(10, 6);
  fee_rate DECIMAL(4, 3);
BEGIN
  -- Find pending or active referral for winner
  SELECT * INTO referral_record
  FROM referrals
  WHERE referred_wallet = winner_wallet AND status IN ('pending', 'active');
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'No referral found');
  END IF;
  
  -- Activate referral if it's still pending
  IF referral_record.status = 'pending' THEN
    UPDATE referrals 
    SET status = 'active' 
    WHERE id = referral_record.id;
  END IF;
  
  -- Calculate fee rate based on stake amount (same logic as platform)
  IF stake_amount <= 0.01 THEN
    fee_rate := 0.05; -- 5% total (4% platform + 1% referrer)
  ELSIF stake_amount <= 0.05 THEN
    fee_rate := 0.03; -- 3% total (2% platform + 1% referrer)  
  ELSE
    fee_rate := 0.02; -- 2% total (1% platform + 1% referrer)
  END IF;
  
  -- Referrer gets 1% of total pot (both stakes combined)
  referrer_commission := total_pot * 0.01;
  
  -- Record SOL commission (we don't update points_balance, this will be handled by SOL transfer)
  INSERT INTO referral_rewards (referral_id, referrer_wallet, referred_wallet, reward_type, points_awarded, sol_amount, game_id)
  VALUES (referral_record.id, referral_record.referrer_wallet, referral_record.referred_wallet, 'sol_commission', 0, referrer_commission, game_id);
  
  RETURN jsonb_build_object(
    'success', true,
    'referrer', referral_record.referrer_wallet,
    'referrer_commission', referrer_commission,
    'platform_fee_rate', fee_rate - 0.01,
    'referrer_fee_rate', 0.01,
    'game_id', game_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- View for referral statistics
CREATE OR REPLACE VIEW referral_stats AS
SELECT 
  up.wallet_address,
  up.referral_code,
  up.referral_count,
  up.referral_earnings,
  COALESCE(active_refs.active_count, 0) as active_referrals,
  COALESCE(pending_refs.pending_count, 0) as pending_referrals
FROM user_profiles up
LEFT JOIN (
  SELECT referrer_wallet, COUNT(*) as active_count
  FROM referrals 
  WHERE status = 'active'
  GROUP BY referrer_wallet
) active_refs ON up.wallet_address = active_refs.referrer_wallet
LEFT JOIN (
  SELECT referrer_wallet, COUNT(*) as pending_count
  FROM referrals 
  WHERE status = 'pending'
  GROUP BY referrer_wallet
) pending_refs ON up.wallet_address = pending_refs.referrer_wallet
WHERE up.referral_code IS NOT NULL; 