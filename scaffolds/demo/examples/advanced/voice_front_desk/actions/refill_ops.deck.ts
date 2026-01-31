import { defineDeck } from "jsr:@molt-foundry/gambit";
import { z } from "npm:zod";

const contextSchema = z.object({
  patientId: z.string().optional(),
  medication: z.string(),
  dosage: z.string().optional(),
  supplyRequested: z.string().optional(),
  pharmacy: z.string().optional(),
  lastVisitDate: z.string().optional(),
});

const responseSchema = z.object({
  status: z.enum(["eligible", "visit_required", "manual_review"]),
  message: z.string(),
  nextAction: z.enum(["place_refill", "schedule_visit", "route_nurse"]),
});

export default defineDeck({
  label: "refill_ops",
  contextSchema,
  responseSchema,
  run(ctx) {
    const requiresVisit = !ctx.input.lastVisitDate;
    if (requiresVisit) {
      return {
        status: "visit_required",
        message: "Last visit date missing; patient must be seen before refill.",
        nextAction: "schedule_visit",
      };
    }

    if (ctx.input.medication.toLowerCase().includes("control")) {
      return {
        status: "manual_review",
        message: "Controlled medications require clinician approval.",
        nextAction: "route_nurse",
      };
    }

    return {
      status: "eligible",
      message: "Refill request queued to pharmacy.",
      nextAction: "place_refill",
    };
  },
});
