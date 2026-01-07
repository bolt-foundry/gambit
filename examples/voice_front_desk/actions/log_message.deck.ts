import { defineDeck } from "jsr:@bolt-foundry/gambit";
import logMessageInput from "../schemas/log_message_input.zod.ts";
import logMessageOutput from "../schemas/log_message_output.zod.ts";

function makeTicketId(callId: string): string {
  if (typeof crypto?.randomUUID === "function") {
    return `vm-${callId}-${crypto.randomUUID().slice(0, 8)}`;
  }
  const rand = Math.floor(Math.random() * 1e6).toString(36);
  return `vm-${callId}-${rand}`;
}

export default defineDeck({
  label: "log_message",
  inputSchema: logMessageInput,
  outputSchema: logMessageOutput,
  run(ctx) {
    const ticketId = makeTicketId(ctx.input.callId);
    const queuedAt = new Date().toISOString();

    ctx.log({
      level: "info",
      message: "Callback ticket logged",
      meta: {
        ticketId,
        audience: ctx.input.audience,
        priority: ctx.input.priority,
        summary: ctx.input.summary.slice(0, 120),
      },
    });

    return {
      ticketId,
      queuedAt,
      audience: ctx.input.audience,
      priority: ctx.input.priority,
      status: "queued",
    };
  },
});
