-- Migration 001: Add update_user_game_stats function
-- This was the second script you executed that adds game stats updating functionality

-- Function to update user points after game completion
CREATE OR REPLACE FUNCTION update_user_game_stats(
  user_wallet TEXT,
  won BOOLEAN,
  points_change INTEGER DEFAULT 0,
  game_currency TEXT DEFAULT 'points'
)
RETURNS user_profiles AS $$
DECLARE
  user_profile user_profiles;
BEGIN
  -- Get or create user profile
  SELECT * INTO user_profile FROM get_or_create_user_profile(user_wallet);
  
  -- Update stats based on game outcome
  UPDATE user_profiles 
  SET 
    total_games = total_games + 1,
    wins = CASE WHEN won THEN wins + 1 ELSE wins END,
    losses = CASE WHEN NOT won THEN losses + 1 ELSE losses END,
    points_balance = CASE 
      WHEN game_currency = 'points' THEN points_balance + points_change
      WHEN won AND game_currency = 'sol' THEN points_balance + 100  -- SOL winners get 100 bonus points
      ELSE points_balance
    END,
    total_points_earned = CASE 
      WHEN won AND game_currency = 'points' THEN total_points_earned + 100  -- Points winner gets 100 points
      WHEN won AND game_currency = 'sol' THEN total_points_earned + 100     -- SOL winner gets 100 bonus points
      ELSE total_points_earned
    END
  WHERE wallet_address = user_wallet
  RETURNING * INTO user_profile;
  
  RETURN user_profile;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;