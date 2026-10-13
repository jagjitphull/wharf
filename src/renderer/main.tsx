import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary/ErrorBoundary";
import "./styles/global.css";
import "./styles/fonts.css";
// Applies the persisted theme (data-theme + --accent-color) synchronously
// as a side effect of import, before React renders — avoids a flash of
// the wrong theme on startup.
import "./state/themeStore";

// ErrorBoundary only catches render-time errors; an error thrown from an
// event handler or a rejected promise (an IPC call, an async effect)
// doesn't go through React's tree at all, so it would otherwise vanish into
// the console with nothing pointing at it, or not even that if the engine
// logs are never checked. These don't unmount anything, so there's no UI to
// recover — just make sure they're impossible to miss.
window.addEventListener("error", (event) => {
  console.error("Unhandled error:", event.error ?? event.message);
});
window.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled promise rejection:", event.reason);
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
