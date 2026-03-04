import type { Mutation__GambitWorkspaceScenarioRunStart__parameters } from './parameters_type.ts';

export type Mutation__GambitWorkspaceScenarioRunStart__param = {
  readonly data: {
    readonly workspaceScenarioRunStart: ({
      readonly workspace: ({
        readonly id: (string | null),
        readonly scenarioRuns: ({
          readonly edges: (ReadonlyArray<({
            readonly node: ({
              readonly id: (string | null),
              readonly status: (string | null),
              readonly startedAt: (string | null),
              readonly finishedAt: (string | null),
              readonly error: (string | null),
              readonly openResponses: ({
                readonly edges: (ReadonlyArray<({
                  readonly node: ({
                    readonly id: (string | null),
                    readonly status: (string | null),
                    readonly outputItems: ({
                      readonly edges: (ReadonlyArray<({
                        readonly node: ({
                          /**
A discriminant for the OpenResponseOutputItem type
                          */
                          readonly __typename: string,
                          /**
A client pointer for the OutputMessage type.
                          */
                          readonly asOutputMessage: ({
                            readonly id: (string | null),
                            readonly role: (string | null),
                            readonly content: (string | null),
                          } | null),
                        } | null),
                      } | null)> | null),
                    } | null),
                  } | null),
                } | null)> | null),
              } | null),
            } | null),
          } | null)> | null),
        } | null),
      } | null),
      readonly run: ({
        readonly id: (string | null),
        readonly workspaceId: (string | null),
        readonly status: (string | null),
        readonly startedAt: (string | null),
        readonly finishedAt: (string | null),
        readonly error: (string | null),
      } | null),
    } | null),
  },
  readonly parameters: Mutation__GambitWorkspaceScenarioRunStart__parameters,
};
