import { createRoot } from "react-dom/client";
import { AppRoot } from "./AppRoot.tsx";
import { globalStyles } from "./styles.ts";

const globalStyleEl = document.createElement("style");
globalStyleEl.textContent = globalStyles;
document.head.appendChild(globalStyleEl);

const { pathname = "/", search = "", hash = "" } = globalThis.location ?? {};
const initialPath = `${pathname}${search}${hash}`;

createRoot(document.getElementById("root")!).render(
  <AppRoot initialPath={initialPath} />,
);
