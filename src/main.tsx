import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { loadFonts } from "./core/text";
import "./diagram/register";
// import "./cloud/register"; // cloud features disabled for now

loadFonts().finally(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});

if (import.meta.env.DEV) import("./core/store").then(({ useStore }) => ((window as any).__store = useStore));
