import Button from "./gds/Button.tsx";
import Callout from "./gds/Callout.tsx";
import Icon from "./gds/Icon.tsx";

export function CodexLoginRequiredOverlay(props: {
  providerLabel: string;
  providerWorkspaceLoggedIn: boolean | null;
  loginCommand: string;
  copiedLoginCommand: boolean;
  showLoginRecheck: boolean;
  loginRecheckPending: boolean;
  loginStatusText: string | null;
  loginError: string | null;
  onCopyLoginCommand: () => void;
  onRecheckLogin?: () => void;
  onDismiss?: () => void;
}) {
  return (
    <div className="workbench-chat-readonly-overlay">
      <div className="workbench-chat-readonly-card">
        <h3 className="workbench-chat-readonly-title">
          {props.providerLabel} login required
        </h3>
        {props.providerWorkspaceLoggedIn === false && (
          <>
            <p className="workbench-chat-readonly-copy">
              {props.providerLabel} login is required for this workspace.
            </p>
            <p className="workbench-chat-readonly-copy">
              Run this in your terminal to authenticate{" "}
              {props.providerLabel}, then restart Gambit.
            </p>
            <div className="workbench-chat-command-row">
              <pre className="workbench-chat-command-code">
                <code>{props.loginCommand}</code>
              </pre>
              <Button
                variant="secondary"
                size="medium"
                onClick={props.onCopyLoginCommand}
              >
                <Icon
                  name={props.copiedLoginCommand ? "copied" : "copy"}
                  size={14}
                />
                {props.copiedLoginCommand ? "Copied" : "Copy"}
              </Button>
            </div>
            {props.showLoginRecheck && props.onRecheckLogin && (
              <div className="workbench-chat-readonly-actions">
                <Button
                  variant="primary"
                  size="medium"
                  style={{ width: "100%" }}
                  onClick={props.onRecheckLogin}
                  disabled={props.loginRecheckPending}
                >
                  {props.loginRecheckPending
                    ? "Rechecking..."
                    : "Recheck login"}
                </Button>
              </div>
            )}
          </>
        )}
        {props.loginStatusText &&
          !/^not logged in$/i.test(
            props.loginStatusText.trim(),
          ) && <Callout>{props.loginStatusText}</Callout>}
        {props.loginError && <div className="error">{props.loginError}</div>}
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
