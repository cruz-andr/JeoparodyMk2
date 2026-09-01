import { lazy, Suspense, useEffect } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { useSettingsStore } from './stores/settingsStore';
import ErrorBoundary from './components/common/ErrorBoundary';
/* Not lazy. A chunk that fails to load is one of the errors this page
   exists to show, and the page for that cannot itself be a chunk. It draws
   NotFoundPage for a 404, so that page is in the main chunk too; a lazy()
   around it here would be inert, and Vite says so on every build. */
import RouteErrorPage from './pages/RouteErrorPage';
import NotFoundPage from './pages/NotFoundPage';
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
const ProjectorPage = lazy(() => import('./pages/ProjectorPage'));
const HighscoresPage = lazy(() => import('./pages/HighscoresPage'));
const DailyPage = lazy(() => import('./pages/DailyPage'));
const DailyBoardPage = lazy(() => import('./pages/DailyBoardPage'));
const PrivacyPage = lazy(() => import('./pages/PrivacyPage'));
const SignUpPage = lazy(() => import('./pages/SignUpPage'));
const SignInPage = lazy(() => import('./pages/SignInPage'));
const AuthCallbackPage = lazy(() => import('./pages/AuthCallbackPage'));
const AccountPage = lazy(() => import('./pages/AccountPage'));
const AccountNamePage = lazy(() => import('./pages/AccountNamePage'));
const AccountUsernamePage = lazy(() => import('./pages/AccountUsernamePage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const ProfileEditPage = lazy(() => import('./pages/ProfileEditPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const BoardsMinePage = lazy(() => import('./pages/BoardsMinePage'));
const BoardPage = lazy(() => import('./pages/BoardPage'));
const BoardEditPage = lazy(() => import('./pages/BoardEditPage'));
const BoardsBrowsePage = lazy(() => import('./pages/BoardsBrowsePage'));
const GuidelinesPage = lazy(() => import('./pages/GuidelinesPage'));

function PageLoader() {
  return (
    <div style={{
      height: '100vh',
      background: '#020820',
    }} />
  );
}

/* One pathless root holds every page so a single errorElement covers them
   all. Without it react-router draws its own error page, which tells the
   visitor to check the console and is addressed to a developer. */
const routes = [
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
  /* The screen behind the host in projector mode: a second window, driven by
     the host's window, that never carries an answer. */
  { path: '/project/:roomCode', element: <ProjectorPage /> },
  { path: '/highscores', element: <HighscoresPage /> },
  { path: '/privacy', element: <PrivacyPage /> },
  { path: '/signup', element: <SignUpPage /> },
  { path: '/signin', element: <SignInPage /> },
  { path: '/auth/callback', element: <AuthCallbackPage /> },
  { path: '/account', element: <AccountPage /> },
  { path: '/account/name', element: <AccountNamePage /> },
  { path: '/account/username', element: <AccountUsernamePage /> },
  { path: '/profile', element: <ProfilePage /> },
  { path: '/profile/edit', element: <ProfileEditPage /> },
  { path: '/settings', element: <SettingsPage /> },

  /* Community Boards. /boards/mine before /boards/:slug, or "mine" is read as
     a slug and the shelf becomes a 404. */
  { path: '/boards', element: <BoardsBrowsePage /> },
  { path: '/boards/mine', element: <BoardsMinePage /> },
  { path: '/boards/:slug', element: <BoardPage /> },
  { path: '/boards/:slug/edit', element: <BoardEditPage /> },
  { path: '/guidelines', element: <GuidelinesPage /> },

  /* Last, and matched only when nothing above did. */
  { path: '*', element: <NotFoundPage /> },
];

const router = createBrowserRouter([
  { errorElement: <RouteErrorPage />, children: routes },
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
    <ErrorBoundary>
      <Suspense fallback={<PageLoader />}>
        <RouterProvider router={router} />
      </Suspense>
    </ErrorBoundary>
  );
}

export default App;
