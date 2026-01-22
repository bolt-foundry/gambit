const GAMBIT_PACKAGE_README =
  "https://github.com/bolt-foundry/gambit/blob/main/README.md";
const GAMBIT_CLI_DOC =
  "https://github.com/bolt-foundry/gambit/blob/main/docs/cli.md";
const DEFAULT_TEST_BOT_PATH = "/sessions/new/test-bot";
const DEFAULT_DEBUG_PATH = "/sessions/new/debug";
const DEFAULT_CALIBRATE_PATH = "/calibrate";

export default function DocsPage() {
  return (
    <div className="docs-shell">
      <section className="docs-hero">
        <p className="docs-eyebrow">Gambit Simulator</p>
        <h1>Test an agent. See where it fails. Fix it fast.</h1>
        <p className="docs-subtitle">
          Gambit is an open-source agent harness framework. It's designed to
          make it simple to create, debug, and fix AI workflows, agents and
          assistants.
        </p>
      </section>

      <section className="docs-callout">
        <header className="docs-callout-header">
          <div>
            <h2
              style={{
                display: "flex",
                flexDirection: "row",
                gap: 12,
                alignItems: "center",
              }}
            >
              <span className="docs-icon">🤖</span>
              Start here:
              <a
                className="gds-button gds-button--primary"
                href={DEFAULT_TEST_BOT_PATH}
              >
                Open Test Bot
              </a>
            </h2>
          </div>
        </header>
        <div className="docs-callout-body">
          <p>
            The Test Bot lets you interact with your agent like a real user
            would.
          </p>
          <div className="docs-divider" />
          <h3>What to do</h3>
          <ul>
            <li>
              Some examples have a Test Bot input, these are usually optional.
            </li>
            <li>Click "Run test bot" to start the conversation.</li>
            <li>Review the agent's response.</li>
          </ul>
          <h3>If something looks wrong</h3>
          <ul>
            <li>Leave a quick rating and a short note explaining why.</li>
            <li>Failures get captured for evaluation.</li>
          </ul>
          <h3>Calibrate the agent</h3>
          <ul>
            <li>Click the "Calibrate" tab to see all test bot runs.</li>
            <li>Run graders to measure quality and identify issues.</li>
            <li>Flag grader results you want to keep track of.</li>
          </ul>
          <h3>Fix it</h3>
          <ul>
            <li>Click "Copy state path" to copy the state file location.</li>
            <li>
              Share the state file with Codex, update the deck, then rerun.
            </li>
          </ul>
        </div>
      </section>

      <section className="docs-section docs-tabs">
        <header className="docs-section-header">
          <span className="docs-icon">🧭</span>
          <h2>When should I use each tab?</h2>
        </header>
        <div className="docs-tab-card">
          <div className="docs-tab-row">
            <a className="docs-tab-pill" href={DEFAULT_TEST_BOT_PATH}>
              Test Bot
            </a>
            <p>
              Use this whenever you want to{" "}
              <strong>understand behavior</strong>. This is where almost
              everyone should start.
            </p>
          </div>
          <div className="docs-tab-row">
            <a
              className="docs-tab-pill docs-tab-pill--gold"
              href={DEFAULT_CALIBRATE_PATH}
            >
              Calibrate
            </a>
            <p>
              Use this once you care about{" "}
              <strong>measuring quality</strong>, not just eyeballing it.
            </p>
          </div>
          <div className="docs-tab-row">
            <a
              className="docs-tab-pill docs-tab-pill--indigo"
              href={DEFAULT_DEBUG_PATH}
            >
              Debug
            </a>
            <p>
              Use this when you need to understand{" "}
              <strong>why something failed</strong> at a deeper level.
            </p>
          </div>
        </div>
      </section>

      <section className="docs-links">
        <h3>More docs</h3>
        <ul>
          <li>
            <a href={GAMBIT_PACKAGE_README} target="_blank" rel="noreferrer">
              README.md
            </a>{" "}
            — architecture, concepts, release notes.
          </li>
          <li>
            <a href={GAMBIT_CLI_DOC} target="_blank" rel="noreferrer">
              docs/cli.md
            </a>{" "}
            — CLI commands, flags, and workflows.
          </li>
        </ul>
      </section>
    </div>
  );
}
