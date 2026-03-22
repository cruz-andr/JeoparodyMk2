import { lazy, Suspense } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import './styles/globals.css';

// Lazy-load all pages — each becomes its own chunk,
// preventing Rollup scope hoisting from merging all page
// dependencies into one scope (which causes TDZ errors)
const SplashPage = lazy(() => import('./pages/SplashPage'));
const HomePage = lazy(() => import('./pages/HomePage'));
const SinglePlayerPage = lazy(() => import('./pages/SinglePlayerPage'));
const QuickplayPage = lazy(() => import('./pages/QuickplayPage'));
const MultiplayerPage = lazy(() => import('./pages/MultiplayerPage'));
const HostPage = lazy(() => import('./pages/HostPage'));
const JoinPage = lazy(() => import('./pages/JoinPage'));
const GamePage = lazy(() => import('./pages/GamePage'));
const HighscoresPage = lazy(() => import('./pages/HighscoresPage'));
const DailyPage = lazy(() => import('./pages/DailyPage'));

function PageLoader() {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      height: '100vh',
      background: '#060CE9',
      color: '#FFCC00',
      fontFamily: 'serif',
      fontSize: '1.5rem',
    }}>
      Loading...
    </div>
  );
}

const router = createBrowserRouter([
  { path: '/', element: <SplashPage /> },
  { path: '/menu', element: <HomePage /> },
  { path: '/daily', element: <DailyPage /> },
  { path: '/singleplayer', element: <SinglePlayerPage /> },
  { path: '/quickplay', element: <QuickplayPage /> },
  { path: '/multiplayer', element: <MultiplayerPage /> },
  { path: '/host', element: <HostPage /> },
  { path: '/join', element: <JoinPage /> },
  { path: '/join/:roomCode', element: <JoinPage /> },
  { path: '/game/:roomCode', element: <GamePage /> },
  { path: '/highscores', element: <HighscoresPage /> },
]);

function App() {
  return (
    <Suspense fallback={<PageLoader />}>
      <RouterProvider router={router} />
    </Suspense>
  );
}

export default App;
