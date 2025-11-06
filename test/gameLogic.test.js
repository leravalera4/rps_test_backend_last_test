/**
 * Basic Game Logic Tests
 * Simple tests for RPS game mechanics
 */

const { 
  determineWinner, 
  createGameState, 
  processMove, 
  addPlayer 
} = require('../src/game/gameLogic');

/**
 * Simple test function
 */
function test(description, testFn) {
  try {
    testFn();
    console.log(`✓ ${description}`);
  } catch (error) {
    console.log(`✗ ${description}: ${error.message}`);
  }
}

/**
 * Test assertion helper
 */
function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

// Run tests
console.log('Running RPS Game Logic Tests...\n');

// Test move determination
test('Rock beats Scissors', () => {
  assert(determineWinner('rock', 'scissors') === 'player1', 'Rock should beat scissors');
});

test('Scissors beats Paper', () => {
  assert(determineWinner('scissors', 'paper') === 'player1', 'Scissors should beat paper');
});

test('Paper beats Rock', () => {
  assert(determineWinner('paper', 'rock') === 'player1', 'Paper should beat rock');
});

test('Same moves result in draw', () => {
  assert(determineWinner('rock', 'rock') === 'draw', 'Same moves should result in draw');
  assert(determineWinner('paper', 'paper') === 'draw', 'Same moves should result in draw');
  assert(determineWinner('scissors', 'scissors') === 'draw', 'Same moves should result in draw');
});

// Test game state creation
test('Game state creation', () => {
  const gameState = createGameState('test-game-id', 'public', 1);
  assert(gameState.gameId === 'test-game-id', 'Game ID should match');
  assert(gameState.gameType === 'public', 'Game type should match');
  assert(gameState.stakeAmount === 1, 'Stake amount should match');
  assert(gameState.currentRound === 0, 'Round should start at 0');
  assert(gameState.player1.wins === 0, 'Player 1 wins should start at 0');
  assert(gameState.player2.wins === 0, 'Player 2 wins should start at 0');
});

// Test adding players
test('Adding players to game', () => {
  const gameState = createGameState('test-game-id');
  
  // Add first player
  const result1 = addPlayer(gameState, 'player1', 'socket1');
  assert(result1.playerPosition === 'player1', 'First player should be player1');
  assert(gameState.gameStatus === 'waiting_for_player', 'Should wait for second player');
  
  // Add second player
  const result2 = addPlayer(gameState, 'player2', 'socket2');
  assert(result2.playerPosition === 'player2', 'Second player should be player2');
  assert(gameState.gameStatus === 'playing', 'Game should start when both players joined');
});

// Test move processing
test('Move processing', () => {
  const gameState = createGameState('test-game-id');
  addPlayer(gameState, 'player1', 'socket1');
  addPlayer(gameState, 'player2', 'socket2');
  
  // Submit first move
  const result1 = processMove(gameState, 'player1', 'rock');
  assert(!result1.roundComplete, 'Round should not be complete with one move');
  assert(gameState.player1.currentMove === 'rock', 'Player 1 move should be recorded');
  
  // Submit second move
  const result2 = processMove(gameState, 'player2', 'scissors');
  assert(result2.roundComplete, 'Round should be complete with both moves');
  assert(result2.roundResult.roundWinner === 'player1', 'Player 1 should win (rock beats scissors)');
  assert(gameState.player1.wins === 1, 'Player 1 should have 1 win');
  assert(gameState.currentRound === 1, 'Round counter should increment');
});

// Test draw handling
test('Draw handling', () => {
  const gameState = createGameState('test-game-id');
  addPlayer(gameState, 'player1', 'socket1');
  addPlayer(gameState, 'player2', 'socket2');
  
  // Both players choose rock
  processMove(gameState, 'player1', 'rock');
  const result = processMove(gameState, 'player2', 'rock');
  
  assert(result.roundResult.roundWinner === 'draw', 'Should be a draw');
  assert(gameState.player1.wins === 0, 'Player 1 wins should not increment');
  assert(gameState.player2.wins === 0, 'Player 2 wins should not increment');
  assert(gameState.currentRound === 1, 'Round counter should still increment');
});

// Test game completion
test('Game completion (first to 3 wins)', () => {
  const gameState = createGameState('test-game-id');
  addPlayer(gameState, 'player1', 'socket1');
  addPlayer(gameState, 'player2', 'socket2');
  
  // Player 1 wins 3 rounds
  for (let i = 0; i < 3; i++) {
    processMove(gameState, 'player1', 'rock');
    const result = processMove(gameState, 'player2', 'scissors');
    
    if (i === 2) {
      // Third win should end the game
      assert(result.roundResult.gameFinished, 'Game should be finished');
      assert(gameState.gameStatus === 'finished', 'Game status should be finished');
      assert(gameState.winner === 'player1', 'Player 1 should be the winner');
    }
  }
});

console.log('\nAll tests completed successfully!');
console.log('\nTo run this test file:');
console.log('cd backend && node test/gameLogic.test.js'); 