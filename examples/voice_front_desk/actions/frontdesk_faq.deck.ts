import { defineDeck } from "../../../mod.ts";
import { z } from "zod";

const inputSchema = z.object({
  clinicId: z.string().optional(),
  question: z.string(),
});

const outputSchema = z.string();

const clinicFaqDocument = `
Clinic FAQ

Hours
- Monday through Thursday: 8am-6pm
- Friday: 8am-4pm
- Saturday urgent visits: 9am-1pm

Location & parking
- 2147 Winding Creek Road, Suite 300, San Mateo
- Garage parking on site

Services
- New patient options: general consults, wellness check-ups, initial assessments
- Most scheduling requires patient basics before confirming availability

Pricing & insurance
- Most visits billed to insurance
- Self-pay new visits start at $185 and include follow-up messaging

New patient paperwork
- Forms are provided after appointment confirmation
- Office staff can send paperwork links by email or text

After-hours
- After-hours line can capture messages and arrange follow-up
`;

export default defineDeck({
  label: "frontdesk_faq",
  inputSchema,
  outputSchema,
  async run(ctx) {
    void ctx.input;
    await new Promise((resolve) => setTimeout(resolve, 120));
    return clinicFaqDocument.trim();
  },
});
