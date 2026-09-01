import { useEffect } from 'react';
import { isRouteErrorResponse, useRouteError } from 'react-router-dom';
import ErrorScreen, { MenuLink } from '../components/common/ErrorScreen';
import { VISITOR_COPY, reportError } from '../components/common/errorReport';
import NotFoundPage from './NotFoundPage';

/**
 * The router's errorElement.
 *
 * Without one, react-router draws its own page: a stack trace and a note to
 * "Hey developer". Anything thrown while a route renders, including a page
 * chunk that fails to load, lands here instead. A 404 response is a wrong
 * address and gets that screen; everything else is a crash and gets this one.
 */
export default function RouteErrorPage() {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;

  useEffect(() => {
    if (!notFound) reportError(error, {});
  }, [error, notFound]);

  if (notFound) return <NotFoundPage />;

  return (
    <ErrorScreen title={VISITOR_COPY.broke.title} body={VISITOR_COPY.broke.body}>
      <button type="button" className="plain-btn quiet-action" onClick={() => window.location.reload()}>
        Try again
      </button>
      <MenuLink />
    </ErrorScreen>
  );
}
