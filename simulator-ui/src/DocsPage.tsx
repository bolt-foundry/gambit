import { useCallback, useEffect, useState } from "react";

const GAMBIT_PACKAGE_README =
  "https://github.com/bolt-foundry/gambit/blob/main/README.md";
const GAMBIT_CLI_DOC =
  "https://github.com/bolt-foundry/gambit/blob/main/docs/cli.md";

export type DocsPageProps = {
  deckDisplayPath: string;
  deckAbsolutePath: string;
};

export default function DocsPage(props: DocsPageProps) {
  const {
    deckDisplayPath,
    deckAbsolutePath,
  } = props;
  const [deckSource, setDeckSource] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/deck-source");
        if (!res.ok) throw new Error(res.statusText);
        const body = await res.json() as {
          path?: string;
          content?: string;
          error?: string;
        };
        if (cancelled) return;
        if (body.error) {
          setError(body.error);
          setDeckSource(body.content ?? null);
        } else {
          setDeckSource(body.content ?? "");
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load deck");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!copied) return;
    const handle = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(handle);
  }, [copied]);

  const handleCopyPath = useCallback(async () => {
    try {
      await navigator.clipboard?.writeText(deckAbsolutePath);
      setCopied(true);
    } catch {
      setCopied(true);
    }
  }, [deckAbsolutePath]);

  return (
    <div className="docs-shell">
      <section className="docs-hero">
        <h2>Gambit Simulator</h2>
        <p>
          <strong>Use the simulator to iterate fast and fix failures.</strong>
          {" "}
          Run a test, capture why it failed, grade the result, and hand the
          evidence to Codex so it can help you update the deck.
        </p>
        <p>
          The simulator keeps the whole loop in one place: Test Bot to explore,
          Calibrate to grade, and Debug to inspect.
        </p>
      </section>
      <section className="docs-grid">
        <article className="docs-card">
          <h3>Run the test</h3>
          <p>
            Open Test Bot and try the scenario you care about. If the output
            looks wrong, add a rating and a short reason so the failure is
            captured.
          </p>
        </article>
        <article className="docs-card">
          <h3>Grade</h3>
          <p>
            Run the grader in Calibrate. Copy a reference or the state file link
            for sharing.
          </p>
        </article>
        <article className="docs-card">
          <h3>Fix + rerun</h3>
          <p>
            Paste the reference or state link into Codex and ask for help fixing
            the deck. Codex updates files, then you rerun the simulator to
            verify.
          </p>
        </article>
      </section>
      <section className="deck-preview-shell">
        <header>
          <div>
            <h3>Current deck</h3>
            <p>
              Edit this file in your editor. After changes, rerun or refresh the
              simulator.
            </p>
          </div>
          <div className="deck-preview-meta">
            <span>
              Path: <code>{deckDisplayPath}</code>
            </span>{" "}
            <button type="button" onClick={handleCopyPath}>
              {copied ? "Copied" : "Copy path"}
            </button>
          </div>
        </header>
        <div className="deck-preview-body">
          {loading && <div className="placeholder">Loading deck…</div>}
          {!loading && error && (
            <div className="error">Failed to read deck: {error}</div>
          )}
          {!loading && !error && (
            <pre className="deck-preview">
              <code>{deckSource ?? ""}</code>
            </pre>
          )}
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
