import React from "react";
import Badge from "./gds/Badge.tsx";

export type WorkbenchChatRunStatus =
  | "IDLE"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELED";

export type WorkbenchChatMessage = {
  id?: string;
  role: "user" | "assistant";
  content: string;
};

type WorkbenchDrawerIsoProps = {
  open?: boolean;
  runStatus?: WorkbenchChatRunStatus;
  chatBody?: React.ReactNode;
  chatHeaderActions?: React.ReactNode;
  showChatHistoryToggle?: boolean;
  chatHistoryOpen?: boolean;
  chatHistoryContent?: React.ReactNode;
  onToggleChatHistory?: () => void;
};

function toBadgeStatus(status: WorkbenchChatRunStatus): string {
  switch (status) {
    case "RUNNING":
      return "running";
    case "COMPLETED":
      return "completed";
    case "FAILED":
      return "error";
    case "CANCELED":
      return "canceled";
    default:
      return "idle";
  }
}

function toBadgeLabel(status: WorkbenchChatRunStatus): string {
  switch (status) {
    case "RUNNING":
      return "Running";
    case "COMPLETED":
      return "Completed";
    case "FAILED":
      return "Failed";
    case "CANCELED":
      return "Canceled";
    default:
      return "Idle";
  }
}

export default function WorkbenchDrawerIso(props: WorkbenchDrawerIsoProps) {
  const {
    open = true,
    runStatus = "IDLE",
    chatBody = null,
    chatHeaderActions = null,
    showChatHistoryToggle = true,
    chatHistoryOpen = false,
    chatHistoryContent = null,
    onToggleChatHistory,
  } = props;
  void showChatHistoryToggle;
  void onToggleChatHistory;
  const hasChatHistory = chatHistoryContent !== null;

  if (!open) return null;

  return (
    <aside className="workbench-drawer-docked" role="dialog">
      <div className="gds-accordion workbench-accordion equal-open">
        <section className="gds-accordion-item open">
          <header className="gds-accordion-header">
            <div className="gds-accordion-title">
              <div className="workbench-accordion-title">
                <span>Chat</span>
                <Badge status={toBadgeStatus(runStatus)}>
                  {toBadgeLabel(runStatus)}
                </Badge>
              </div>
            </div>
            {chatHeaderActions && (
              <div className="workbench-chat-header-actions gds-accordion-open-only">
                {chatHeaderActions}
              </div>
            )}
          </header>
          <div className="gds-accordion-content workbench-chat-content">
            <div className="gds-accordion-content-inner">
              <div className="workbench-chat-panel">
                <div className="workbench-chat-overlay">
                  {hasChatHistory && (
                    <div className="workbench-chat-history">
                      {chatHistoryContent}
                    </div>
                  )}
                  <div
                    className={`workbench-chat-current${
                      chatHistoryOpen ? " is-history" : ""
                    }`}
                  >
                    {chatBody}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </aside>
  );
}
