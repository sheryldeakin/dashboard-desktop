/* ErrorBoundary — catches React render errors so a single bad component
   doesn't take the whole app down to a white screen. Two intended
   placements in this codebase:

     1. Top-level (inside ContentProvider, outside the router) — last
        chance to keep *something* on screen if a layout or routing
        layer crashes. Reload is the only realistic recovery.

     2. Per-layout (wrapping AppShellLayout's <Outlet />, TodoLayout's
        <Outlet />) — so a broken page leaves the sidebar / top nav
        intact, and the user can navigate elsewhere without reloading.

   React doesn't offer a hook-based API for this; class components with
   getDerivedStateFromError + componentDidCatch are still the canonical
   way. componentDidCatch is where we'd hook telemetry / Sentry / etc.
   when we add that — for now we just console.error.

   Props:
     children   the tree to guard
     scope      "app" | "route" — adjusts copy + recovery buttons
                (route boundaries show "Go home"; app boundaries can
                only suggest reload).
     onReset    optional handler called by the "Try again" button;
                resets internal state so the children re-render. The
                parent typically passes a "remount key" pattern via
                resetKeys to make this work cleanly. */

import { Component } from "react";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      detailsOpen: false,
    };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // Logging only for now. Future: send to telemetry sink.
    console.error("ErrorBoundary caught:", error, errorInfo);
    this.setState({ errorInfo });
  }

  /* Reset back to a non-error state so children can attempt to render
     again. Useful for transient errors; the underlying cause might be
     fixed (e.g., content reloaded after a brief Atlas blip). */
  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null, detailsOpen: false });
    if (this.props.onReset) this.props.onReset();
  };

  /* If the parent's resetKeys array changes, treat that as "the inputs
     that caused the crash have probably changed, try rendering again."
     Most useful at the route boundary: when the user navigates to a
     different page, the boundary should clear so the new page mounts.
     Implementation: shallow-compare keys in componentDidUpdate. */
  componentDidUpdate(prevProps) {
    if (!this.state.hasError) return;
    const prev = prevProps.resetKeys || [];
    const curr = this.props.resetKeys || [];
    if (prev.length !== curr.length) {
      this.handleReset();
      return;
    }
    for (let i = 0; i < curr.length; i++) {
      if (prev[i] !== curr[i]) {
        this.handleReset();
        return;
      }
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    const scope = this.props.scope || "route";
    const errorMessage = this.state.error?.message || String(this.state.error || "Unknown error");
    const stack = this.state.error?.stack || "";
    const componentStack = this.state.errorInfo?.componentStack || "";

    return (
      <div className={`error-boundary error-boundary--${scope}`}>
        <h1 className="error-boundary-title">Something broke.</h1>
        <p className="error-boundary-text">
          A bit of the UI crashed while rendering. Your data is safe —
          this is a frontend problem, not a save error.
        </p>

        <div className="error-boundary-actions">
          <button
            type="button"
            className="error-boundary-btn is-primary"
            onClick={this.handleReset}
          >
            Try again
          </button>
          <button
            type="button"
            className="error-boundary-btn"
            onClick={() => window.location.reload()}
          >
            Reload page
          </button>
          {scope === "route" && (
            <a className="error-boundary-btn" href="/home">
              Go home
            </a>
          )}
        </div>

        <details
          className="error-boundary-details"
          open={this.state.detailsOpen}
          onToggle={(e) => this.setState({ detailsOpen: e.target.open })}
        >
          <summary>Details</summary>
          <p className="error-boundary-message">{errorMessage}</p>
          {stack && <pre className="error-boundary-stack">{stack}</pre>}
          {componentStack && (
            <>
              <p className="error-boundary-message">Component stack:</p>
              <pre className="error-boundary-stack">{componentStack}</pre>
            </>
          )}
        </details>
      </div>
    );
  }
}
