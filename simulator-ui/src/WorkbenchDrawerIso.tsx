import type React from "react";
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
  } = props;

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
          </header>
          <div className="gds-accordion-content workbench-chat-content">
            <div className="gds-accordion-content-inner">
              <div className="workbench-chat-panel">
                <div className="workbench-chat-overlay">
                  <div className="workbench-chat-current">
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
