import SplashScreen from '../components/splash/SplashScreen';
import { usePageTitle } from '../hooks/usePageTitle';

export default function SplashPage() {
  usePageTitle('Jeoparody');
  return <SplashScreen />;
}
