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
    : "What do you want to build?";

  return (
    <div className="workbench-chat-start-overlay">
      <Callout>
        <div className="workbench-chat-start-copy-group">
          <div className="workbench-chat-start-title-block">
            <span className="workbench-chat-start-eyebrow">Workbench chat</span>
            <span className="workbench-chat-start-title">{title}</span>
          </div>
          <p className="workbench-chat-start-copy">
            Describe what you want and the build assistant will scaffold a first
            version and then iterate on it with you.
          </p>
          <p className="workbench-chat-start-copy">
            Example chat: "I want to build an assistant that..."
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
