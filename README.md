# Jeoparody!

An AI-powered Jeopardy game built with React and Google Gemini. Features single-player, multiplayer, and educator modes with AI-generated questions.

## Features

- **5 Game Modes**:
  - **Single Player** - Play solo with AI-generated questions, track highscores
  - **Quickplay** - Match with random players for a fast game
  - **Multiplayer** - Create private rooms and invite friends
  - **Host/Educator** - Custom questions, manual judging (for classrooms)
  - **Join Room** - Enter a code to join any game

- **Classic Jeopardy Gameplay**:
  - 6 categories, 5 questions each ($200-$1000)
  - Double Jeopardy round (doubled point values)
  - Daily Double with wagering
  - Final Jeopardy

- **AI-Powered**: Google Gemini generates categories and questions for any topic
- **Customizable Settings**: Timer duration, enable/disable rounds, audio controls
- **Real-time Multiplayer**: Socket.io for live game synchronization

## Quick Start

### Prerequisites

- Node.js 18+
- npm or yarn
- Google Gemini API key ([Get one here](https://aistudio.google.com/apikey))

### 1. Install Dependencies

```bash
# Frontend dependencies
npm install

# Backend dependencies
cd server
npm install
cd ..
```

### 2. Configure Environment

Create a `.env` file in the project root:

```env
VITE_GEMINI_API_KEY=your_gemini_api_key_here
VITE_SOCKET_URL=http://localhost:3001
```

### 3. Start the Application

#### Option A: Frontend Only (Single Player)

```bash
npm run dev
```

Open http://localhost:5000

#### Option B: Full Application (Multiplayer)

**Terminal 1 - Start Backend:**
```bash
cd server
npm start
```
Backend runs on http://localhost:3001

**Terminal 2 - Start Frontend:**
```bash
npm run dev
```
Frontend runs on http://localhost:5000

## How to Play

### Single Player
1. Click "Single Player" from the main menu
2. Enter a genre/topic (e.g., "Space", "90s Movies")
3. Edit AI-generated categories if desired
4. Click any dollar amount to see the clue
5. Click "Reveal Answer" to see the correct response
6. Self-score with "Correct" or "Incorrect" buttons

### Multiplayer
1. Click "Multiplayer" to create a room
2. Share the 6-character room code with friends
3. Friends click "Join Room" and enter the code
4. Host starts the game when all players are ready
5. Take turns selecting questions and buzzing in

## Tech Stack

### Frontend
- **React 19** - UI framework
- **Vite** - Build tool
- **Zustand** - State management
- **React Router v7** - Navigation
- **Framer Motion** - Animations
- **Howler.js** - Audio playback
- **Socket.io Client** - Real-time communication

### Backend
- **Node.js + Express** - Server framework
- **Socket.io** - WebSocket server
- **SQLite** - Database (via better-sqlite3)
- **JWT** - Authentication

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start frontend dev server (port 5000) |
| `npm run build` | Build frontend for production |
| `npm run preview` | Preview production build |
| `npm run lint` | Run ESLint |
| `cd server && npm start` | Start backend server (port 3001) |

## Project Structure

```
├── src/
│   ├── components/
│   │   ├── common/          # Timer, SettingsModal
│   │   ├── game/            # GameBoard, QuestionModal, DailyDoubleModal
│   │   ├── menu/            # MainMenu
│   │   ├── setup/           # GenreSelector, CategoryEditor
│   │   └── splash/          # SplashScreen
│   ├── pages/               # Route pages
│   ├── stores/              # Zustand state stores
│   ├── hooks/               # Custom React hooks
│   ├── services/
│   │   ├── api/             # AI service
│   │   └── socket/          # Socket.io client
│   ├── styles/              # Global CSS
│   └── assets/              # Images, audio
├── server/
│   ├── routes/              # API routes
│   ├── socket/              # Socket handlers
│   ├── middleware/          # Auth, error handling
│   └── db/                  # Database setup
├── public/
│   └── audio/               # Audio files (add your own)
└── .env                     # Environment variables
```

## Audio Files

To add sound effects, place MP3 files in `public/audio/`:
- `theme.mp3` - Background music
- `daily-double.mp3` - Daily Double reveal
- `correct.mp3` - Correct answer
- `wrong.mp3` - Wrong answer
- `timer-tick.mp3` - Timer countdown
- `final-jeopardy.mp3` - Final Jeopardy theme

## License

MIT
