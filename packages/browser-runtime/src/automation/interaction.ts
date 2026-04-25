import { shouldUseSmoothType } from "@bolt-foundry/browser-runtime/src/config.ts";

type LocatorHandle = {
  boundingBox(): Promise<
    { x: number; y: number; width: number; height: number } | null
  >;
  waitFor(opts?: { timeout?: number }): Promise<void>;
  evaluate<T>(fn: (el: Element) => T): Promise<T>;
  selectOption(opts: { label: string }): Promise<Array<string>>;
  click(): Promise<void>;
  fill(value: string): Promise<void>;
  type(text: string, opts?: { delay?: number }): Promise<void>;
};

type PageHandle = {
  mouse: { move(x: number, y: number): Promise<void> };
};

export async function moveMouseToLocator(
  page: PageHandle,
  locator: LocatorHandle,
): Promise<void> {
  const box = await locator.boundingBox();
  if (!box) return;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
}

export async function typeIntoLocator(
  locator: LocatorHandle,
  text: string,
  opts: { clear?: boolean; delayMs?: number; timeoutMs?: number } = {},
): Promise<void> {
  await locator.waitFor({ timeout: opts.timeoutMs ?? 10_000 });
  const tag = await locator.evaluate((el) => el.tagName.toLowerCase());
  if (tag === "select") {
    await locator.selectOption({ label: text });
    return;
  }
  await locator.click();
  if (opts.clear !== false) {
    await locator.fill("");
  }
  await locator.type(text, {
    delay: opts.delayMs ?? (shouldUseSmoothType() ? 20 : 0),
  });
}
