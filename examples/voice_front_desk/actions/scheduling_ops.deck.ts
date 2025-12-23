import { defineDeck } from "../../../mod.ts";
import lookupScheduleInput from "../schemas/lookup_schedule_input.zod.ts";
import lookupScheduleOutput from "../schemas/lookup_schedule_output.zod.ts";

type Slot = {
  isoStart: string;
  type: string;
  display: string;
  location: string;
};

type ProviderSchedule = {
  name: string;
  specialties: Array<string>;
  location: string;
  waitlist: boolean;
  slots: Array<Slot>;
};

const providerSchedules: Array<ProviderSchedule> = [
  {
    name: "Dr. Alina Chen",
    specialties: ["physical", "follow_up", "med_refill"],
    location: "Suite 300",
    waitlist: true,
    slots: [
      {
        isoStart: "2025-03-12T09:15:00-08:00",
        type: "physical",
        display: "Wed, Mar 12 at 9:15 a.m.",
        location: "Exam 4",
      },
      {
        isoStart: "2025-03-13T14:40:00-08:00",
        type: "follow_up",
        display: "Thu, Mar 13 at 2:40 p.m.",
        location: "Exam 3",
      },
      {
        isoStart: "2025-03-17T08:20:00-08:00",
        type: "physical",
        display: "Mon, Mar 17 at 8:20 a.m.",
        location: "Exam 2",
      },
    ],
  },
  {
    name: "Dr. Mateo Malik",
    specialties: ["sick", "sports", "question"],
    location: "Suite 300 + telehealth",
    waitlist: false,
    slots: [
      {
        isoStart: "2025-03-11T11:10:00-08:00",
        type: "sick",
        display: "Tue, Mar 11 at 11:10 a.m.",
        location: "Exam 6",
      },
      {
        isoStart: "2025-03-12T07:45:00-08:00",
        type: "sports",
        display: "Wed, Mar 12 at 7:45 a.m. telehealth",
        location: "Video visit",
      },
      {
        isoStart: "2025-03-14T15:20:00-08:00",
        type: "question",
        display: "Fri, Mar 14 at 3:20 p.m.",
        location: "Exam 5",
      },
    ],
  },
  {
    name: "NP Lila Torres",
    specialties: ["med_refill", "follow_up", "sick"],
    location: "Suite 300",
    waitlist: true,
    slots: [
      {
        isoStart: "2025-03-10T10:00:00-08:00",
        type: "med_refill",
        display: "Mon, Mar 10 at 10:00 a.m.",
        location: "Exam 1",
      },
      {
        isoStart: "2025-03-12T16:05:00-08:00",
        type: "follow_up",
        display: "Wed, Mar 12 at 4:05 p.m.",
        location: "Exam 2",
      },
      {
        isoStart: "2025-03-18T09:35:00-08:00",
        type: "sick",
        display: "Tue, Mar 18 at 9:35 a.m.",
        location: "Exam 1",
      },
    ],
  },
];

function normalizeName(value?: string | null): string | undefined {
  return value?.trim().toLowerCase();
}

function pickProvider(
  requested: string | undefined,
  visitType: string,
): ProviderSchedule {
  const normalized = normalizeName(requested);
  if (normalized) {
    const explicit = providerSchedules.find((provider) =>
      provider.name.toLowerCase() === normalized
    );
    if (explicit) {
      return explicit;
    }
  }

  const specialtyMatch = providerSchedules.find((provider) =>
    provider.specialties.includes(visitType)
  );
  return specialtyMatch ?? providerSchedules[0];
}

function slotFallsInWindow(slot: Slot, window?: {
  startDate?: string;
  endDate?: string;
}): boolean {
  if (!window) return true;
  const start = window.startDate ? Date.parse(window.startDate) : undefined;
  const end = window.endDate ? Date.parse(window.endDate) : undefined;
  const slotDate = Date.parse(slot.isoStart);
  if (Number.isNaN(slotDate)) return true;
  if (start && slotDate < start) return false;
  if (end && slotDate > end + 24 * 60 * 60 * 1000) return false;
  return true;
}

function classifyVisitType(reason: string): string {
  const normalized = reason.toLowerCase();
  if (normalized.includes("physical") || normalized.includes("annual")) {
    return "physical";
  }
  if (
    normalized.includes("follow") || normalized.includes("check") ||
    normalized.includes("wound")
  ) {
    return "follow_up";
  }
  if (
    normalized.includes("med") || normalized.includes("refill") ||
    normalized.includes("rx")
  ) {
    return "med_refill";
  }
  if (normalized.includes("injury") || normalized.includes("pain")) {
    return "sports";
  }
  return "sick";
}

export default defineDeck({
  label: "scheduling_ops",
  inputSchema: lookupScheduleInput,
  outputSchema: lookupScheduleOutput,
  run(ctx) {
    const visitType = classifyVisitType(ctx.input.reason);
    const provider = pickProvider(ctx.input.provider, visitType);

    const filtered = provider.slots.filter((slot) =>
      slotFallsInWindow(slot, ctx.input.preferredWindow)
    );
    const slots = (filtered.length ? filtered : provider.slots).slice(0, 2);
    const waitlistOffered = slots.length === 0
      ? provider.waitlist
      : ctx.input.urgency !== "urgent" && provider.waitlist;

    let result: "scheduled" | "reschedule_pending" | "no_slots" | "waitlisted";
    if (slots.length > 0) {
      result = ctx.input.operation === "reschedule"
        ? "reschedule_pending"
        : "scheduled";
    } else if (waitlistOffered) {
      result = "waitlisted";
    } else {
      result = "no_slots";
    }

    const confirmation = (() => {
      if (result === "scheduled" && slots[0]) {
        return `Booked ${ctx.input.reason} with ${provider.name} on ${
          slots[0].display
        }.`;
      }
      if (result === "reschedule_pending" && slots[0]) {
        return `Proposed new time ${
          slots[0].display
        }; awaiting caller confirmation.`;
      }
      if (result === "waitlisted") {
        return "Added to the waitlist; nurse team will call if an earlier slot opens.";
      }
      return "No slots match the requested window; team will call with alternatives.";
    })();

    const message = slots.length > 0
      ? `Found ${slots.length} option(s) with ${provider.name}.`
      : `No open slots for ${provider.name} in the requested window.`;

    ctx.log({
      level: "info",
      message: "Scheduling run complete",
      meta: {
        provider: provider.name,
        reason: ctx.input.reason,
        operation: ctx.input.operation,
        slotsReturned: slots.length,
        result,
      },
    });

    return {
      provider: provider.name,
      slots: slots.map((slot) => ({
        isoStart: slot.isoStart,
        display: slot.display,
        provider: provider.name,
        location: slot.location,
        type: slot.type,
      })),
      waitlistOffered,
      result,
      confirmation,
      message,
    };
  },
});
