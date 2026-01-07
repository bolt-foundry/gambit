import { defineDeck } from "../../../mod.ts";
import { z } from "npm:zod@^3.23.8";

const inputSchema = z.object({
  patientId: z.string().optional(),
  slotIso: z.string(),
  slotDisplay: z.string().optional(),
  provider: z.string().optional(),
  location: z.string().optional(),
});

const outputSchema = z.object({
  status: z.enum(["confirmed", "failed"]),
  confirmationId: z.string().optional(),
  message: z.string(),
  confirmedSlot: z
    .object({
      isoStart: z.string(),
      display: z.string().optional(),
      provider: z.string().optional(),
      location: z.string().optional(),
      type: z.string().optional(),
    })
    .optional(),
});

export default defineDeck({
  label: "confirm_appointment",
  inputSchema,
  outputSchema,
  run(ctx) {
    const confirmationId = `apt-${Math.random().toString(36).slice(2, 8)}`;
    const display = ctx.input.slotDisplay ?? ctx.input.slotIso;
    return {
      status: "confirmed",
      confirmationId,
      message: `Confirmed appointment for ${display}.`,
      confirmedSlot: {
        isoStart: ctx.input.slotIso,
        display,
        provider: ctx.input.provider,
        location: ctx.input.location,
      },
    };
  },
});
