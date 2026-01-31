import Button from "./gds/Button.tsx";
import { GambitLogo } from "./GambitLogo.tsx";

const GAMBIT_PACKAGE_README =
  "https://github.com/molt-foundry/gambit/blob/main/README.md";
const GAMBIT_CLI_DOC =
  "https://github.com/molt-foundry/gambit/blob/main/docs/cli.md";
const DEFAULT_TEST_PATH = "/sessions/new/test";
const DEFAULT_DEBUG_PATH = "/sessions/new/debug";
const DEFAULT_GRADE_PATH = "/grade";

export default function DocsPage() {
  return (
    <div className="docs-shell">
      <section className="docs-hero">
        <p className="docs-eyebrow">
          <span className="docs-eyebrow-logo" aria-label="Gambit">
            <GambitLogo height={11} />
          </span>{" "}
          Simulator
        </p>
        <h1>Test an agent. See where it fails. Fix it fast.</h1>
        <p className="docs-subtitle">
          Gambit is an open-source agent harness framework. It's designed to
          make it simple to create, debug, and fix AI workflows, agents and
          assistants.
        </p>
      </section>

      <section className="docs-section docs-get-started">
        <header className="docs-section-header">
          <span className="docs-icon">🤖</span>
          <h2>Start here:</h2>
          <Button
            variant="primary"
            size="large"
            href={DEFAULT_TEST_PATH}
          >
            Open Test
          </Button>
        </header>
        <div className="docs-section-card">
          <p>
            The Test view lets you interact with your agent like a real user
            would.
          </p>
          <div className="docs-divider" />
          <h3>What to do</h3>
          <ul>
            <li>
              Some examples have a Test input, these are usually optional.
            </li>
            <li>Click "Run test bot" to start the conversation.</li>
            <li>Review the agent's response.</li>
          </ul>
          <h3>If something looks wrong</h3>
          <ul>
            <li>Leave a quick rating and a short note explaining why.</li>
            <li>Failures get captured for evaluation.</li>
          </ul>
          <h3>Grade the agent</h3>
          <ul>
            <li>Click the "Grade" tab to see all test bot runs.</li>
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

      <section className="docs-section">
        <header className="docs-section-header">
          <span className="docs-icon">🧭</span>
          <h2>When should I use each tab?</h2>
        </header>
        <div className="docs-section-card">
          <div className="docs-tab-row">
            <Button
              variant="primary-deemph"
              href={DEFAULT_TEST_PATH}
              size="small"
            >
              Test
            </Button>
            <p>
              Use this whenever you want to{" "}
              <strong>understand behavior</strong>. This is where almost
              everyone should start.
            </p>
          </div>
          <div className="docs-tab-row">
            <Button
              variant="primary-deemph"
              href={DEFAULT_GRADE_PATH}
              size="small"
            >
              Grade
            </Button>
            <p>
              Use this once you care about{" "}
              <strong>measuring quality</strong>, not just eyeballing it.
            </p>
          </div>
          <div className="docs-tab-row">
            <Button
              variant="primary-deemph"
              href={DEFAULT_DEBUG_PATH}
              size="small"
            >
              Debug
            </Button>
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
