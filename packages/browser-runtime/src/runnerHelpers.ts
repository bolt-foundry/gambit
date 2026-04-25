import * as path from "@std/path";
import { getLogger } from "./logger.ts";
import type { Frame, Page } from "playwright-core";

const logger = getLogger(import.meta);

export async function getDemoTarget(
  page: Page,
  useIframeShell: boolean,
): Promise<Page | Frame> {
  if (!useIframeShell) return page;
  const iframe = await page.waitForSelector("#demo-frame", { timeout: 30_000 });
  const frame = await iframe?.contentFrame();
  if (!frame) throw new Error("[gambit-demo] iframe content not available");
  await frame.waitForLoadState("domcontentloaded");
  return frame;
}

export function buildDemoIndexContent(args: {
  slug: string;
  epochMs: number;
  headless: boolean;
  executablePath?: string;
  viewport: { width: number; height: number } | null;
  content: { width: number; height: number } | null;
  capture: "mediarecorder" | "cdp";
  mediaRecorderChunkMs: number | "n/a";
  fps: number;
  outputFps: number;
  interpolation: string | "off";
  recordAnyAudio: boolean;
  recordAudio: boolean;
  recordMic: boolean;
  trimAudioDelay: boolean | "n/a";
  latestDir: string;
}): string {
  return [
    `test_name: gambit-ui-demo`,
    `slug: ${args.slug}`,
    `epoch_ms: ${args.epochMs}`,
    `headless: ${String(args.headless)}`,
    `executable_path: ${String(args.executablePath ?? "auto")}`,
    `viewport: ${
      args.viewport ? `${args.viewport.width}x${args.viewport.height}` : "auto"
    }`,
    `content: ${
      args.content ? `${args.content.width}x${args.content.height}` : "auto"
    }`,
    `capture: ${args.capture}`,
    `mediarecorder_chunk_ms: ${args.mediaRecorderChunkMs}`,
    `fps: ${args.fps}`,
    `output_fps: ${args.outputFps}`,
    `interpolate: ${args.interpolation}`,
    `audio: ${
      args.recordAnyAudio
        ? `tab=${args.recordAudio} mic=${args.recordMic}`
        : "off"
    }`,
    `trim_audio_delay: ${args.trimAudioDelay}`,
    `base_dir: ${args.latestDir}`,
  ].join("\n");
}

export function attachPageLogHandlers(
  page: Page,
  logsDir: string,
  verboseLogging: boolean,
): void {
  const logPath = path.join(logsDir, "client.log");
  const errPath = path.join(logsDir, "client.errors.log");

  page.on("console", async (msg) => {
    const argsSummary = await Promise.all(
      msg.args().map(async (arg) => {
        try {
          const value = await arg.jsonValue();
          if (typeof value === "string") return value;
          return JSON.stringify(value);
        } catch {
          return "[unserializable]";
        }
      }),
    ).then((parts) => parts.filter(Boolean).join(" "));
    const messageText = [msg.text(), argsSummary].filter(Boolean).join(" ");
    const line = `${
      new Date().toISOString()
    } ${msg.type().toUpperCase()} console ${messageText}\n`;
    await Deno.writeTextFile(logPath, line, { append: true }).catch(() => {});
    if (msg.type() === "warning" || msg.type() === "error") {
      await Deno.writeTextFile(errPath, line, { append: true }).catch(
        () => {},
      );
    }
  });

  page.on("pageerror", async (err) => {
    const line = `${new Date().toISOString()} ERROR pageerror ${String(err)}\n`;
    await Deno.writeTextFile(errPath, line, { append: true }).catch(() => {});
  });

  if (!verboseLogging) return;

  page.on("requestfailed", async (request) => {
    const failure = request.failure();
    const line = `${
      new Date().toISOString()
    } ERROR requestfailed ${request.method()} ${request.url()}${
      failure?.errorText ? ` ${failure.errorText}` : ""
    }\n`;
    await Deno.writeTextFile(logPath, line, { append: true }).catch(
      () => {},
    );
    await Deno.writeTextFile(errPath, line, { append: true }).catch(
      () => {},
    );
  });

  page.on("response", async (response) => {
    if (response.ok()) return;
    const request = response.request();
    const line = `${
      new Date().toISOString()
    } ERROR response ${request.method()} ${response.status()} ${response.url()}\n`;
    await Deno.writeTextFile(logPath, line, { append: true }).catch(
      () => {},
    );
    await Deno.writeTextFile(errPath, line, { append: true }).catch(
      () => {},
    );
  });
}

export async function copyLatestRun(
  latestDir: string,
  dest: string,
): Promise<void> {
  try {
    await new Deno.Command("cp", {
      args: ["--reflink=auto", "-a", latestDir + "/", dest + "/"],
      stdout: "null",
      stderr: "piped",
    }).output();
  } catch {
    try {
      await new Deno.Command("cp", {
        args: ["-a", "-c", latestDir + "/", dest + "/"],
        stdout: "null",
        stderr: "piped",
      }).output();
    } catch {
      await new Deno.Command("cp", {
        args: ["-a", latestDir + "/", dest + "/"],
        stdout: "null",
        stderr: "piped",
      }).output();
    }
  }
  logger.debug("[gambit-demo] copied latest run to", dest);
}
