/**
 * WebSocket Integration Test
 * Tests real-time RPS gameplay functionality
 */

const io = require('socket.io-client');

// Test configuration
const SERVER_URL = 'http://localhost:3001';
const TEST_TIMEOUT = 10000; // 10 seconds

/**
 * Simple test runner
 */
function test(description, testFn) {
  return new Promise((resolve, reject) => {
    console.log(`Testing: ${description}`);
    
    const timeout = setTimeout(() => {
      reject(new Error('Test timeout'));
    }, TEST_TIMEOUT);
    
    testFn()
      .then(() => {
        clearTimeout(timeout);
        console.log(`✓ ${description}`);
        resolve();
      })
      .catch((error) => {
        clearTimeout(timeout);
        console.log(`✗ ${description}: ${error.message}`);
        reject(error);
      });
  });
}

/**
 * Create socket connection
 */
function createSocket(playerId) {
  const socket = io(SERVER_URL, {
    transports: ['websocket'],
    forceNew: true
  });
  
  return new Promise((resolve, reject) => {
    socket.on('connect', () => {
      // Register player
      socket.emit('register_player', { playerId });
      socket.on('player_registered', (data) => {
        if (data.success) {
          resolve(socket);
        } else {
          reject(new Error('Failed to register player'));
        }
      });
    });
    
    socket.on('connect_error', reject);
    
    setTimeout(() => {
      reject(new Error('Connection timeout'));
    }, 5000);
  });
}

/**
 * Test complete game flow
 */
async function testCompleteGameFlow() {
  console.log('\nTesting Complete Game Flow...\n');
  
  let player1Socket, player2Socket;
  let gameId;
  
  try {
    // Step 1: Connect two players
    await test('Connect Player 1', async () => {
      player1Socket = await createSocket('player1');
    });
    
    await test('Connect Player 2', async () => {
      player2Socket = await createSocket('player2');
    });
    
    // Step 2: Player 1 creates a game
    await test('Player 1 creates game', async () => {
      return new Promise((resolve, reject) => {
        player1Socket.emit('create_game', {
          gameType: 'public',
          stakeAmount: 0
        });
        
        player1Socket.on('game_created', (data) => {
          if (data.success) {
            gameId = data.gameId;
            console.log(`   Game created: ${gameId}`);
            resolve();
          } else {
            reject(new Error('Failed to create game'));
          }
        });
      });
    });
    
    // Step 3: Player 2 joins the game
    await test('Player 2 joins game', async () => {
      return new Promise((resolve, reject) => {
        player2Socket.emit('join_game', { gameId });
        
        player2Socket.on('game_joined', (data) => {
          if (data.success) {
            console.log(`   Player 2 joined game: ${gameId}`);
            resolve();
          } else {
            reject(new Error('Failed to join game'));
          }
        });
      });
    });
    
    // Step 4: Wait for game to start
    await test('Game starts automatically', async () => {
      return new Promise((resolve, reject) => {
        const gameStartHandler = (data) => {
          console.log(`   Game started: ${data.gameId}`);
          resolve();
        };
        
        player1Socket.on('game_started', gameStartHandler);
        player2Socket.on('game_started', gameStartHandler);
      });
    });
    
    // Step 5: Play a round
    await test('Players submit moves', async () => {
      return new Promise((resolve, reject) => {
        let roundCompleted = false;
        
        const roundHandler = (data) => {
          if (!roundCompleted) {
            roundCompleted = true;
            console.log(`   Round completed: Player 1 (rock) vs Player 2 (scissors)`);
            console.log(`   Round winner: ${data.roundResult.roundWinner}`);
            console.log(`   Scores: P1=${data.roundResult.scores.player1}, P2=${data.roundResult.scores.player2}`);
            resolve();
          }
        };
        
        player1Socket.on('round_completed', roundHandler);
        player2Socket.on('round_completed', roundHandler);
        
        // Submit moves
        player1Socket.emit('submit_move', { move: 'rock' });
        player2Socket.emit('submit_move', { move: 'scissors' });
      });
    });
    
    // Step 6: Complete the game (Player 1 wins 3-0)
    await test('Complete game (first to 3 wins)', async () => {
      return new Promise((resolve, reject) => {
        let gameFinished = false;
        
        const gameFinishHandler = (data) => {
          if (!gameFinished) {
            gameFinished = true;
            console.log(`   Game finished!`);
            console.log(`    Winner: ${data.winner.playerId} (${data.winner.position})`);
            console.log(`    Payout: ${data.payout.winnerPayout} SOL (95%)`);
            console.log(`    Platform fee: ${data.payout.platformFee} SOL (5%)`);
            resolve();
          }
        };
        
        player1Socket.on('game_finished', gameFinishHandler);
        player2Socket.on('game_finished', gameFinishHandler);
        
        // Player 1 wins 2 more rounds to reach 3 total wins
        setTimeout(() => {
          player1Socket.emit('submit_move', { move: 'rock' });
          player2Socket.emit('submit_move', { move: 'scissors' });
        }, 100);
        
        setTimeout(() => {
          player1Socket.emit('submit_move', { move: 'rock' });
          player2Socket.emit('submit_move', { move: 'scissors' });
        }, 200);
      });
    });
    
    console.log('\nComplete game flow test successful!');
    
  } catch (error) {
    console.error(`\nGame flow test failed: ${error.message}`);
    throw error;
  } finally {
    // Cleanup
    if (player1Socket) player1Socket.disconnect();
    if (player2Socket) player2Socket.disconnect();
  }
}

/**
 * Test random matchmaking
 */
async function testRandomMatchmaking() {
  console.log('\nTesting Random Matchmaking...\n');
  
  let player1Socket, player2Socket;
  
  try {
    await test('Random matchmaking test', async () => {
      return new Promise(async (resolve, reject) => {
        // Connect both players
        player1Socket = await createSocket('random_player1');
        player2Socket = await createSocket('random_player2');
        
        let matchFound = false;
        
        const matchHandler = (data) => {
          if (!matchFound) {
            matchFound = true;
            console.log(`   Random match found: ${data.gameId}`);
            resolve();
          }
        };
        
        player1Socket.on('match_found', matchHandler);
        player2Socket.on('match_found', matchHandler);
        
        // Both players request random match
        player1Socket.emit('find_random_match', { stakeAmount: 0 });
        player2Socket.emit('find_random_match', { stakeAmount: 0 });
      });
    });
    
    console.log('\nRandom matchmaking test successful!');
    
  } catch (error) {
    console.error(`\nRandom matchmaking test failed: ${error.message}`);
    throw error;
  } finally {
    // Cleanup
    if (player1Socket) player1Socket.disconnect();
    if (player2Socket) player2Socket.disconnect();
  }
}

/**
 * Run all tests
 */
async function runTests() {
  console.log('Starting WebSocket Integration Tests...');
  console.log(`Testing server: ${SERVER_URL}\n`);
  
  try {
    await testCompleteGameFlow();
    await testRandomMatchmaking();
    
    console.log('\nAll WebSocket tests completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error(`\nTests failed: ${error.message}`);
    process.exit(1);
  }
}

// Start tests
runTests(); 