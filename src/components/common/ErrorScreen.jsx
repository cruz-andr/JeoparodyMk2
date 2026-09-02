import './ErrorScreen.css';

/**
 * The one screen behind every dead end.
 *
 * Takes a title and a sentence and the actions as children, and knows nothing
 * about routers or errors, so it can be drawn from inside a route, from an
 * errorElement, and from a boundary outside the router alike. The "Back to
 * the menu" link is a plain anchor for the same reason: outside a
 * RouterProvider there is no Link, and after a crash a full page load is
 * the safer way home anyway.
 */
export function MenuLink({ children = 'Back to the menu' }) {
  return <a className="quiet-action" href="/menu">{children}</a>;
}

export default function ErrorScreen({ title, body, children }) {
  return (
    <main className="error-screen">
      <div className="error-screen-inner">
        <h1 className="error-screen-title">{title}</h1>
        <p className="error-screen-body">{body}</p>
        <div className="error-screen-actions">{children}</div>
      </div>
    </main>
  );
}
