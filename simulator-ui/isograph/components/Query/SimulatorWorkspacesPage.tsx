import { iso } from "@iso-gambit-sim";
import { buildWorkspacePath } from "../../../../src/workspace_routes.ts";
import { GambitLogo } from "../../../src/GambitLogo.tsx";
import { useRouter } from "../../../src/RouterContext.tsx";
import List from "../../../src/gds/List.tsx";
import ListItem from "../../../src/gds/ListItem.tsx";
import Panel from "../../../src/gds/Panel.tsx";
import type { SessionMeta } from "../../../src/utils.ts";
import { formatTimestamp } from "../../../src/utils.ts";

export const SimulatorWorkspacesPage = iso(`
  field Query.SimulatorWorkspacesPage @component {
    gambitWorkspaces(first: 200) {
      edges {
        node {
          id
          deck
          deckSlug
          testBotName
          createdAt
          sessionDir
          statePath
        }
      }
    }
  }
`)(function SimulatorWorkspacesPage({ data }) {
  const { currentRoutePath, navigate } = useRouter();
  const routePrefix = currentRoutePath === "/isograph" ||
      currentRoutePath.startsWith("/isograph/")
    ? "/isograph"
    : "";
  const workspaces: Array<SessionMeta> = (data.gambitWorkspaces?.edges ?? [])
    .flatMap((edge) => {
      const node = edge?.node;
      const id = node?.id;
      if (!id || id.trim().length === 0) return [];
      return [{
        id,
        deck: node.deck ?? undefined,
        deckSlug: node.deckSlug ?? undefined,
        testBotName: node.testBotName ?? undefined,
        createdAt: node.createdAt ?? undefined,
        sessionDir: node.sessionDir ?? undefined,
        statePath: node.statePath ?? undefined,
      }];
    });

  return (
    <div className="docs-shell">
      <section className="docs-hero">
        <p className="docs-eyebrow">
          <span className="docs-eyebrow-logo" aria-label="Gambit">
            <GambitLogo height={11} />
          </span>{" "}
          Simulator
        </p>
        <h1>Workspaces</h1>
        <p className="docs-subtitle">
          Open an existing workspace session.
        </p>
      </section>
      <Panel className="docs-section-card">
        {workspaces.length > 0
          ? (
            <List>
              {workspaces.map((workspace) => (
                <button
                  key={workspace.id}
                  type="button"
                  className="gds-list-item-button"
                  style={{ width: "100%", display: "block" }}
                  onClick={() =>
                    navigate(
                      `${routePrefix}${
                        buildWorkspacePath("build", workspace.id)
                      }`,
                    )}
                >
                  <ListItem
                    title={workspace.testBotName ??
                      workspace.deckSlug ??
                      workspace.deck ??
                      "workspace"}
                    description={formatTimestamp(workspace.createdAt)}
                    meta={<code>{workspace.id}</code>}
                  />
                </button>
              ))}
            </List>
          )
          : <p>No saved workspaces yet.</p>}
      </Panel>
    </div>
  );
});

export default SimulatorWorkspacesPage;
