import React from "react";
import { useWorkspaceBuild, WorkspaceProvider } from "./WorkspaceContext.tsx";

export function BuildChatProvider(
  props: {
    children: React.ReactNode;
    workspaceId?: string | null;
    onWorkspaceChange?: (workspaceId: string) => void;
  },
) {
  return <WorkspaceProvider {...props} />;
}

export function useBuildChat() {
  return useWorkspaceBuild();
}
