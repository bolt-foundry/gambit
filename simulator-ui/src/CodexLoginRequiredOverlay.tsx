import Button from "./gds/Button.tsx";
import Callout from "./gds/Callout.tsx";
import Icon from "./gds/Icon.tsx";

export function CodexLoginRequiredOverlay(props: {
  codexWorkspaceLoggedIn: boolean | null;
  codexLoginCommand: string;
  copiedCodexLoginCommand: boolean;
  showCodexLoginRecheck: boolean;
  codexLoginRecheckPending: boolean;
  codexLoginStatusText: string | null;
  codexLoginError: string | null;
  onCopyCodexLoginCommand: () => void;
  onRecheckCodexLogin?: () => void;
  onDismiss?: () => void;
}) {
  return (
    <div className="workbench-chat-readonly-overlay">
      <div className="workbench-chat-readonly-card">
        <h3 className="workbench-chat-readonly-title">
          Codex login required
        </h3>
        {props.codexWorkspaceLoggedIn === false && (
          <>
            <p className="workbench-chat-readonly-copy">
              Codex login is required for this workspace.
            </p>
            <p className="workbench-chat-readonly-copy">
              Run this in your terminal to authenticate Codex, then restart
              Gambit.
            </p>
            <div className="workbench-chat-command-row">
              <pre className="workbench-chat-command-code">
                <code>{props.codexLoginCommand}</code>
              </pre>
              <Button
                variant="secondary"
                size="medium"
                onClick={props.onCopyCodexLoginCommand}
              >
                <Icon
                  name={props.copiedCodexLoginCommand ? "copied" : "copy"}
                  size={14}
                />
                {props.copiedCodexLoginCommand ? "Copied" : "Copy"}
              </Button>
            </div>
            {props.showCodexLoginRecheck && props.onRecheckCodexLogin && (
              <div className="workbench-chat-readonly-actions">
                <Button
                  variant="primary"
                  size="medium"
                  style={{ width: "100%" }}
                  onClick={props.onRecheckCodexLogin}
                  disabled={props.codexLoginRecheckPending}
                >
                  {props.codexLoginRecheckPending
                    ? "Rechecking..."
                    : "Recheck login"}
                </Button>
              </div>
            )}
          </>
        )}
        {props.codexLoginStatusText &&
          !/^not logged in$/i.test(
            props.codexLoginStatusText.trim(),
          ) && <Callout>{props.codexLoginStatusText}</Callout>}
        {props.codexLoginError && (
          <div className="error">{props.codexLoginError}</div>
        )}
        {props.onDismiss && (
          <Button
            variant="secondary"
            onClick={props.onDismiss}
          >
            Dismiss
          </Button>
        )}
      </div>
    </div>
  );
}

export default CodexLoginRequiredOverlay;
