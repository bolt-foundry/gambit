import type { Frame, Page } from "playwright-core";

export type BrowserTestRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  left: number;
  right: number;
  bottom: number;
};

export type BrowserTestScrollMetrics = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
};

export async function readElementRect(
  page: Page | Frame,
  selector: string,
): Promise<BrowserTestRect | null> {
  try {
    const handle = await page.$(selector);
    if (!handle) return null;
    const rect = await page.evaluate((el) => {
      const bounds = el.getBoundingClientRect();
      return {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        top: bounds.top,
        left: bounds.left,
        right: bounds.right,
        bottom: bounds.bottom,
      };
    }, handle);
    await handle.dispose();
    return rect;
  } catch {
    return null;
  }
}

export async function readElementScrollMetrics(
  page: Page | Frame,
  selector: string,
): Promise<BrowserTestScrollMetrics | null> {
  try {
    const handle = await page.$(selector);
    if (!handle) return null;
    const metrics = await page.evaluate((el) => {
      if (!(el instanceof HTMLElement)) return null;
      return {
        scrollTop: el.scrollTop,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
      };
    }, handle);
    await handle.dispose();
    return metrics;
  } catch {
    return null;
  }
}
