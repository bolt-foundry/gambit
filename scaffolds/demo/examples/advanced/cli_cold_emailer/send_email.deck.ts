import { defineDeck } from "jsr:@molt-foundry/gambit";
import { z } from "npm:zod";

export default defineDeck({
  label: "send_email",
  contextSchema: z.object({
    to: z.string().min(1).describe("Recipient email or name"),
    subject: z.string().min(1).describe("Email subject"),
    body: z.string().min(1).describe("Email body"),
    sender: z.string().min(1).describe("Sender name or address"),
  }),
  responseSchema: z.object({
    status: z.string().min(1).describe("Send status"),
    message: z.string().min(1).describe("Result message"),
  }),
  run(ctx) {
    const { to, subject } = ctx.input;
    ctx.log({
      level: "info",
      message: "Demo email send",
      meta: {
        to: ctx.input.to,
        subject: ctx.input.subject,
        body: ctx.input.body,
        sender: ctx.input.sender,
      },
    });
    return {
      status: "sent",
      message: `Demo send queued to ${to} with subject "${subject}".`,
    };
  },
});
