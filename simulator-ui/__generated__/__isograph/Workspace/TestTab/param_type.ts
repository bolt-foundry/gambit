
export type Workspace__TestTab__param = {
  readonly data: {
    readonly id: (string | null),
    readonly scenarioDecks: (ReadonlyArray<{
      readonly id: (string | null),
      readonly label: (string | null),
      readonly description: (string | null),
      readonly path: (string | null),
      readonly maxTurns: (number | null),
      readonly inputSchema: (string | null),
      readonly defaults: (string | null),
      readonly inputSchemaError: (string | null),
    }> | null),
    readonly assistantDeck: ({
      readonly deck: (string | null),
      readonly startMode: (string | null),
      readonly modelParams: (string | null),
      readonly inputSchema: (string | null),
      readonly defaults: (string | null),
      readonly tools: (string | null),
      readonly inputSchemaError: (string | null),
    } | null),
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
  },
  readonly parameters: Record<PropertyKey, never>,
};
