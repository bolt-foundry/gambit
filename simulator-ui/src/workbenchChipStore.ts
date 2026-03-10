import type { WorkbenchSelectedContextChip } from "./workbenchContext.ts";
import { parseWorkbenchSelectedContextChips } from "./workbenchContext.ts";

type WorkbenchChipStartUpdate = (
  updater: (args: {
    updatableData: {
      workbenchSelectedContextChips: unknown;
    };
  }) => void,
) => void;

const WORKBENCH_CHIP_STORAGE_KEY_PREFIX =
  "gambit:workbench-selected-context-chips:";

function getWorkbenchChipStorageKey(workspaceId: string | null | undefined):
  | string
  | null {
  if (typeof workspaceId !== "string") return null;
  const trimmed = workspaceId.trim();
  return trimmed.length > 0
    ? `${WORKBENCH_CHIP_STORAGE_KEY_PREFIX}${trimmed}`
    : null;
}

export function readPersistedWorkbenchSelectedContextChips(
  workspaceId: string | null | undefined,
): Array<WorkbenchSelectedContextChip> {
  if (typeof globalThis === "undefined") return [];
  const storageKey = getWorkbenchChipStorageKey(workspaceId);
  if (!storageKey) return [];
  try {
    const raw = globalThis.localStorage.getItem(storageKey);
    if (!raw) return [];
    return parseWorkbenchSelectedContextChips(JSON.parse(raw));
  } catch {
    return [];
  }
}

function persistWorkbenchSelectedContextChips(
  workspaceId: string | null | undefined,
  chips: Array<WorkbenchSelectedContextChip>,
): void {
  if (typeof globalThis === "undefined") return;
  const storageKey = getWorkbenchChipStorageKey(workspaceId);
  if (!storageKey) return;
  try {
    if (chips.length === 0) {
      globalThis.localStorage.removeItem(storageKey);
      return;
    }
    globalThis.localStorage.setItem(storageKey, JSON.stringify(chips));
  } catch {
    // ignore storage failures
  }
}

export function resolveWorkbenchSelectedContextChips(
  workspaceId: string | null | undefined,
  value: unknown,
): Array<WorkbenchSelectedContextChip> {
  const parsed = parseWorkbenchSelectedContextChips(value);
  if (parsed.length > 0) return parsed;
  return readPersistedWorkbenchSelectedContextChips(workspaceId);
}

export function replaceWorkbenchSelectedContextChips(
  startUpdate: WorkbenchChipStartUpdate | undefined,
  next: Array<WorkbenchSelectedContextChip>,
  workspaceId?: string | null,
): void {
  persistWorkbenchSelectedContextChips(workspaceId, next);
  startUpdate?.(({ updatableData }) => {
    updatableData.workbenchSelectedContextChips = next;
  });
}

export function mergeWorkbenchSelectedContextChip(
  base: Array<WorkbenchSelectedContextChip>,
  chip: WorkbenchSelectedContextChip,
): Array<WorkbenchSelectedContextChip> {
  const existingIndex = base.findIndex((entry) => entry.chipId === chip.chipId);
  if (existingIndex < 0) {
    return [...base, chip];
  }
  const next = [...base];
  next[existingIndex] = {
    ...next[existingIndex],
    ...chip,
    enabled: chip.enabled,
  };
  return next;
}
