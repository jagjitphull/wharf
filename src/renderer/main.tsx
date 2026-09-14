import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/global.css";
// Applies the persisted theme (data-theme + --accent-color) synchronously
// as a side effect of import, before React renders — avoids a flash of
// the wrong theme on startup.
import "./state/themeStore";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
