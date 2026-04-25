type BrowserRuntimeLogger = {
  debug: (...args: Array<unknown>) => void;
  info: (...args: Array<unknown>) => void;
  warn: (...args: Array<unknown>) => void;
};

const encoder = new TextEncoder();

function isDebugEnabled(): boolean {
  const raw = (Deno.env.get("BF_BROWSER_RUNTIME_DEBUG") ?? "").trim()
    .toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function formatPart(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) {
    return value.stack || value.message || String(value);
  }
  return Deno.inspect(value, { colors: false, depth: 6 });
}

function write(
  target: "stdout" | "stderr",
  args: Array<unknown>,
): void {
  const message = `${args.map(formatPart).join(" ")}\n`;
  if (target === "stderr") {
    Deno.stderr.writeSync(encoder.encode(message));
    return;
  }
  Deno.stdout.writeSync(encoder.encode(message));
}

export function getLogger(_meta: ImportMeta): BrowserRuntimeLogger {
  return {
    debug: (...args) => {
      if (!isDebugEnabled()) return;
      write("stdout", args);
    },
    info: (...args) => write("stdout", args),
    warn: (...args) => write("stderr", args),
  };
}
