import { Link } from 'react-router-dom';
import ErrorScreen from '../components/common/ErrorScreen';
import { VISITOR_COPY } from '../components/common/errorReport';

/**
 * A wrong address.
 *
 * Reached two ways: the catch-all "*" route in App.jsx, and the route error
 * screen when a loader answers 404. Inside the router, so the way back is a
 * Link and does not reload the app.
 */
export default function NotFoundPage() {
  return (
    <ErrorScreen title={VISITOR_COPY.notFound.title} body={VISITOR_COPY.notFound.body}>
      <Link className="quiet-action" to="/menu">Back to the menu</Link>
    </ErrorScreen>
  );
}
