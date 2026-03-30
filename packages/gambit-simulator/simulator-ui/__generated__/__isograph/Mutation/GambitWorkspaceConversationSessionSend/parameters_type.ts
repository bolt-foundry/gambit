export type Mutation__GambitWorkspaceConversationSessionSend__parameters = {
  readonly input: {
    readonly inputItems: ReadonlyArray<{
          readonly content: string,
          readonly role?: (string | null),
        }>,
    readonly kind: string,
    readonly sessionId: string,
    readonly workspaceId: string,
  },
};
