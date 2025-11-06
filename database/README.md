# Supabase Database Setup for RPS MagicBlock Game

This document explains how to set up the Supabase database for the points system and leaderboard functionality.

## 1. Create Supabase Project

1. Go to [https://supabase.com](https://supabase.com)
2. Sign in or create an account
3. Click "New Project"
4. Choose your organization
5. Fill in project details:
   - **Name**: `rps-magicblock-game`
   - **Database Password**: Generate a strong password (save it!)
   - **Region**: Choose closest to your users
6. Click "Create new project"
7. Wait for project initialization (2-3 minutes)

## 2. Get API Credentials

After project creation, go to Settings > API:

- **Project URL**: `https://your-project-ref.supabase.co`
- **API Keys**:
  - `anon public` key (for frontend)
  - `service_role` key (for backend - keep this secret!)

## 3. Set Up Database Schema

1. Go to SQL Editor in your Supabase dashboard
2. Copy the contents of `schema.sql` file
3. Paste and run the SQL to create:
   - `user_profiles` table (stores points, stats)
   - `game_history` table (tracks all games)
   - `leaderboard` view (ranked players)
   - Helper functions for user management

## 4. Configure Environment Variables

### Frontend (.env.local)
Create `web/.env.local`:
```env
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_anon_public_key_here
NEXT_PUBLIC_SUPABASE_SCHEMA=public
```

### Backend (.env)
Create `backend/.env`:
```env
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
SUPABASE_SCHEMA=public
```

## 5. Database Schema Overview

### Tables Created

#### `user_profiles`
- Stores user wallet addresses and game statistics
- New users automatically get 300 points
- Tracks total points earned for leaderboard
- Tracks wins/losses and total games played

#### `game_history`
- Records all completed games
- Supports both points and SOL games
- Tracks betting amounts and payouts
- Used for game statistics and transparency

#### `leaderboard` (View)
- Real-time ranking by total points earned
- Shows win rates and game statistics
- Automatically updates when games complete

### Key Features

#### Points System
- **New users**: 300 starting points
- **Game cost**: 100 points per game
- **Winner reward**: 100 points per win
- **SOL fallback**: When points < 100, user must use SOL

#### Database Functions
- `get_or_create_user_profile(wallet)`: Creates profile for new users
- `update_user_game_stats(wallet, won, points_change)`: Updates stats after games

## 6. Row Level Security (RLS)

The database includes proper security policies:
- Users can read all profiles (for leaderboard)
- Service role can manage all data
- Game history is publicly readable (transparency)

## 7. Testing the Setup

After configuration, test with:

```bash
# Backend
cd backend
npm test

# Frontend  
cd web
npm run dev
```

The application will warn if Supabase is not configured properly.

## 8. Next Steps

1. ✅ Database schema created
2. ✅ Environment variables configured  
3. 🔄 Integrate points system into game logic
4. 🔄 Add dual currency UI components
5. 🔄 Create leaderboard interface
6. 🔄 Test end-to-end points flow

## Troubleshooting

### Common Issues

1. **Environment variables not loaded**
   - Restart your development servers
   - Check file names (`.env.local` for Next.js)

2. **RLS policy errors**
   - Ensure you're using the service role key in backend
   - Check that policies allow the required operations

3. **Type errors**
   - Regenerate types: `npx supabase gen types typescript --project-id YOUR_PROJECT_ID`

### Support

- [Supabase Documentation](https://supabase.com/docs)
- [Supabase Discord](https://discord.supabase.io)
- Project dashboard: Your project settings page 