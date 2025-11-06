-- Migration 000: Initial Database Schema
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

-- Function to create or get user profile
CREATE OR REPLACE FUNCTION get_or_create_user_profile(user_wallet TEXT)
RETURNS user_profiles AS $$
DECLARE
  user_profile user_profiles;
BEGIN
  -- Try to get existing profile
  SELECT * INTO user_profile FROM user_profiles WHERE wallet_address = user_wallet;
  
  -- If not found, create new profile with 0 starting points
  IF NOT FOUND THEN
    INSERT INTO user_profiles (wallet_address, points_balance, total_points_earned)
    VALUES (user_wallet, 0, 0)
    RETURNING * INTO user_profile;
  END IF;
  
  RETURN user_profile;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;