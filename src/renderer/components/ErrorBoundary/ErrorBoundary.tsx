import { Component, type ErrorInfo, type ReactNode } from "react";
import { wharf } from "../../api/wharf";
import "./ErrorBoundary.css";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  info: ErrorInfo | null;
}

/** Top-level safety net: without this, an uncaught error anywhere in the
 * render tree unmounts the whole app and leaves a blank window with no way
 * back short of force-quitting — there's no dev server overlay to fall back
 * on in a packaged build. Catches render-time errors only (React boundaries
 * can't catch errors from event handlers or async callbacks — see
 * main.tsx's window.onerror/unhandledrejection traps for those) and offers
 * a reload rather than silence. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Unhandled error in renderer tree:", error, info.componentStack);
    this.setState({ info });
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    const details = `${error.stack ?? error.message}${info?.componentStack ?? ""}`;
    return (
      <div className="crash-screen">
        <div className="crash-card">
          <h1>Something went wrong</h1>
          <p>Wharf hit an unexpected error and can't continue safely in this state.</p>
          <p className="crash-hint">Reloading restores your tabs — nothing you've connected to is affected.</p>
          <pre className="crash-details">{details}</pre>
          <div className="crash-actions">
            {/* Not location.reload(): a packaged build's will-navigate
             * guard (main/index.ts) blocks in-page navigation, including a
             * same-page reload — this has to come from the main process. */}
            <button className="btn primary" onClick={() => wharf.window.reload()}>
              Reload Wharf
            </button>
            <button className="btn ghost" onClick={() => void wharf.clipboard.writeText(details)}>
              Copy error details
            </button>
          </div>
        </div>
      </div>
    );
  }
}
