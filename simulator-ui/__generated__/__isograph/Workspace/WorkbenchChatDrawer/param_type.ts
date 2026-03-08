import { type WorkspaceConversationRun__WorkbenchConversationRunChat__output_type } from '../../WorkspaceConversationRun/WorkbenchConversationRunChat/output_type.ts';

export type Workspace__WorkbenchChatDrawer__param = {
  readonly data: {
    readonly id: string,
    readonly models: {
      readonly codex: {
        readonly model: string,
        readonly workspaceId: string,
        readonly available: boolean,
        readonly requiresLogin: boolean,
        readonly loggedIn: boolean,
        readonly statusText: string,
        readonly trustedPath: (string | null),
        readonly writeEnabled: boolean,
      },
    },
    readonly buildRuns: {
      readonly edges: ReadonlyArray<{
        readonly node: {
          readonly id: string,
          readonly WorkbenchConversationRunChat: WorkspaceConversationRun__WorkbenchConversationRunChat__output_type,
        },
      }>,
    },
  },
  readonly parameters: Record<PropertyKey, never>,
};
