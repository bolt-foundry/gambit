import type {
  Frame,
  Page,
  Request as PlaywrightRequest,
} from "playwright-core";
import { isTransientActionError, wait } from "./browserTestContextShared.ts";

type ActionTarget = Page | Frame;

export async function waitForUrl(
  target: ActionTarget,
  re: RegExp,
  opts?: { quietMs?: number; timeoutMs?: number },
): Promise<void> {
  await target.waitForFunction(
    ({ pattern, flags }: { pattern: string; flags: string }) => {
      const matcher = new RegExp(pattern, flags);
      return matcher.test(new URL(location.href).pathname);
    },
    { pattern: re.source, flags: re.flags },
    { timeout: opts?.timeoutMs ?? 8_000 },
  );
  if ((opts?.quietMs ?? 300) > 0) await wait(opts?.quietMs ?? 300);
}

export async function currentPath(target: ActionTarget): Promise<string> {
  return await target.evaluate(() => location.pathname);
}

export async function waitForText(
  target: ActionTarget,
  selector: string,
  expected: string | RegExp,
  opts?: { timeoutMs?: number },
): Promise<void> {
  const matcher = typeof expected === "string"
    ? { kind: "includes" as const, value: expected }
    : {
      kind: "regex" as const,
      source: expected.source,
      flags: expected.flags,
    };
  await target.waitForFunction(
    ({
      selector,
      matcher,
    }: {
      selector: string;
      matcher:
        | { kind: "includes"; value: string }
        | { kind: "regex"; source: string; flags: string };
    }) => {
      const el = document.querySelector(selector);
      const text = (el?.textContent || "").trim();
      if (matcher.kind === "includes") {
        return text.includes(matcher.value);
      }
      return new RegExp(matcher.source, matcher.flags).test(text);
    },
    { selector, matcher },
    { timeout: opts?.timeoutMs ?? 8_000 },
  );
}

export async function graphql(
  target: ActionTarget,
  query: string,
  variables?: Record<string, unknown>,
): Promise<unknown> {
  return await target.evaluate(
    async ({ query, variables }) => {
      const response = await fetch("/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables }),
      });
      return await response.json();
    },
    { query, variables: variables ?? null },
  );
}

export async function click(
  target: ActionTarget,
  selector: string,
): Promise<void> {
  const attempt = async () => {
    const locator = target.locator(selector);
    await locator.waitFor({
      timeout: 15_000,
      state: "visible",
    });
    try {
      await locator.click({
        timeout: 15_000,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        !/outside of the viewport|intercepts pointer events/i.test(message)
      ) {
        throw error;
      }
      const clicked = await locator.evaluate((element) => {
        if (element instanceof HTMLElement) {
          element.scrollIntoView({ block: "center", inline: "center" });
        }
        if (
          element instanceof HTMLButtonElement ||
          element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement ||
          element instanceof HTMLSelectElement
        ) {
          if (element.disabled) return false;
        }
        element.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            composed: true,
          }),
        );
        return true;
      });
      if (!clicked) {
        throw error;
      }
    }
  };
  try {
    await attempt();
  } catch (error) {
    if (!isTransientActionError(error)) throw error;
    await wait(400);
    await attempt();
  }
}

export async function waitForVisible(
  target: ActionTarget,
  selector: string,
  opts?: { timeoutMs?: number },
): Promise<void> {
  await target.waitForSelector(selector, {
    timeout: opts?.timeoutMs ?? 8_000,
    state: "visible",
  });
}

export async function typeInto(
  target: ActionTarget,
  selector: string,
  text: string,
  opts?: { clear?: boolean },
): Promise<void> {
  const attempt = async () => {
    await target.waitForSelector(selector, {
      timeout: 15_000,
      state: "visible",
    });
    if (opts?.clear) {
      await target.evaluate((sel) => {
        const el = document.querySelector<
          HTMLInputElement | HTMLTextAreaElement
        >(sel);
        if (el) el.value = "";
      }, selector);
    }
    await target.type(selector, text);
  };
  try {
    await attempt();
  } catch (error) {
    if (!isTransientActionError(error)) throw error;
    await wait(400);
    await attempt();
  }
}

export async function selectText(
  target: ActionTarget,
  selector: string,
  opts?: { text?: string; occurrence?: number },
): Promise<string> {
  await waitForVisible(target, selector, { timeoutMs: 15_000 });
  const selectionText = await target.evaluate(
    ({ selector, text, occurrence }) => {
      const root = document.querySelector(selector);
      if (!(root instanceof HTMLElement)) {
        throw new Error(`Unable to find text selection root: ${selector}`);
      }

      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const textNodes: Array<Text> = [];
      let fullText = "";
      let currentNode = walker.nextNode();
      while (currentNode) {
        if (currentNode instanceof Text && currentNode.data.length > 0) {
          textNodes.push(currentNode);
          fullText += currentNode.data;
        }
        currentNode = walker.nextNode();
      }

      if (textNodes.length === 0 || fullText.trim().length === 0) {
        throw new Error(`No selectable text found in: ${selector}`);
      }

      const targetText = text ?? fullText.trim();
      const targetOccurrence = Math.max(0, occurrence ?? 0);
      let startOffset = -1;
      let searchFrom = 0;
      for (let i = 0; i <= targetOccurrence; i++) {
        startOffset = fullText.indexOf(targetText, searchFrom);
        if (startOffset === -1) {
          throw new Error(
            `Unable to find selection text in ${selector}: ${targetText}`,
          );
        }
        searchFrom = startOffset + targetText.length;
      }
      const endOffset = startOffset + targetText.length;

      const locateBoundary = (globalOffset: number) => {
        let traversed = 0;
        for (const node of textNodes) {
          const nextTraversed = traversed + node.data.length;
          if (globalOffset <= nextTraversed) {
            return {
              node,
              offset: globalOffset - traversed,
            };
          }
          traversed = nextTraversed;
        }
        return {
          node: textNodes[textNodes.length - 1],
          offset: textNodes[textNodes.length - 1].data.length,
        };
      };

      const start = locateBoundary(startOffset);
      const end = locateBoundary(endOffset);
      const range = document.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);

      const selection = globalThis.getSelection?.() ?? null;
      if (!selection) {
        throw new Error("window.getSelection() is unavailable");
      }
      selection.removeAllRanges();
      selection.addRange(range);

      root.scrollIntoView({ block: "center", inline: "nearest" });
      root.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          cancelable: true,
          composed: true,
        }),
      );

      return selection.toString().trim();
    },
    {
      selector,
      text: opts?.text ?? null,
      occurrence: opts?.occurrence ?? 0,
    },
  );
  if (selectionText.length === 0) {
    throw new Error(`Text selection did not produce a value for ${selector}`);
  }
  return selectionText;
}

export async function scrollTo(
  target: ActionTarget,
  selector: string,
  opts: { top?: number; left?: number },
): Promise<void> {
  await target.evaluate(
    ({ selector, top, left }) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) {
        throw new Error(`Unable to find scroll target: ${selector}`);
      }
      element.scrollTo({
        top: top ?? element.scrollTop,
        left: left ?? element.scrollLeft,
        behavior: "instant",
      });
    },
    {
      selector,
      top: opts.top ?? null,
      left: opts.left ?? null,
    },
  );
}

export async function exists(
  target: ActionTarget,
  selector: string,
): Promise<boolean> {
  const handle = await target.$(selector).catch(() => null);
  const ok = Boolean(handle);
  await handle?.dispose();
  return ok;
}

export async function text(
  target: ActionTarget,
  selector: string,
): Promise<string> {
  try {
    const handle = await target.$(selector);
    if (!handle) return "";
    const text = await target.evaluate(
      (el) => (el.textContent || "").trim(),
      handle,
    );
    await handle.dispose();
    return text ?? "";
  } catch {
    return "";
  }
}

export async function value(
  target: ActionTarget,
  selector: string,
): Promise<string> {
  try {
    const handle = await target.$(selector);
    if (!handle) return "";
    const result = await target.evaluate((el) => {
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement
      ) {
        return el.value;
      }
      return "";
    }, handle);
    await handle.dispose();
    return result ?? "";
  } catch {
    return "";
  }
}

export async function collectNavigationDiagnostics(
  page: Page,
  target: ActionTarget,
  targetUrl: string,
  activeRequests: ReadonlyMap<PlaywrightRequest, string>,
  screenshot: (label: string) => Promise<string>,
): Promise<string> {
  const location = target.url();
  const shellUrl = page.url();
  const pageState = await target.evaluate(() => ({
    href: globalThis.location.href,
    readyState: document.readyState,
    title: document.title,
  })).catch(() => null);
  const activeRequestList = [...activeRequests.values()]
    .slice(0, 8)
    .join(" | ");
  const screenshotPath = await screenshot("navigation-timeout");
  return [
    `target_url=${targetUrl}`,
    `page_url=${location || "unknown"}`,
    `shell_url=${shellUrl || "unknown"}`,
    `document_href=${pageState?.href ?? "unknown"}`,
    `ready_state=${pageState?.readyState ?? "unknown"}`,
    `title=${pageState?.title ?? "unknown"}`,
    `active_requests=${activeRequestList || "none"}`,
    `screenshot=${screenshotPath || "unavailable"}`,
  ].join("\n");
}

export async function safeGoto(
  page: Page,
  target: ActionTarget,
  url: string,
  activeRequests: ReadonlyMap<PlaywrightRequest, string>,
  screenshot: (label: string) => Promise<string>,
): Promise<void> {
  try {
    await target.goto(url.replace(/\/+$/g, ""), {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
  } catch (error) {
    const diagnostics = await collectNavigationDiagnostics(
      page,
      target,
      url,
      activeRequests,
      screenshot,
    );
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}\n${diagnostics}`);
  }
}
