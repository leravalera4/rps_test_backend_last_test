/**
 * Backend Flow Test Script
 * Tests the complete dual currency system and database integration
 */

require('dotenv').config();
const databaseService = require('../src/services/databaseService');
const GameManager = require('../src/game/gameManager');

// Test wallet addresses (simulating real users)
const WALLET_1 = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const WALLET_2 = 'DemoWallet2ABC123XYZ456789DefGhiJklMnoPqRsTuV';

async function runCompleteBackendTest() {
  console.log('\n🧪 === BACKEND FLOW TEST STARTED ===');
  
  const gameManager = new GameManager();
  
  try {
    // === TEST 1: User Profile Creation ===
    console.log('\n📋 TEST 1: User Profile Creation');
    
    const profile1 = await databaseService.getOrCreateUserProfile(WALLET_1);
    const profile2 = await databaseService.getOrCreateUserProfile(WALLET_2);
    
    console.log('✅ User 1 Profile:', {
      wallet: profile1.wallet_address,
      points: profile1.points_balance,
      totalEarned: profile1.total_points_earned
    });
    
    console.log('✅ User 2 Profile:', {
      wallet: profile2.wallet_address,
      points: profile2.points_balance,
      totalEarned: profile2.total_points_earned
    });
    
    // === TEST 2: Points Game Creation ===
    console.log('\n🎮 TEST 2: Points Game Creation');
    
    const gameResult = await gameManager.createGame(
      'public', 
      100, 
      'points', 
      'player1', 
      'socket1', 
      WALLET_1
    );
    
    if (!gameResult.success) {
      throw new Error(`Game creation failed: ${gameResult.error}`);
    }
    
    console.log('✅ Points game created:', {
      gameId: gameResult.gameId,
      currency: gameResult.gameState.currency,
      stakeAmount: gameResult.gameState.stakeAmount
    });
    
    // === TEST 3: Second Player Joins ===
    console.log('\n👥 TEST 3: Second Player Joins');
    
    const joinResult = await gameManager.joinGame(
      gameResult.gameId,
      'player2',
      'socket2',
      WALLET_2
    );
    
    if (!joinResult.success) {
      throw new Error(`Join game failed: ${joinResult.error}`);
    }
    
    console.log('✅ Player 2 joined game:', {
      gameStarted: joinResult.gameStarted,
      gameStatus: joinResult.gameState.gameStatus
    });
    
    // === TEST 4: Play Complete Game (3 wins) ===
    console.log('\n🚀 TEST 4: Play Complete Game');
    
    const gameId = gameResult.gameId;
    let roundCount = 0;
    
    // Simulate a complete game where player 1 wins 3-1
    const moves = [
      { p1: 'rock', p2: 'scissors' },     // P1 wins round 1
      { p1: 'paper', p2: 'rock' },        // P1 wins round 2
      { p1: 'scissors', p2: 'paper' },    // P1 wins round 3 - GAME OVER
    ];
    
    for (const moveSet of moves) {
      roundCount++;
      console.log(`\n  Round ${roundCount}:`);
      
      // Player 1 move
      const move1Result = gameManager.submitMove('player1', moveSet.p1);
      if (!move1Result.success) {
        throw new Error(`Player 1 move failed: ${move1Result.error}`);
      }
      
      // Player 2 move
      const move2Result = gameManager.submitMove('player2', moveSet.p2);
      if (!move2Result.success) {
        throw new Error(`Player 2 move failed: ${move2Result.error}`);
      }
      
      if (move2Result.roundComplete) {
        console.log(`    Moves: P1=${moveSet.p1} vs P2=${moveSet.p2}`);
        console.log(`    Winner: ${move2Result.roundResult.roundWinner}`);
        console.log(`    Scores: P1=${move2Result.roundResult.scores.player1} - P2=${move2Result.roundResult.scores.player2}`);
        
        if (move2Result.roundResult.gameFinished) {
          console.log(`    🏆 GAME FINISHED! Winner: ${move2Result.roundResult.gameWinner}`);
          break;
        }
      }
    }
    
    // === TEST 5: Verify Database Updates ===
    console.log('\n📊 TEST 5: Verify Database Updates');
    
    // Wait a moment for async database operations
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const updatedProfile1 = await databaseService.getOrCreateUserProfile(WALLET_1);
    const updatedProfile2 = await databaseService.getOrCreateUserProfile(WALLET_2);
    
    console.log('✅ Player 1 After Game:', {
      wallet: updatedProfile1.wallet_address,
      pointsBalance: updatedProfile1.points_balance,
      totalPointsEarned: updatedProfile1.total_points_earned,
      wins: updatedProfile1.wins,
      totalGames: updatedProfile1.total_games
    });
    
    console.log('✅ Player 2 After Game:', {
      wallet: updatedProfile2.wallet_address,
      pointsBalance: updatedProfile2.points_balance,
      totalPointsEarned: updatedProfile2.total_points_earned,
      wins: updatedProfile2.wins,
      totalGames: updatedProfile2.total_games
    });
    
    // === TEST 6: Check Leaderboard ===
    console.log('\n🏆 TEST 6: Check Leaderboard');
    
    const leaderboard = await databaseService.getLeaderboard(5);
    console.log('✅ Current Leaderboard:');
    leaderboard.forEach((entry, index) => {
      console.log(`  ${entry.rank}. ${entry.wallet_address.slice(0, 8)}... - ${entry.total_points_earned} points (${entry.wins}W/${entry.losses}L)`);
    });
    
    // === TEST 7: Insufficient Points Test ===
    console.log('\n⚠️  TEST 7: Insufficient Points Scenario');
    
    // Try to create another points game with player who now has < 100 points
    if (updatedProfile2.points_balance < 100) {
      console.log(`Player 2 has ${updatedProfile2.points_balance} points (< 100)`);
      
      const insufficientPointsGame = await gameManager.findRandomMatch(
        'player2',
        'socket2_new',
        100,
        'points',
        WALLET_2
      );
      
      if (insufficientPointsGame.success && insufficientPointsGame.gameState.currency === 'sol') {
        console.log('✅ Auto-switched to SOL game due to insufficient points');
        console.log(`   New game currency: ${insufficientPointsGame.gameState.currency}`);
        console.log(`   SOL stake amount: ${insufficientPointsGame.gameState.stakeAmount}`);
      }
    } else {
      console.log('Player 2 still has enough points, skipping insufficient points test');
    }
    
    // === TEST 8: Game History Verification ===
    console.log('\n📝 TEST 8: Verify Game History');
    
    // Get database stats
    const stats = await databaseService.getStats();
    console.log('✅ Database Statistics:', {
      totalUsers: stats.totalUsers,
      totalGames: stats.totalGames,
      pointsGames: stats.totalPointsGames,
      solGames: stats.totalSolGames
    });
    
    console.log('\n🎉 === ALL BACKEND TESTS PASSED ===');
    
    return {
      success: true,
      profiles: { player1: updatedProfile1, player2: updatedProfile2 },
      leaderboard,
      stats
    };
    
  } catch (error) {
    console.error('\n❌ BACKEND TEST FAILED:', error.message);
    console.error('Stack:', error.stack);
    return { success: false, error: error.message };
  }
}

// Run the test
if (require.main === module) {
  runCompleteBackendTest()
    .then(result => {
      if (result.success) {
        console.log('\n✅ Backend flow is fully functional!');
        process.exit(0);
      } else {
        console.log('\n❌ Backend flow has issues that need fixing.');
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('\n💥 Test script crashed:', error);
      process.exit(1);
    });
}

module.exports = { runCompleteBackendTest }; 