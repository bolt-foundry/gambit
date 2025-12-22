import { defineDeck } from "../../mod.ts";
import { z } from "zod";

type Profile = {
  summary: string;
  role: string;
  company: string;
  industry: string;
  challenges: string[];
  initiatives: string[];
  techStack: string[];
  recentEvents: string[];
  trends: string[];
  signals: string[];
  source: string;
};

const profiles: Record<string, Profile> = {
  randall: {
    summary: "Co-founder at Bolt Foundry building AI telemetry and analytics.",
    role: "Co-founder",
    company: "Bolt Foundry",
    industry: "AI tooling",
    challenges: ["Proving LLM quality", "Scaling AI reliability"],
    initiatives: ["Telemetry SDK rollout", "Developer adoption"],
    techStack: ["TypeScript", "Deno", "OpenAI-compatible APIs"],
    recentEvents: ["SDK in early development"],
    trends: ["LLM observability", "AI reliability"],
    signals: ["Telemetry focus", "Developer-first tooling"],
    source: "demo-data",
  },
  jordan: {
    summary: "VP Marketing at a SaaS company with stalled growth.",
    role: "VP Marketing",
    company: "SaaSGrowth",
    industry: "B2B SaaS",
    challenges: ["Stalled pipeline growth", "Unclear attribution"],
    initiatives: ["ABM expansion", "Content refresh"],
    techStack: ["HubSpot", "Salesforce", "GA4"],
    recentEvents: ["New product tier launch"],
    trends: ["Pipeline efficiency", "Attribution pressure"],
    signals: ["Pipeline efficiency", "Attribution clarity"],
    source: "demo-data",
  },
};

export default defineDeck({
  label: "lookup_profile",
  inputSchema: z.object({
    name: z.string().min(1).describe("Recipient name"),
    details: z.string().min(1).describe("Recipient context and pitch details"),
    products: z.array(z.string().min(1)).min(1).optional()
      .describe("Products or offerings to position in the email"),
  }),
  outputSchema: z.object({
    summary: z.string().min(1).describe("Short profile summary"),
    role: z.string().min(1).describe("Recipient role"),
    company: z.string().min(1).describe("Recipient company"),
    industry: z.string().min(1).describe("Company industry"),
    challenges: z.array(z.string().min(1)).describe("Known challenges"),
    initiatives: z.array(z.string().min(1)).describe("Active initiatives"),
    techStack: z.array(z.string().min(1)).describe("Known tools or stack"),
    recentEvents: z.array(z.string().min(1)).describe("Recent events"),
    trends: z.array(z.string().min(1)).describe("Relevant market trends"),
    signals: z.array(z.string().min(1)).describe("Relevant signals"),
    source: z.string().min(1).describe("Data source identifier"),
  }),
  run(ctx) {
    const key = ctx.input.name.trim().toLowerCase();
    const profile = profiles[key] ?? {
      summary: `No demo profile found for ${ctx.input.name}.`,
      role: "Unknown",
      company: "Unknown",
      industry: "Unknown",
      challenges: [],
      initiatives: [],
      techStack: [],
      recentEvents: [],
      trends: [],
      signals: [],
      source: "demo-data",
    };
    return profile;
  },
});
