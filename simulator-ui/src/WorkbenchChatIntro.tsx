import type { ReactNode } from "react";
import Button from "./gds/Button.tsx";
import Callout from "./gds/Callout.tsx";

export default function WorkbenchChatIntro(props: {
  disabled?: boolean;
  leadingContent?: ReactNode;
  pending?: boolean;
  title?: string;
  startLabel?: string;
  onStart?: () => void;
}) {
  const title = props.title?.trim().length
    ? props.title.trim()
    : "Start a workbench chat";

  return (
    <div className="workbench-chat-start-overlay">
      <Callout>
        <div className="workbench-chat-start-copy-group">
          <div className="workbench-chat-start-title-block">
            <span className="workbench-chat-start-eyebrow">Workbench chat</span>
            <span className="workbench-chat-start-title">{title}</span>
          </div>
          <p className="workbench-chat-start-copy">
            Start a session to inspect the workspace and edit files. The
            assistant will ask what you want to build before it starts making
            changes.
          </p>
          <p className="workbench-chat-start-copy">
            Example reply: "I want to build an assistant that does..."
          </p>
          {props.leadingContent
            ? (
              <div className="workbench-chat-start-leading">
                {props.leadingContent}
              </div>
            )
            : null}
          {props.onStart
            ? (
              <div className="workbench-chat-start-actions">
                <Button
                  variant="primary"
                  size="medium"
                  disabled={props.disabled}
                  data-testid="build-start"
                  onClick={props.onStart}
                >
                  {props.pending
                    ? "Starting..."
                    : (props.startLabel ?? "Start")}
                </Button>
              </div>
            )
            : null}
        </div>
      </Callout>
    </div>
  );
}
