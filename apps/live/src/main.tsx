import "@rvlt/pulse-ui/fonts.css";
import "@rvlt/pulse-ui/tokens.css";
import "@rvlt/pulse-ui/brand.css";
import "@rvlt/pulse-ui/visualization.css";
import "./styles.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Live application root is missing");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
