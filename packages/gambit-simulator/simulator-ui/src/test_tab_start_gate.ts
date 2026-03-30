export type AssistantKickoffRunState = {
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  outputItemCount: number;
};

export function runAwaitsAssistantKickoff(
  run: AssistantKickoffRunState | null,
): boolean {
  if (!run) return true;
  return run.status.trim().toUpperCase() === "IDLE" &&
    run.startedAt === null &&
    run.finishedAt === null &&
    run.outputItemCount === 0;
}
