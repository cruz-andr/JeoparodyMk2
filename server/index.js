import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import { apiLimiter, authLimiter, ON_FLY } from './middleware/rateLimit.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '../.env' });

// Import routes
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import roomRoutes from './routes/rooms.js';
import leaderboardRoutes from './routes/leaderboard.js';
import boardRoutes from './routes/boards.js';
import gameRoutes from './routes/games.js';

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
  'http://localhost:4173', // vite preview, i.e. testing a production build locally
  'https://jeoparody.andrescruz.xyz', // the canonical domain
  'https://jeoparody-mk2.vercel.app', // kept: the old URL still resolves
  'https://jeoparody.app',
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
  maxHttpBufferSize: 10 * 1024 * 1024, // 10MB for base64 media in questions
});

// Express middleware
app.use(helmet({
  contentSecurityPolicy: false, // Disable for development
}));

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  /* X-Player-Key is how a signed-out visitor is told apart from a reload; see
     the play counter in routes/boards.js. */
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Player-Key'],
  /* The RateLimit headers are useless to a browser unless they are exposed:
     cross-origin, script can only read the handful the server names here. */
  exposedHeaders: ['RateLimit', 'RateLimit-Policy', 'Retry-After'],
}));

/* Two body parsers, because boards are a different size of thing.

   The default cap is 100KB, which is right for every other endpoint and far
   too small for a board: MediaAttachment compresses an image to 800px WebP and
   stores it as a base64 data URL, so a single image clue can be most of that
   budget and a board carrying several could never be saved. It would fail as a
   bare 413 with no message we wrote, which is the hardest kind to recognise.

   This has to be a fork rather than a second parser mounted on the boards
   router: whichever parser runs first is the one that enforces the limit, and
   a global express.json() would already have rejected the body before the
   router ever saw it. */
const parseJson = express.json();
const parseBoardJson = express.json({ limit: '4mb' });

app.use((req, res, next) => {
  if (req.path.startsWith('/api/boards')) return parseBoardJson(req, res, next);
  return parseJson(req, res, next);
});

/* Behind Fly there is exactly one proxy in front of us. Saying so is what
   makes req.ip, req.protocol and req.secure mean anything; left at the default
   they describe the proxy rather than the visitor.

   The rate limiter does not rely on this. It reads Fly-Client-IP, which Fly
   writes itself and a client cannot forge, precisely because X-Forwarded-For
   can be. See middleware/rateLimit.js. */
if (ON_FLY) app.set('trust proxy', 1);

/* Signing in is limited harder than everything else, and separately, so that
   somebody guessing passwords cannot also lock the rest of the API. */
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/', apiLimiter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/leaderboard', leaderboardRoutes);

app.use('/api/boards', boardRoutes);
app.use('/api/games', gameRoutes);

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
    httpServer.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`WebSocket server ready`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
