import { assert, assertEquals } from "jsr:@std/assert";

const faqPath = new URL("../cards/faq_knowledge.card.md", import.meta.url);
let cachedFaqText: string | null = null;

async function loadFaqText() {
  if (cachedFaqText) return cachedFaqText;
  cachedFaqText = await Deno.readTextFile(faqPath);
  return cachedFaqText;
}

Deno.test({
  name: "FAQ card lists all major categories",
  permissions: { read: true },
}, async () => {
  const faqText = await loadFaqText();
  const categories = [
    "Company Overview",
    "Plans & Pricing",
    "Billing & Payments",
    "Refunds & Cancellations",
    "Account Management",
    "Data & Security",
    "Integrations & Features",
    "Support & SLAs",
    "Compliance & Legal",
  ];
  for (const category of categories) {
    assert(
      faqText.includes(`## ${category}`),
      `Missing category heading: ${category}`,
    );
  }
});

Deno.test({
  name: "FAQ card keeps exact identifiers for key entries",
  permissions: { read: true },
}, async () => {
  const faqText = await loadFaqText();
  const ids = [
    "plans_pricing.how_much_does_acmeflow_cost",
    "plans_pricing.free_trial",
    "billing_payments.change_plan",
    "support_slas.response_times",
    "compliance_legal.gdpr",
  ];
  for (const id of ids) {
    assert(
      faqText.includes(`\`${id}\``),
      `Missing FAQ id: ${id}`,
    );
  }
});

Deno.test({
  name: "FAQ card includes canonical Q and A text for pricing",
  permissions: { read: true },
}, async () => {
  const faqText = await loadFaqText();
  const question = "How much does AcmeFlow cost?";
  const answerSnippet = "Pricing starts at $49 per user per month";
  assert(faqText.includes(question), "Missing pricing question");
  assert(faqText.includes(answerSnippet), "Missing pricing answer snippet");
});

Deno.test({
  name: "FAQ metadata count matches expected number of entries",
  permissions: { read: true },
}, async () => {
  const faqText = await loadFaqText();
  const idMatches = faqText.match(/`[a-z0-9_.]+`/g) ?? [];
  // 28 FAQ entries total.
  assertEquals(idMatches.length, 28, "Unexpected FAQ entry count");
});
