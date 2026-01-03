import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '../.env' });

// Import routes
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import roomRoutes from './routes/rooms.js';
import leaderboardRoutes from './routes/leaderboard.js';

// Import socket handlers
import { initializeSocketHandlers } from './socket/index.js';

// Import database initialization
import { initializeDatabase } from './config/database.js';

// Import middleware
import { errorHandler } from './middleware/errorHandler.js';

// Import J-Archive scraper for Daily Challenge
import { getDailyChallenge } from './services/jarchiveScraper.js';

const app = express();
const httpServer = createServer(app);

// Allowed origins for CORS
const allowedOrigins = [
  process.env.CLIENT_URL,
  'http://localhost:5000',
  'http://localhost:5001',
].filter(Boolean);

// Socket.io setup
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// Express middleware
app.use(helmet({
  contentSecurityPolicy: false, // Disable for development
}));

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));

app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: { error: 'Too many requests, please try again later.' },
});
app.use('/api/', limiter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/leaderboard', leaderboardRoutes);

// Daily Challenge endpoint - scrapes J-Archive
app.get('/api/daily/challenge', async (req, res) => {
  try {
    const challenge = await getDailyChallenge();
    res.json(challenge);
  } catch (error) {
    console.error('Daily challenge error:', error);
    res.status(500).json({ error: 'Failed to fetch daily challenge' });
  }
});

// Error handling middleware
app.use(errorHandler);

// Initialize socket handlers
initializeSocketHandlers(io);

// Start server
const PORT = process.env.SERVER_PORT || 3001;

async function startServer() {
  try {
    // Initialize database
    await initializeDatabase();
    console.log('Database initialized successfully');

    // Start HTTP server
    httpServer.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`WebSocket server ready`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
