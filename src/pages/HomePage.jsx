import MainMenu from '../components/menu/MainMenu';
import { usePageTitle } from '../hooks/usePageTitle';

export default function HomePage() {
  usePageTitle('Jeoparody');
  return <MainMenu />;
}
