import { lazy, Suspense, useEffect } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { useSettingsStore } from './stores/settingsStore';
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
const DailyBoardPage = lazy(() => import('./pages/DailyBoardPage'));
const PrivacyPage = lazy(() => import('./pages/PrivacyPage'));

function PageLoader() {
  return (
    <div style={{
      height: '100vh',
      background: '#020820',
    }} />
  );
}

const router = createBrowserRouter([
  { path: '/', element: <SplashPage /> },
  { path: '/menu', element: <HomePage /> },
  { path: '/daily', element: <DailyPage /> },
  { path: '/daily/board', element: <DailyBoardPage /> },
  { path: '/singleplayer', element: <SinglePlayerPage /> },
  { path: '/quickplay', element: <QuickplayPage /> },
  { path: '/multiplayer', element: <MultiplayerPage /> },
  { path: '/host', element: <HostPage /> },
  { path: '/join', element: <JoinPage /> },
  { path: '/join/:roomCode', element: <JoinPage /> },
  { path: '/game/:roomCode', element: <GamePage /> },
  { path: '/highscores', element: <HighscoresPage /> },
  { path: '/privacy', element: <PrivacyPage /> },
]);

function App() {
  /* Text size is set on the document rather than passed down, because it has to
     reach every page including the ones rendered inside a portal. Type here is
     mostly in rem, so moving the root size moves the whole app with it. */
  const textScale = useSettingsStore((s) => s.textScale);
  useEffect(() => {
    document.documentElement.dataset.textScale = textScale;
  }, [textScale]);

  return (
    <Suspense fallback={<PageLoader />}>
      <RouterProvider router={router} />
    </Suspense>
  );
}

export default App;
