import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { registerMobileBetaServiceWorker } from "./mobileBeta";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

registerMobileBetaServiceWorker();
