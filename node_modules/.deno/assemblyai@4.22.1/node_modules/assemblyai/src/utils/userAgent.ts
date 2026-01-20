import { UserAgent } from "../types";

export const buildUserAgent = (userAgent: UserAgent | false) =>
  defaultUserAgentString +
  (userAgent === false
    ? ""
    : " AssemblyAI/1.0 (" +
      Object.entries({ ...defaultUserAgent, ...userAgent })
        .map(([key, item]) =>
          item ? `${key}=${item.name}/${item.version}` : "",
        )
        .join(" ") +
      ")");

let defaultUserAgentString = "";
if (typeof navigator !== "undefined" && navigator.userAgent) {
  defaultUserAgentString += navigator.userAgent;
}

const defaultUserAgent: UserAgent = {
  sdk: { name: "JavaScript", version: "__SDK_VERSION__" },
};

if (typeof process !== "undefined") {
  if (process.versions.node && defaultUserAgentString.indexOf("Node") === -1) {
    defaultUserAgent.runtime_env = {
      name: "Node",
      version: process.versions.node,
    };
  }
  if (process.versions.bun && defaultUserAgentString.indexOf("Bun") === -1) {
    defaultUserAgent.runtime_env = {
      name: "Bun",
      version: process.versions.bun,
    };
  }
}

declare const Deno:
  | {
      version: {
        deno: string;
      };
    }
  | undefined;

if (typeof Deno !== "undefined") {
  if (process.versions.bun && defaultUserAgentString.indexOf("Deno") === -1) {
    defaultUserAgent.runtime_env = { name: "Deno", version: Deno.version.deno };
  }
}
