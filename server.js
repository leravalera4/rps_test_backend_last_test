const express = require('express');

// Silence console in production
if (process.env.NODE_ENV === 'production') {
  ['log', 'warn', 'info', 'debug', 'error'].forEach((m) => {
    // eslint-disable-next-line no-console
    console[m] = () => {};
  });
}

const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
require('dotenv').config();

// Import modules
const { router: gameRoutes, initializeSocketHandlers } = require('./src/routes/gameRoutes');
const socketHandlers = require('./src/socket/socketHandlers');
const autoFinalizationService = require('./src/services/autoFinalizationService');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  pingTimeout: 60000,    // 60 seconds
  pingInterval: 25000,   // 25 seconds
  transports: ['websocket', 'polling']
});     
       
// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/games', gameRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'RPS MagicBlock Backend Server',
    timestamp: new Date().toISOString()
  });
});

// Debug endpoint to check onchainStatus
app.get('/debug/onchain-status', (req, res) => {
  const status = socketHandlers.getOnchainStatus();
  res.json({
    onchainStatus: status,
    count: Object.keys(status).length,
    timestamp: new Date().toISOString()
  });
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log(`✅ Player connected: ${socket.id}`);
  console.log(`🔌 Socket transport: ${socket.conn.transport.name}`);
  console.log(`🔌 Socket readyState: ${socket.conn.readyState}`);
  
  // Debug: log ALL incoming events to catch onchain events BEFORE they reach handlers
  socket.onAny((eventName, ...args) => {
    // Log all events for debugging
    if (eventName === 'onchain_game_created' || eventName === 'onchain_game_joined') {
      console.log(`🔍 [DEBUG SERVER onAny] Received ${eventName} event on socket ${socket.id}:`, JSON.stringify(args));
      console.log(`🔍 [DEBUG SERVER onAny] Event data:`, args[0]);
      console.log(`🔍 [DEBUG SERVER onAny] Socket connected:`, socket.connected);
      console.log(`🔍 [DEBUG SERVER onAny] Socket transport:`, socket.conn.transport.name);
    }
  });
  
  // Also intercept at the engine level for onchain events
  const originalEmit = socket.emit.bind(socket);
  socket.emit = function(event, ...args) {
    if (event === 'onchain_game_created' || event === 'onchain_game_joined') {
      console.log(`🔍 [EMIT INTERCEPT] Socket ${socket.id} emitting ${event}:`, args[0]);
    }
    return originalEmit(event, ...args);
  };
  
  // Set up global handlers immediately for onchain events (as backup)
  socket.on('onchain_game_created', (data) => {
    console.log(`🔍 [GLOBAL HANDLER] onchain_game_created received on socket ${socket.id}:`, data);
    // Forward to socketHandlers - this ensures event is processed even if handlers aren't set up yet
    socketHandlers.handleOnchainGameCreated(socket, io, data);
  });
  
  socket.on('onchain_game_joined', (data) => {
    console.log(`🔍 [GLOBAL HANDLER] onchain_game_joined received on socket ${socket.id}:`, data);
    // Forward to socketHandlers
    socketHandlers.handleOnchainGameJoined(socket, io, data);
  });
  
  // Log socket connection events
  socket.conn.on('upgrade', () => {
    console.log(`🔄 Socket ${socket.id} upgraded to: ${socket.conn.transport.name}`);
  });
  
  // Also log when socket disconnects
  socket.on('disconnect', (reason) => {
    console.log(`❌ Socket ${socket.id} disconnected: ${reason}`);
  });
  
  socketHandlers.handleSocketConnection(socket, io);
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`RPS MagicBlock Backend Server running on port ${PORT}`);
  console.log(`WebSocket server ready for real-time gameplay`);
  
  // Initialize socket handlers reference in routes for HTTP fallback
  initializeSocketHandlers(socketHandlers, io);
  
  // Initialize auto-finalization service
  console.log(`🚀 Initializing auto-finalization service...`);
  autoFinalizationService.initializeService().then(() => {
    console.log(`✅ Modern blockchain game UX: Winners get SOL automatically!`);
  }).catch(err => {
    console.error(`❌ Failed to initialize auto-finalization service:`, err);
  });
}); 