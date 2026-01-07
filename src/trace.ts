import * as path from "@std/path";
import type { TraceEvent } from "@bolt-foundry/gambit-core/internal/types";

const logger = console;

export function makeJsonlTracer(filePath: string): (event: TraceEvent) => void {
  const resolved = path.resolve(filePath);
  const dir = path.dirname(resolved);
  Deno.mkdirSync(dir, { recursive: true });
  return (event: TraceEvent) => {
    const line = JSON.stringify(event);
    Deno.writeTextFileSync(resolved, line + "\n", { append: true });
  };
}

export function makeConsoleTracer(): (event: TraceEvent) => void {
  const started = new Map<string, number>();
  const now = () => performance.now();
  const fmtMs = (start?: number) =>
    start !== undefined ? ` elapsed_ms=${Math.round(now() - start)}` : "";

  return (event: TraceEvent) => {
    switch (event.type) {
      case "run.start":
        started.set(event.runId, now());
        logger.log(
          `[trace] run.start runId=${event.runId}${
            event.deckPath ? ` deck=${event.deckPath}` : ""
          }${
            event.initialUserMessage !== undefined
              ? ` initialUserMessage=${
                JSON.stringify(event.initialUserMessage)
              }`
              : ""
          }${
            event.input !== undefined
              ? ` input=${JSON.stringify(event.input)}`
              : ""
          }`,
        );
        break;
      case "run.end": {
        const start = started.get(event.runId);
        started.delete(event.runId);
        logger.log(`[trace] run.end runId=${event.runId}${fmtMs(start)}`);
        break;
      }
      case "message.user": {
        logger.log(
          `[trace] message.user runId=${event.runId} actionCallId=${event.actionCallId} deck=${event.deckPath} content=${
            JSON.stringify(event.message?.content ?? "")
          }`,
        );
        break;
      }
      case "deck.start":
        started.set(event.actionCallId, now());
        logger.log(
          `[trace] deck.start runId=${event.runId} actionCallId=${event.actionCallId} deck=${event.deckPath}`,
        );
        break;
      case "deck.end": {
        const start = started.get(event.actionCallId);
        started.delete(event.actionCallId);
        logger.log(
          `[trace] deck.end runId=${event.runId} actionCallId=${event.actionCallId} deck=${event.deckPath}${
            fmtMs(start)
          }`,
        );
        break;
      }
      case "action.start":
        started.set(event.actionCallId, now());
        logger.log(
          `[trace] action.start runId=${event.runId} actionCallId=${event.actionCallId} name=${event.name} path=${event.path}`,
        );
        break;
      case "action.end": {
        const start = started.get(event.actionCallId);
        started.delete(event.actionCallId);
        logger.log(
          `[trace] action.end runId=${event.runId} actionCallId=${event.actionCallId} name=${event.name} path=${event.path}${
            fmtMs(start)
          }`,
        );
        break;
      }
      case "tool.call":
        logger.log(
          `[trace] tool.call runId=${event.runId} actionCallId=${event.actionCallId} name=${event.name} args=${
            JSON.stringify(event.args)
          }`,
        );
        break;
      case "tool.result":
        logger.log(
          `[trace] tool.result runId=${event.runId} actionCallId=${event.actionCallId} name=${event.name} result=${
            JSON.stringify(event.result)
          }`,
        );
        break;
      case "model.call":
        logger.log(
          `[trace] model.call runId=${event.runId} actionCallId=${event.actionCallId} deck=${event.deckPath} model=${
            event.model ?? "(default)"
          } messages=${event.messageCount ?? event.messages.length} tools=${
            event.toolCount ?? event.tools?.length ?? 0
          } stream=${event.stream ?? false} stateMessages=${
            event.stateMessages ?? 0
          }`,
        );
        break;
      case "model.result":
        logger.log(
          `[trace] model.result runId=${event.runId} actionCallId=${event.actionCallId} deck=${event.deckPath} model=${
            event.model ?? "(default)"
          } finish=${event.finishReason} toolCalls=${
            event.toolCalls?.length ?? 0
          } stateMessages=${event.stateMessages ?? 0}`,
        );
        break;
      case "log": {
        const meta = event.meta !== undefined
          ? ` meta=${JSON.stringify(event.meta)}`
          : "";
        const title = event.title ? ` title="${event.title}"` : "";
        const msg = event.message ? ` msg="${event.message}"` : "";
        logger.log(
          `[log] level=${
            event.level ?? "info"
          } runId=${event.runId} actionCallId=${event.actionCallId} deck=${event.deckPath}${title}${msg}${meta}`,
        );
        break;
      }
      case "monolog": {
        logger.log(
          `[monolog] runId=${event.runId} actionCallId=${event.actionCallId} deck=${event.deckPath} content=${
            JSON.stringify(event.content)
          }`,
        );
        break;
      }
      default:
        logger.log("[trace]", event);
    }
  };
}
