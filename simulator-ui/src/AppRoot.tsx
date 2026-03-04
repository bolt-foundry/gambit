import type { IsographEnvironment } from "@isograph/react";
import { IsographEnvironmentProvider } from "@isograph/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { RouterProvider } from "./RouterContext.tsx";
import { MinimalRouterRoot } from "./MinimalRouterRoot.tsx";
import { getEnvironment } from "./isographEnvironment.ts";

const THEME_STORAGE_KEY = "gambit-simulator-theme";
type AppearanceSetting = "light" | "dark" | "system";

function readStoredAppearance(): AppearanceSetting {
  try {
    const savedTheme = globalThis.localStorage.getItem(THEME_STORAGE_KEY);
    if (
      savedTheme === "light" || savedTheme === "dark" || savedTheme === "system"
    ) {
      return savedTheme;
    }
  } catch {
    // ignore storage read errors and fall back to system
  }
  return "system";
}

function getSystemPrefersDark(): boolean {
  try {
    return globalThis.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

function subscribeToSystemColorScheme(onStoreChange: () => void): () => void {
  try {
    const media = globalThis.matchMedia("(prefers-color-scheme: dark)");
    const legacyMedia = media as MediaQueryList & {
      addListener?: (listener: () => void) => void;
      removeListener?: (listener: () => void) => void;
    };
    if (typeof legacyMedia.addEventListener === "function") {
      media.addEventListener("change", onStoreChange);
      return () => media.removeEventListener("change", onStoreChange);
    }
    if (typeof legacyMedia.addListener === "function") {
      legacyMedia.addListener(onStoreChange);
      return () => legacyMedia.removeListener?.(onStoreChange);
    }
  } catch {
    // ignore matchMedia errors and keep default snapshot
  }
  return () => {};
}

export function AppRoot(props: {
  environment?: IsographEnvironment;
  initialPath?: string;
}) {
  const environment = props.environment ?? getEnvironment();
  const [appearance] = useState<AppearanceSetting>(readStoredAppearance);
  const systemPrefersDark = useSyncExternalStore(
    subscribeToSystemColorScheme,
    getSystemPrefersDark,
    getSystemPrefersDark,
  );
  const theme = appearance === "system"
    ? (systemPrefersDark ? "dark" : "light")
    : appearance;

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  return (
    <RouterProvider initialPath={props.initialPath}>
      <IsographEnvironmentProvider environment={environment}>
        <MinimalRouterRoot />
      </IsographEnvironmentProvider>
    </RouterProvider>
  );
}
