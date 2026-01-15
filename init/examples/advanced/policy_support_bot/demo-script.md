# Demo Script — Policy Support Bot

Use this script in the Gambit Debug UI (or CLI) to validate grounded answers and
"not in FAQ" replies. Fill in the `Result` column as you test.

| # | Prompt                                                         | Expected Behavior                                | Notes                                                      | Result |
| - | -------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------- | ------ |
| 1 | "How much does AcmeFlow cost?"                                 | One-sentence pricing answer grounded in the FAQ. | Should mention $49 Starter baseline.                       |        |
| 2 | "Can I export my workflow data?"                               | One-sentence answer grounded in the FAQ.         | Mention admins + dashboard instructions.                   |        |
| 3 | "Is AcmeFlow HIPAA compliant?"                                 | "I couldn't find that in the FAQ."               | FAQ lacks HIPAA coverage.                                  |        |
| 4 | "What response times do you guarantee for enterprise support?" | One-sentence answer grounded in the FAQ.         | Acceptable to mention the 4-hour Enterprise response time. |        |
| 5 | "Can I switch from monthly to annual billing mid-cycle?"       | "I couldn't find that in the FAQ."               | FAQ only covers billing cycle timing.                      |        |
| 6 | "Who can use AcmeFlow and does it offer an API?"               | One-sentence answer grounded in the FAQ.         | Should combine both facts succinctly.                      |        |
