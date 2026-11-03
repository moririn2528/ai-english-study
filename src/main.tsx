import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

// Earlier versions kept the OpenAI key in browser storage; drop any leftover copy.
for (const storage of [() => localStorage, () => sessionStorage]) {
  try {
    storage().removeItem("openai-api-key");
  } catch {
    // Storage blocked: nothing was stored either.
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
