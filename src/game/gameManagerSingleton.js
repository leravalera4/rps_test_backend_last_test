/**
 * GameManager Singleton
 * Ensures single instance shared across HTTP routes and WebSocket handlers
 */

const GameManager = require('./gameManager');

// Create single instance
const gameManagerInstance = new GameManager();

// Export the singleton instance
module.exports = gameManagerInstance; 