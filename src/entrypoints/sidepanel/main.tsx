// Side panel entrypoint (extension page).

import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "../../ui/App.js";
import "../../ui/theme.css";

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root container");

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
