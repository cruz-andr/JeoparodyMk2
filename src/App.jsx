import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import {
  SplashPage,
  HomePage,
  SinglePlayerPage,
  QuickplayPage,
  MultiplayerPage,
  HostPage,
  JoinPage,
  GamePage,
  HighscoresPage,
} from './pages';
import DailyPage from './pages/DailyPage';
import './styles/globals.css';

const router = createBrowserRouter([
  {
    path: '/',
    element: <SplashPage />,
  },
  {
    path: '/menu',
    element: <HomePage />,
  },
  {
    path: '/daily',
    element: <DailyPage />,
  },
  {
    path: '/singleplayer',
    element: <SinglePlayerPage />,
  },
  {
    path: '/quickplay',
    element: <QuickplayPage />,
  },
  {
    path: '/multiplayer',
    element: <MultiplayerPage />,
  },
  {
    path: '/host',
    element: <HostPage />,
  },
  {
    path: '/join',
    element: <JoinPage />,
  },
  {
    path: '/join/:roomCode',
    element: <JoinPage />,
  },
  {
    path: '/game/:roomCode',
    element: <GamePage />,
  },
  {
    path: '/highscores',
    element: <HighscoresPage />,
  },
]);

function App() {
  return <RouterProvider router={router} />;
}

export default App;
