-- Migration: Add 50 consolation points for SOL game losers
-- Date: 2024-12-19
-- Description: Update the update_user_game_stats function to give 50 points to losers in SOL games

-- Update the function to handle consolation points for SOL game losers
CREATE OR REPLACE FUNCTION update_user_game_stats(
  user_wallet TEXT,
  won BOOLEAN,
  points_change INTEGER DEFAULT 0,
  game_currency TEXT DEFAULT 'points',
  game_id TEXT DEFAULT NULL
) RETURNS user_profiles AS $$
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
      WHEN won AND game_currency = 'points' THEN total_points_earned + 100  -- Points winner gets 100 points
      WHEN game_currency = 'sol' THEN total_points_earned + points_change   -- SOL games use points_change (100 for winner, 50 for loser)
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
