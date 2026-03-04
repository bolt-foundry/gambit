import { type WorkspaceConversationRun__WorkbenchConversationRunChat__output_type } from '../../WorkspaceConversationRun/WorkbenchConversationRunChat/output_type.ts';
import type { Query__EntrypointWorkspaceWorkbenchLiveWrite__parameters } from './parameters_type.ts';

export type Query__EntrypointWorkspaceWorkbenchLiveWrite__param = {
  readonly data: {
    readonly workspace: ({
      readonly id: (string | null),
      readonly models: ({
        readonly codex: ({
          readonly model: (string | null),
          readonly workspaceId: (string | null),
          readonly available: (boolean | null),
          readonly requiresLogin: (boolean | null),
          readonly loggedIn: (boolean | null),
          readonly statusText: (string | null),
          readonly trustedPath: (string | null),
          readonly writeEnabled: (boolean | null),
        } | null),
      } | null),
      readonly buildRuns: ({
        readonly edges: (ReadonlyArray<({
          readonly node: ({
            readonly id: (string | null),
            readonly WorkbenchConversationRunChat: WorkspaceConversationRun__WorkbenchConversationRunChat__output_type,
          } | null),
        } | null)> | null),
      } | null),
    } | null),
  },
  readonly parameters: Query__EntrypointWorkspaceWorkbenchLiveWrite__parameters,
};
