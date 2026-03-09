
export type Workspace__TestTab__param = {
  readonly data: {
    readonly id: string,
    readonly scenarioDecks: ReadonlyArray<{
      readonly id: string,
      readonly label: string,
      readonly description: (string | null),
      readonly path: string,
      readonly maxTurns: (number | null),
      readonly inputSchema: (string | null),
      readonly defaults: (string | null),
      readonly inputSchemaError: (string | null),
    }>,
    readonly assistantDeck: ({
      readonly deck: (string | null),
      readonly startMode: (string | null),
      readonly modelParams: (string | null),
      readonly inputSchema: (string | null),
      readonly defaults: (string | null),
      readonly tools: (string | null),
      readonly inputSchemaError: (string | null),
    } | null),
    readonly scenarioRuns: {
      readonly edges: ReadonlyArray<{
        readonly node: {
          readonly id: string,
          readonly status: string,
          readonly startedAt: (string | null),
          readonly finishedAt: (string | null),
          readonly error: (string | null),
          readonly openResponses: {
            readonly edges: ReadonlyArray<{
              readonly node: {
                readonly id: string,
                readonly status: string,
                readonly outputItems: {
                  readonly edges: ReadonlyArray<{
                    readonly node: {
                      /**
A discriminant for the OpenResponseOutputItem type
                      */
                      readonly __typename: string,
                      /**
A client pointer for the OutputMessage type.
                      */
                      readonly asOutputMessage: ({
                        readonly id: string,
                        readonly messageRefId: (string | null),
                        readonly role: string,
                        readonly content: string,
                        readonly feedback: ({
                          readonly id: string,
                          readonly runId: string,
                          readonly messageRefId: string,
                          readonly score: number,
                          readonly reason: (string | null),
                          readonly createdAt: (string | null),
                        } | null),
                      } | null),
                    },
                  }>,
                },
              },
            }>,
          },
        },
      }>,
    },
  },
  readonly parameters: Record<PropertyKey, never>,
};
