import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initializeAppearance } from "./lib/appearance";
import "./index.css";

const stopAppearance = initializeAppearance();
import.meta.hot?.dispose(stopAppearance);
ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
