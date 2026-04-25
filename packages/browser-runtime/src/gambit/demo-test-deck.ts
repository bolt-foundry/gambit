import {
  createDefaultedRuntime,
  isGambitEndSignal,
  runDeck,
} from "@bolt-foundry/gambit";
import type { SavedState } from "@bolt-foundry/gambit-core";

const DEFAULT_DEMO_MODEL = "openrouter/openai/gpt-5.1-chat";
const DEFAULT_ASSISTANT_PROMPT = "Hi! What would you like to build?";
const BOT_ROOT_ENV = "GAMBIT_BOT_ROOT";

function resolveWorkspacePermissions(workspaceRoot?: string): {
  baseDir?: string;
  permissions?: {
    read: true;
    write: true;
    run: false;
    net: false;
    env: false;
  };
} {
  if (!workspaceRoot) {
    return {};
  }
  return {
    baseDir: workspaceRoot,
    permissions: {
      read: true,
      write: true,
      run: false,
      net: false,
      env: false,
    },
  };
}

async function withPromptDriverBotRoot<T>(
  workspaceRoot: string | undefined,
  run: () => Promise<T>,
): Promise<T> {
  if (!workspaceRoot) return await run();
  const previous = Deno.env.get(BOT_ROOT_ENV);
  Deno.env.set(BOT_ROOT_ENV, workspaceRoot);
  try {
    return await run();
  } finally {
    if (previous === undefined) {
      Deno.env.delete(BOT_ROOT_ENV);
    } else {
      Deno.env.set(BOT_ROOT_ENV, previous);
    }
  }
}

export function createDemoTestDeckSession(opts: {
  deckPath: string;
  model?: string;
  workspaceRoot?: string;
}): {
  nextPrompt: (assistantPrompt?: string) => Promise<string>;
  getState: () => SavedState | undefined;
} {
  const workspacePermissions = resolveWorkspacePermissions(opts.workspaceRoot);
  const runtimePromise = createDefaultedRuntime({
    configHint: opts.deckPath,
    defaultModel: opts.model ?? DEFAULT_DEMO_MODEL,
  });
  let deckState: SavedState | undefined = undefined;

  const nextPrompt = async (assistantPrompt?: string): Promise<string> => {
    const runtime = await runtimePromise;
    const result = await withPromptDriverBotRoot(
      opts.workspaceRoot,
      async () =>
        await runDeck({
          runtime,
          path: opts.deckPath,
          input: undefined,
          inputProvided: false,
          initialUserMessage: assistantPrompt ?? DEFAULT_ASSISTANT_PROMPT,
          allowRootStringInput: true,
          state: deckState,
          onStateUpdate: (state) => {
            deckState = state;
          },
          workspacePermissionsBaseDir: workspacePermissions.baseDir,
          workspacePermissions: workspacePermissions.permissions,
        }),
    );
    if (isGambitEndSignal(result)) {
      return "";
    }
    const text = typeof result === "string" ? result : JSON.stringify(result);
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!normalized) {
      return "";
    }
    return normalized;
  };

  return {
    nextPrompt,
    getState: () => deckState,
  };
}

export async function resolveDemoTestDeckPrompt(opts: {
  deckPath: string;
  assistantPrompt?: string;
  model?: string;
  workspaceRoot?: string;
}): Promise<string> {
  const workspacePermissions = resolveWorkspacePermissions(opts.workspaceRoot);
  const runtime = await createDefaultedRuntime({
    configHint: opts.deckPath,
    defaultModel: opts.model ?? DEFAULT_DEMO_MODEL,
  });

  const result = await withPromptDriverBotRoot(
    opts.workspaceRoot,
    async () =>
      await runDeck({
        runtime,
        path: opts.deckPath,
        input: undefined,
        inputProvided: false,
        initialUserMessage: opts.assistantPrompt ?? DEFAULT_ASSISTANT_PROMPT,
        allowRootStringInput: true,
        workspacePermissionsBaseDir: workspacePermissions.baseDir,
        workspacePermissions: workspacePermissions.permissions,
      }),
  );

  if (isGambitEndSignal(result)) {
    throw new Error(
      `Test deck prompt output ended early for ${opts.deckPath}.`,
    );
  }
  const text = typeof result === "string" ? result : JSON.stringify(result);
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    throw new Error(
      `Test deck prompt output was empty for ${opts.deckPath}.`,
    );
  }
  return normalized;
}
