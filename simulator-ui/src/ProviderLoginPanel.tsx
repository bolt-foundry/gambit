// deno-lint-ignore-file gambit/no-useeffect-setstate gambit/no-useeffect-setstate
import { useCallback, useEffect, useState } from "react";
import Button from "./gds/Button.tsx";
import Icon from "./gds/Icon.tsx";
import Callout from "./gds/Callout.tsx";
import type { BuildChatProvider } from "./utils.ts";

export type ProviderLoginPanelProps = {
  open: boolean;
  buildChatProvider: BuildChatProvider;
  workspaceId?: string;
};

export default function ProviderLoginPanel({
  open,
  buildChatProvider,
  workspaceId,
}: ProviderLoginPanelProps) {
  const providerLabel = buildChatProvider === "claude-code-cli"
    ? "Claude Code"
    : "Codex";
  const providerLoginCommand = buildChatProvider === "claude-code-cli"
    ? "claude auth login"
    : "codex login";
  const providerStatusEndpoint = workspaceId
    ? `/api/build/provider-status?workspaceId=${
      encodeURIComponent(workspaceId)
    }&provider=${encodeURIComponent(buildChatProvider)}`
    : `/api/build/provider-status?provider=${
      encodeURIComponent(buildChatProvider)
    }`;
  const [copiedProviderLoginCommand, setCopiedProviderLoginCommand] = useState(
    false,
  );
  const [providerLoginRecheckPending, setProviderLoginRecheckPending] =
    useState(false);
  const [showProviderLoginRecheck, setShowProviderLoginRecheck] = useState(
    false,
  );
  const [providerAutoRecheckActive, setProviderAutoRecheckActive] = useState(
    false,
  );
  const [providerWorkspaceLoggedIn, setProviderWorkspaceLoggedIn] = useState<
    boolean | null
  >(null);
  const [providerLoginError, setProviderLoginError] = useState<string | null>(
    null,
  );
  const [providerLoginStatusText, setProviderLoginStatusText] = useState<
    string | null
  >(null);
  const [providerLoginOverlayDismissed, setProviderLoginOverlayDismissed] =
    useState(false);
  const showProviderLoginOverlay = (providerWorkspaceLoggedIn === false &&
    !providerLoginOverlayDismissed) ||
    Boolean(providerLoginError);

  useEffect(() => {
    if (!open) return;
    let canceled = false;
    setProviderLoginError(null);
    fetch(providerStatusEndpoint)
      .then(async (response) => {
        const payload = await response.json() as {
          ok?: boolean;
          provider?: BuildChatProvider;
          loggedIn?: boolean;
          loginStatus?: string;
          writeEnabled?: boolean;
          error?: string;
        };
        if (!response.ok || payload.ok === false) {
          throw new Error(payload.error || response.statusText);
        }
        if (canceled) return;
        setProviderWorkspaceLoggedIn(payload.loggedIn === true);
        if (payload.loggedIn === true) {
          setShowProviderLoginRecheck(false);
          setProviderAutoRecheckActive(false);
        }
        setProviderLoginStatusText(
          typeof payload.loginStatus === "string" ? payload.loginStatus : null,
        );
      })
      .catch((err) => {
        if (canceled) return;
        setProviderWorkspaceLoggedIn(null);
        setProviderLoginStatusText(null);
        setProviderLoginError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      canceled = true;
    };
  }, [buildChatProvider, open, providerStatusEndpoint]);

  useEffect(() => {
    if (!showProviderLoginOverlay) return;
    if (providerWorkspaceLoggedIn !== false) return;
    if (showProviderLoginRecheck) return;
    const timeout = globalThis.setTimeout(() => {
      setShowProviderLoginRecheck(true);
    }, 5000);
    return () => globalThis.clearTimeout(timeout);
  }, [
    providerWorkspaceLoggedIn,
    showProviderLoginOverlay,
    showProviderLoginRecheck,
  ]);

  const handleCopyProviderLoginCommand = useCallback(() => {
    navigator.clipboard?.writeText(providerLoginCommand);
    setCopiedProviderLoginCommand(true);
    setShowProviderLoginRecheck(true);
    setProviderAutoRecheckActive(true);
    globalThis.setTimeout(() => setCopiedProviderLoginCommand(false), 1200);
  }, [providerLoginCommand]);

  const handleRecheckProviderLogin = useCallback(async () => {
    setProviderLoginRecheckPending(true);
    setProviderLoginError(null);
    try {
      const response = await fetch(providerStatusEndpoint);
      const payload = await response.json() as {
        ok?: boolean;
        loggedIn?: boolean;
        loginStatus?: string;
        error?: string;
      };
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || response.statusText);
      }
      setProviderWorkspaceLoggedIn(payload.loggedIn === true);
      if (payload.loggedIn === true) {
        setShowProviderLoginRecheck(false);
        setProviderAutoRecheckActive(false);
      }
      setProviderLoginStatusText(
        typeof payload.loginStatus === "string" ? payload.loginStatus : null,
      );
    } catch (err) {
      setProviderWorkspaceLoggedIn(null);
      setProviderLoginStatusText(null);
      setProviderLoginError(err instanceof Error ? err.message : String(err));
    } finally {
      setProviderLoginRecheckPending(false);
    }
  }, [providerStatusEndpoint]);

  useEffect(() => {
    if (!providerAutoRecheckActive) return;
    if (!showProviderLoginOverlay) return;
    if (providerWorkspaceLoggedIn !== false) return;
    const interval = globalThis.setInterval(() => {
      if (providerLoginRecheckPending) return;
      void handleRecheckProviderLogin();
    }, 2000);
    return () => globalThis.clearInterval(interval);
  }, [
    providerAutoRecheckActive,
    providerLoginRecheckPending,
    providerWorkspaceLoggedIn,
    handleRecheckProviderLogin,
    showProviderLoginOverlay,
  ]);

  if (!showProviderLoginOverlay) return null;

  return (
    <div className="workbench-chat-readonly-overlay">
      <div className="workbench-chat-readonly-card">
        <h3 className="workbench-chat-readonly-title">
          {providerLabel} login required
        </h3>
        {providerWorkspaceLoggedIn === false && (
          <>
            <p className="workbench-chat-readonly-copy">
              {providerLabel} login is required for this workspace.
            </p>
            <p className="workbench-chat-readonly-copy">
              Run this in your terminal to authenticate, then recheck.
            </p>
            <div className="workbench-chat-command-row">
              <pre className="workbench-chat-command-code">
                <code>{providerLoginCommand}</code>
              </pre>
              <Button
                variant="secondary"
                size="medium"
                onClick={handleCopyProviderLoginCommand}
              >
                <Icon
                  name={copiedProviderLoginCommand ? "copied" : "copy"}
                  size={14}
                />
                {copiedProviderLoginCommand ? "Copied" : "Copy"}
              </Button>
            </div>
            {showProviderLoginRecheck && (
              <div className="workbench-chat-readonly-actions">
                <Button
                  variant="primary"
                  size="medium"
                  style={{ width: "100%" }}
                  onClick={() => handleRecheckProviderLogin()}
                  disabled={providerLoginRecheckPending}
                >
                  {providerLoginRecheckPending
                    ? "Rechecking..."
                    : "Recheck login"}
                </Button>
              </div>
            )}
          </>
        )}
        {providerLoginStatusText &&
          !/^not logged in$/i.test(providerLoginStatusText.trim()) &&
          <Callout>{providerLoginStatusText}</Callout>}
        {providerLoginError && <div className="error">{providerLoginError}
        </div>}
        <Button
          variant="secondary"
          onClick={() => {
            setProviderLoginOverlayDismissed(true);
            setProviderAutoRecheckActive(false);
          }}
        >
          Dismiss
        </Button>
      </div>
    </div>
  );
}
