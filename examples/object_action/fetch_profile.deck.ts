import { defineDeck } from "../../mod.ts";
import { z } from "zod";
import fetchProfileInputSchema from "./schemas/fetch_profile_input.zod.ts";
import fetchProfileOutputSchema from "./schemas/fetch_profile_output.zod.ts";

type Profile = z.infer<typeof fetchProfileOutputSchema>;

const directory: Record<string, Profile> = {
  casey: {
    name: "Casey Lin",
    title: "Staff Product Designer",
    yearsExperience: 8,
    projects: ["Pilot", "Journey Maps"],
    focus: "Design system cohesion and accessibility",
  },
  jordan: {
    name: "Jordan Patel",
    title: "Senior AI Engineer",
    yearsExperience: 6,
    projects: ["Deck Builder", "Replay Service"],
    focus: "Fast iteration on orchestration logic",
  },
  blair: {
    name: "Blair Ortiz",
    title: "Product Manager",
    yearsExperience: 9,
    projects: ["Insights", "Playbooks"],
    focus: "Helping teams reason about agent behavior",
  },
};

export default defineDeck({
  inputSchema: fetchProfileInputSchema,
  outputSchema: fetchProfileOutputSchema,
  label: "fetch_profile",
  run(ctx: { input: z.infer<typeof fetchProfileInputSchema> }) {
    const key = ctx.input.name.trim().toLowerCase();
    const profile = directory[key as keyof typeof directory];
    if (profile) return profile;

    return {
      name: ctx.input.name,
      title: "Unknown",
      yearsExperience: 0,
      projects: ["Unknown"],
      focus: "Unknown",
    };
  },
});
