type PageHandle = {
  evaluate<T>(fn: (payload: T) => void, payload: T): Promise<void>;
  evaluate(fn: () => void): Promise<void>;
};

type DemoTargetHandle = {
  locator(selector: string): {
    first(): { scrollIntoViewIfNeeded(): Promise<void> };
  };
};

type DemoShellContext = {
  page: PageHandle;
  useIframeShell: boolean;
  demoTarget?: DemoTargetHandle;
};

const CLEAR_HIGHLIGHT_SELECTOR = '[data-test="__demo-clear__"]';

async function runShell(
  ctx: DemoShellContext,
  action: () => void | Promise<void>,
): Promise<void> {
  if (!ctx.useIframeShell) return;
  await action();
}

export async function resetZoom(
  ctx: DemoShellContext,
  durationMs = 0,
): Promise<void> {
  await runShell(
    ctx,
    () =>
      ctx.page.evaluate((payload: { durationMs: number }) => {
        (window as {
          gambitDemo?: { resetZoom?: (opts?: { durationMs?: number }) => void };
        }).gambitDemo?.resetZoom?.({ durationMs: payload.durationMs });
      }, { durationMs }),
  );
}

export async function zoomTo(
  ctx: DemoShellContext,
  selector: string,
  opts: { padding?: number; durationMs?: number } = {},
): Promise<void> {
  await runShell(ctx, () =>
    ctx.page.evaluate((
      { selector, opts }: {
        selector: string;
        opts: { padding?: number; durationMs?: number };
      },
    ) => {
      (window as {
        gambitDemo?: {
          zoomTo?: (
            selector: string,
            opts?: { padding?: number; durationMs?: number },
          ) => void;
        };
      }).gambitDemo?.zoomTo?.(selector, opts);
    }, { selector, opts }));
}

export async function scrollTo(
  ctx: DemoShellContext,
  selector: string,
): Promise<void> {
  await runShell(
    ctx,
    () =>
      ctx.page.evaluate(({ selector }: { selector: string }) => {
        (window as {
          gambitDemo?: { scrollTo?: (selector: string) => void };
        }).gambitDemo?.scrollTo?.(selector);
      }, { selector }),
  );
  if (!ctx.demoTarget) return;
  await ctx.demoTarget.locator(selector).first().scrollIntoViewIfNeeded().catch(
    () => {},
  );
}

export async function showSubtitle(
  ctx: DemoShellContext,
  text: string,
  durationMs = 2600,
): Promise<void> {
  await runShell(ctx, () =>
    ctx.page.evaluate((
      { text, durationMs }: { text: string; durationMs: number },
    ) => {
      (window as {
        gambitDemo?: {
          subtitles?: {
            show?: (msg: string, opts?: { forMs?: number }) => void;
          };
        };
      }).gambitDemo?.subtitles?.show?.(text, { forMs: durationMs });
    }, { text, durationMs }));
}

export async function hideSubtitle(ctx: DemoShellContext): Promise<void> {
  await runShell(ctx, () =>
    ctx.page.evaluate(() => {
      (window as {
        gambitDemo?: { subtitles?: { hide?: () => void } };
      }).gambitDemo?.subtitles?.hide?.();
    }));
}

export async function highlight(
  ctx: DemoShellContext,
  selector?: string | null,
): Promise<void> {
  await runShell(
    ctx,
    () =>
      ctx.page.evaluate(({ target }: { target: string }) => {
        (window as {
          gambitDemo?: { highlight?: (selector: string) => void };
        }).gambitDemo?.highlight?.(target);
      }, { target: selector ?? CLEAR_HIGHLIGHT_SELECTOR }),
  );
}

export async function clearHighlight(ctx: DemoShellContext): Promise<void> {
  await highlight(ctx);
}
