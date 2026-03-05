import type { Mutation__GambitWorkspaceConversationSessionStart__parameters } from './parameters_type.ts';

export type Mutation__GambitWorkspaceConversationSessionStart__param = {
  readonly data: {
    readonly workspaceConversationSessionStart: ({
      readonly session: ({
        /**
A discriminant for the WorkspaceConversationSession type
        */
        readonly __typename: string,
        readonly sessionId: (string | null),
        readonly status: (string | null),
        /**
A client pointer for the WorkspaceBuildConversationSession type.
        */
        readonly asWorkspaceBuildConversationSession: ({
          readonly run: ({
            readonly id: (string | null),
          } | null),
        } | null),
        /**
A client pointer for the WorkspaceScenarioConversationSession type.
        */
        readonly asWorkspaceScenarioConversationSession: ({
          readonly run: ({
            readonly id: (string | null),
          } | null),
        } | null),
        /**
A client pointer for the WorkspaceGraderConversationSession type.
        */
        readonly asWorkspaceGraderConversationSession: ({
          readonly gradeRun: ({
            readonly id: (string | null),
          } | null),
        } | null),
        /**
A client pointer for the WorkspaceVerifyConversationSession type.
        */
        readonly asWorkspaceVerifyConversationSession: ({
          readonly verifyBatch: ({
            readonly id: (string | null),
          } | null),
        } | null),
      } | null),
      readonly workspace: ({
        readonly id: (string | null),
      } | null),
    } | null),
  },
  readonly parameters: Mutation__GambitWorkspaceConversationSessionStart__parameters,
};
