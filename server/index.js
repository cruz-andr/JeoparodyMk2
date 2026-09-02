import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import { aiLimiter, apiLimiter, authLimiter, ON_FLY } from './middleware/rateLimit.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '../.env' });

// Import routes
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import roomRoutes from './routes/rooms.js';
import leaderboardRoutes from './routes/leaderboard.js';
import boardRoutes from './routes/boards.js';
import aiRoutes from './routes/ai.js';
import gameRoutes from './routes/games.js';

// Import socket handlers
import { initializeSocketHandlers } from './socket/index.js';

// Import database initialization
import { initializeDatabase } from './config/database.js';

// Import middleware
import { errorHandler } from './middleware/errorHandler.js';
import { info as logInfo, error as logError, fatal as logFatal } from './utils/log.js';

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

/* The model. The key lives here and only here; see services/gemini.js. Its
   own budget sits on top of the general one because every call here is paid
   for. */
app.use('/api/ai', aiLimiter, aiRoutes);

// Daily Challenge endpoint - scrapes J-Archive
app.get('/api/daily/challenge', async (req, res) => {
  try {
    const challenge = await getDailyChallenge();
    res.json(challenge);
  } catch (error) {
    logError({ msg: 'Daily challenge failed', path: req.originalUrl, method: req.method }, error);
    res.status(500).json({ error: 'Failed to fetch daily challenge' });
  }
});

// Error handling middleware
app.use(errorHandler);

// Initialize socket handlers
initializeSocketHandlers(io);

/* Crashes.

   Node 22 already exits on an uncaught exception and on an unhandled
   rejection; what it prints on the way out is a multi-line dump that Fly's
   log collector splits into as many entries as it has lines. Both now log
   one JSON line {level, msg, err, stack} and exit non-zero on purpose, so the
   crash is one searchable entry and Fly restarts the machine into a known
   state rather than us guessing which rooms survived. */
function die(kind, reason) {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  logFatal({ msg: kind, err: err.message, stack: err.stack });
  process.exit(1);
}
process.on('uncaughtException', (err) => die('uncaughtException', err));
process.on('unhandledRejection', (reason) => die('unhandledRejection', reason));

/* Fly sends SIGTERM before it stops a machine. Stop accepting, close the
   sockets so clients reconnect to the new machine promptly instead of waiting
   out pingTimeout, and give in-flight requests a moment to finish. Fly's
   default kill_timeout is five seconds (fly.toml does not raise it), so the
   deadline sits a second inside that: if a keep-alive connection will not let
   go, the timeout line is written and we exit on our own terms before the
   SIGKILL lands. */
const SHUTDOWN_MS = 4000;
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logInfo({ msg: 'Shutting down', signal });

  const deadline = setTimeout(() => {
    logError({ msg: 'Shutdown timed out, exiting anyway', signal, timeoutMs: SHUTDOWN_MS });
    process.exit(1);
  }, SHUTDOWN_MS);
  deadline.unref();

  /* io.close() disconnects every socket, then closes the http server it is
     attached to and hands us that close's error, if any. A server that was
     not running (or was closed already) is not a clean shutdown, so the error
     is checked rather than closed over a second time. */
  io.close((err) => {
    clearTimeout(deadline);
    if (err) {
      logError({ msg: 'Shutdown finished with an error', signal }, err);
      process.exit(1);
    }
    logInfo({ msg: 'Closed cleanly', signal });
    process.exit(0);
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Start server
const PORT = process.env.SERVER_PORT || 3001;

async function startServer() {
  try {
    // Initialize database
    await initializeDatabase();
    logInfo({ msg: 'Database initialized' });

    // Start HTTP server
    httpServer.listen(PORT, '0.0.0.0', () => {
      logInfo({ msg: 'Server running', port: httpServer.address().port, websocket: 'ready' });
    });
  } catch (error) {
    logFatal({ msg: 'Failed to start server' }, error);
    process.exit(1);
  }
}

startServer();
