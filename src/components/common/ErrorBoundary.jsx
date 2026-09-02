import { Component } from 'react';
import ErrorScreen, { MenuLink } from './ErrorScreen';
import { VISITOR_COPY, reportError } from './errorReport';

/**
 * The last thing between a thrown error and a blank page.
 *
 * Wraps the RouterProvider, so it catches whatever the router's own
 * errorElement does not: the router failing to mount, a store throwing while
 * it hydrates, a portal outside any route. A class because React only hands
 * componentDidCatch to a class.
 *
 * The visitor sees a title and a sentence. The error itself goes to the
 * console and to window.__reportError if a page has defined one, and never
 * onto the screen.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { broken: false };
    this.reset = this.reset.bind(this);
  }

  static getDerivedStateFromError() {
    return { broken: true };
  }

  componentDidCatch(error, info) {
    reportError(error, info);
  }

  /* "Try again" clears the flag and lets the children render once more. If
     they throw again the boundary simply catches again. */
  reset() {
    this.setState({ broken: false });
  }

  render() {
    if (!this.state.broken) return this.props.children;
    return (
      <ErrorScreen title={VISITOR_COPY.broke.title} body={VISITOR_COPY.broke.body}>
        <button type="button" className="plain-btn quiet-action" onClick={this.reset}>
          Try again
        </button>
        <MenuLink />
      </ErrorScreen>
    );
  }
}
