/**
 * Simple Move Utility
 * Provides a simplified interface for submitting moves and leaving games
 * Used as a fallback mechanism for the backend
 */

const { io } = require('socket.io-client');

/**
 * Create a simple move utility
 * @returns {Object} Simple move utility functions
 */
function useSimpleMove() {
  /**
   * Submit a move using a fresh socket connection
   * @param {string} gameId - Game ID
   * @param {string} playerId - Player ID
   * @param {string} move - Move to submit (rock, paper, scissors)
   */
  const submitMove = (gameId, playerId, move) => {
    console.log('🔥 Using simple move backend fallback for:', { gameId, playerId, move });
    
    // Create a fresh socket connection just for this move
    const socket = io('http://localhost:3001', {
      transports: ['polling', 'websocket'],
      timeout: 5000,
      forceNew: true, // Always create a new connection
    });

    socket.on('connect', () => {
      console.log('🔥 Simple move socket connected:', socket.id);
      
      // Submit the move immediately upon connection
      socket.emit('submit_move', {
        gameId,
        playerId,
        move,
      });
      
      console.log('🔥 Simple move submitted via fresh socket');
      
      // Disconnect after a short delay to ensure the message is sent
      setTimeout(() => {
        socket.disconnect();
      }, 1000);
    });

    socket.on('connect_error', (error) => {
      console.error('🔥 Simple move socket error:', error);
      socket.disconnect();
    });
  };

  /**
   * Leave a game using a fresh socket connection
   * @param {string} gameId - Game ID
   * @param {string} playerId - Player ID
   */
  const leaveGame = (gameId, playerId) => {
    console.log('🚪 Using fresh socket to leave game:', { gameId, playerId });
    
    // Create a fresh socket connection just for leaving
    const socket = io('http://localhost:3001', {
      transports: ['polling', 'websocket'],
      timeout: 5000,
      forceNew: true, // Always create a new connection
    });

    socket.on('connect', () => {
      console.log('🚪 Leave game socket connected:', socket.id);
      
      // Send leave_game event immediately upon connection
      socket.emit('leave_game', {
        gameId,
        playerId,
      });
      
      console.log('🚪 Leave game event sent via fresh socket');
      
      // Disconnect after a short delay to ensure the message is sent
      setTimeout(() => {
        socket.disconnect();
      }, 1000);
    });

    socket.on('connect_error', (error) => {
      console.error('🚪 Leave game socket error:', error);
      socket.disconnect();
    });
  };

  return {
    submitMove,
    leaveGame
  };
}

module.exports = { useSimpleMove }; 