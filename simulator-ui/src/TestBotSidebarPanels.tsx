import React from "react";
import Button from "./gds/Button.tsx";
import Callout from "./gds/Callout.tsx";
import List from "./gds/List.tsx";
import ListItem from "./gds/ListItem.tsx";
import Listbox from "./gds/Listbox.tsx";
import Panel from "./gds/Panel.tsx";
import ScrollingText from "./gds/ScrollingText.tsx";
import Tabs from "./gds/Tabs.tsx";

type Option = {
  value: string;
  label: string;
  meta?: string | null;
};

type ToolDisplay = {
  key: string;
  title: string;
  meta?: string | null;
  description?: string | null;
};

type Props = {
  selectedRunValue: string;
  onRunHistorySelection: (runId: string) => void;
  runHistoryOptions: Array<Option>;
  runHistoryDisabled: boolean;
  runHistoryPlaceholder: string;
  canStart: boolean;
  onStartRun: () => void | Promise<void>;
  selectedDeckValue: string | null;
  onDeckSelection: (deckId: string) => void;
  deckOptions: Array<Option>;
  noScenariosCallout?: React.ReactNode;
  botDescription?: string | null;
  scenarioInputSchemaError?: string | null;
  hasScenarioInputSchema: boolean;
  scenarioJsonText: string;
  onScenarioJsonChange: (text: string) => void;
  onScenarioJsonReset: () => void;
  scenarioJsonError?: string | null;
  scenarioMissingFields: Array<string>;
  assistantDeckTab: "input" | "tools" | "schema";
  onAssistantDeckTabChange: (tab: "input" | "tools" | "schema") => void;
  assistantInputSchemaError?: string | null;
  hasAssistantInputSchema: boolean;
  assistantInitJsonText: string;
  onAssistantInitJsonChange: (text: string) => void;
  assistantInitJsonError?: string | null;
  assistantMissingFields: Array<string>;
  onAssistantInitReset: () => void;
  onAssistantSchemaRefresh: () => void;
  toolsLoading?: boolean;
  toolsError?: string | null;
  tools: Array<ToolDisplay>;
  schemaLoading?: boolean;
  schemaError?: string | null;
  schemaPath?: string | null;
  schemaStartMode?: string | null;
  schemaModelParamsJson?: string | null;
};

export default function TestBotSidebarPanels(props: Props) {
  const {
    selectedRunValue,
    onRunHistorySelection,
    runHistoryOptions,
    runHistoryDisabled,
    runHistoryPlaceholder,
    canStart,
    onStartRun,
    selectedDeckValue,
    onDeckSelection,
    deckOptions,
    noScenariosCallout,
    botDescription,
    scenarioInputSchemaError,
    hasScenarioInputSchema,
    scenarioJsonText,
    onScenarioJsonChange,
    onScenarioJsonReset,
    scenarioJsonError,
    scenarioMissingFields,
    assistantDeckTab,
    onAssistantDeckTabChange,
    assistantInputSchemaError,
    hasAssistantInputSchema,
    assistantInitJsonText,
    onAssistantInitJsonChange,
    assistantInitJsonError,
    assistantMissingFields,
    onAssistantInitReset,
    onAssistantSchemaRefresh,
    toolsLoading,
    toolsError,
    tools,
    schemaLoading,
    schemaError,
    schemaPath,
    schemaStartMode,
    schemaModelParamsJson,
  } = props;

  return (
    <div
      className="flex-column gap-8"
      style={{ height: "100%", overflow: "hidden" }}
      data-testid="test-tab-scaffold"
    >
      <Panel className="test-bot-sidebar flex-column gap-8 flex-1">
        <Listbox
          label="Previous test run"
          value={selectedRunValue}
          onChange={onRunHistorySelection}
          disabled={runHistoryDisabled}
          options={runHistoryOptions}
          placeholder={runHistoryPlaceholder}
        />
        <div className="flex-row gap-8 items-center">
          <div className="flex-1">
            <strong>Scenario deck</strong>
          </div>
          <Button
            variant="primary"
            onClick={onStartRun}
            disabled={!canStart}
            data-testid="testbot-run"
          >
            Run scenario
          </Button>
        </div>
        {deckOptions.length > 0 && (
          <Listbox
            value={selectedDeckValue ?? ""}
            onChange={onDeckSelection}
            options={deckOptions}
          />
        )}
        {deckOptions.length === 0 && noScenariosCallout}
        {botDescription && <Callout>{botDescription}</Callout>}
        <strong>Scenario deck input</strong>
        {scenarioInputSchemaError && (
          <div className="error">{scenarioInputSchemaError}</div>
        )}
        {hasScenarioInputSchema && (
          <>
            <div className="init-field">
              <label>
                <span>Scenario JSON</span>
              </label>
              <textarea
                className="json-input"
                data-testid="testbot-scenario-json-input"
                value={scenarioJsonText}
                placeholder="Paste full scenario JSON payload"
                onChange={(e) => onScenarioJsonChange(e.target.value)}
                style={{ minHeight: 160 }}
              />
              {scenarioJsonError && (
                <div className="error">{scenarioJsonError}</div>
              )}
              {!scenarioJsonError && (
                <div className="secondary-note">
                  Paste a complete JSON payload matching the schema.
                </div>
              )}
              {scenarioMissingFields.length > 0 && (
                <div className="error">
                  Missing required scenario fields:{" "}
                  {scenarioMissingFields.join(", ")}
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Button variant="ghost" onClick={onScenarioJsonReset}>
                Reset scenario
              </Button>
            </div>
          </>
        )}
        {!hasScenarioInputSchema && (
          <Callout>
            No scenario input schema configured.
          </Callout>
        )}
      </Panel>

      <Panel className="flex-column gap-10 flex-1">
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <strong>Assistant deck</strong>
        </div>
        <Tabs
          className="panel-tabs"
          style={{ marginTop: 6 }}
          size="small"
          tabClassName="flex-1"
          activeId={assistantDeckTab}
          onChange={(next) =>
            onAssistantDeckTabChange(next as "input" | "tools" | "schema")}
          tabs={[
            { id: "input", label: "Input" },
            { id: "tools", label: "Tools" },
            { id: "schema", label: "Schema" },
          ]}
        />
        {assistantDeckTab === "input" && (
          <>
            {assistantInputSchemaError && (
              <div className="error">{assistantInputSchemaError}</div>
            )}
            {hasAssistantInputSchema && (
              <>
                <div className="init-field">
                  <label>
                    <span>Init JSON</span>
                  </label>
                  <textarea
                    className="json-input"
                    data-testid="testbot-assistant-init-json-input"
                    value={assistantInitJsonText}
                    placeholder="Paste full assistant init JSON payload"
                    onChange={(e) => onAssistantInitJsonChange(e.target.value)}
                    style={{ minHeight: 160 }}
                  />
                  {assistantInitJsonError && (
                    <div className="error">{assistantInitJsonError}</div>
                  )}
                  {!assistantInitJsonError && (
                    <div className="secondary-note">
                      Paste a complete JSON payload matching the schema.
                    </div>
                  )}
                  {assistantMissingFields.length > 0 && (
                    <div className="error">
                      Missing required init fields:{" "}
                      {assistantMissingFields.join(", ")}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Button variant="ghost" onClick={onAssistantInitReset}>
                    Reset init
                  </Button>
                  <Button variant="ghost" onClick={onAssistantSchemaRefresh}>
                    Refresh schema
                  </Button>
                </div>
              </>
            )}
            {!hasAssistantInputSchema && (
              <Callout>
                No input schema found for this deck.
              </Callout>
            )}
          </>
        )}
        {assistantDeckTab === "tools" && (
          <>
            {toolsLoading && (
              <div className="editor-status">Loading tools…</div>
            )}
            {toolsError && <div className="error">{toolsError}</div>}
            {!toolsLoading && !toolsError && tools.length === 0 && (
              <Callout>
                No tools declared for this deck.
              </Callout>
            )}
            {tools.length > 0 && (
              <List>
                {tools.map((tool) => (
                  <ListItem
                    key={tool.key}
                    title={tool.title}
                    meta={tool.meta ? <code>{tool.meta}</code> : null}
                    description={tool.description ?? undefined}
                  />
                ))}
              </List>
            )}
          </>
        )}
        {assistantDeckTab === "schema" && (
          <div className="flex-column gap-6 flex-1">
            {schemaLoading && (
              <div className="editor-status">Loading schema…</div>
            )}
            {schemaError && <div className="error">{schemaError}</div>}
            {!schemaLoading && !schemaError && (
              <List className="flex-1">
                <ListItem
                  title="Deck metadata"
                  description={
                    <>
                      <div className="flex-row gap-4">
                        <span>
                          <strong>Path</strong>:
                        </span>
                        <ScrollingText
                          as="div"
                          text={schemaPath ?? "unknown"}
                        />
                      </div>
                      <div>
                        <strong>Start mode</strong>:{" "}
                        {schemaStartMode ?? "assistant"}
                      </div>
                      {schemaModelParamsJson && (
                        <div className="flex-column gap-4">
                          <strong>Model params</strong>
                          <pre className="trace-json">{schemaModelParamsJson}</pre>
                        </div>
                      )}
                    </>
                  }
                />
              </List>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}
