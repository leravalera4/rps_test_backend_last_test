# Database Migrations

This folder contains the database migrations for the RPS MagicBlock Game in order.

## Migration Order

- **000_initial_schema.sql** - Initial database schema with tables, indexes, views, and basic functions
- **001_add_update_game_stats.sql** - Added the update_user_game_stats function for game completion handling
- **002_winner_takes_all_points.sql** - Updated points system: winner gets 200 points total, loser loses 100
- **003_referral_system.sql** - Added referral system with commission tracking
- **004_loser_consolation_points.sql** - Added 50 consolation points for SOL game losers

## Usage

Execute these migrations in order against your Supabase database:

1. Run `000_initial_schema.sql` to set up the initial schema
2. Run `001_add_update_game_stats.sql` to add game stats functionality  
3. Run `002_winner_takes_all_points.sql` to implement winner-takes-all points system
4. Run `003_referral_system.sql` to add referral system
5. Run `004_loser_consolation_points.sql` to add consolation points for SOL game losers

## Points System Logic

**Current System (after migration 004):**
- Points games: Winner gets +200 points total (their 100 bet back + 100 from loser), Loser gets -100 points
- SOL games: Winner gets 95% of pot + 100 bonus points, Loser gets 50 consolation points
- `total_points_earned` tracks cumulative points won for leaderboard ranking