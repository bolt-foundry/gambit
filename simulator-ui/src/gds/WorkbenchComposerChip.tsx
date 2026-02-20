import React from "react";
import { classNames, getScoreClass } from "../utils.ts";
import Icon from "./Icon.tsx";
import Tooltip from "./Tooltip.tsx";

type WorkbenchComposerChipContext =
  | {
    source: "scenario_run_error";
    error: string;
  }
  | {
    source: "message_rating";
    score: number;
    reason?: string;
  }
  | {
    source: "grading_flag";
    message: string;
    score?: number;
  };

function formatScoreLabel(score: number): string {
  return score > 0 ? `+${score}` : String(score);
}

function formatContextLabel(context: WorkbenchComposerChipContext): string {
  if (context.source === "scenario_run_error") return "Error";
  if (context.source === "message_rating") {
    return formatScoreLabel(context.score);
  }
  return "Flag";
}

function formatContextTooltip(context: WorkbenchComposerChipContext): string {
  if (context.source === "scenario_run_error") return context.error;
  if (context.source === "message_rating") {
    return context.reason?.trim() ||
      `Rating ${formatScoreLabel(context.score)}`;
  }
  return context.message;
}

export default function WorkbenchComposerChip(
  props:
    & Omit<React.HTMLAttributes<HTMLDivElement>, "children">
    & (
      {
        context: WorkbenchComposerChipContext;
        enabled: boolean;
        onEnabledChange: (next: boolean) => void;
        onRemove?: () => void;
        testId?: string;
      } | {
        context: WorkbenchComposerChipContext;
        enabled?: boolean;
        onEnabledChange?: (next: boolean) => void;
        onRemove?: () => void;
        testId?: string;
      }
    ),
) {
  const {
    className,
    context,
    enabled,
    onEnabledChange,
    onRemove,
    testId,
    ...rest
  } = props;
  const label = formatContextLabel(context);
  const tooltip = formatContextTooltip(context);
  const score = "score" in context ? context.score : undefined;
  const badgeClassName = classNames(
    "workbench-context-chip",
    context.source === "scenario_run_error" && "workbench-context-chip--error",
    context.source === "grading_flag" && "workbench-context-chip--flag",
    context.source === "grading_flag" && typeof score === "number" &&
      getScoreClass(score),
    context.source === "message_rating" && "workbench-context-chip--rating",
    context.source === "message_rating" && typeof score === "number" &&
      getScoreClass(score),
  );
  const testIds = context.source === "scenario_run_error"
    ? {
      badge: "workbench-error-chip",
      toggle: "workbench-error-chip-toggle",
      remove: "workbench-error-chip-remove",
    }
    : null;
  const showToggle = typeof enabled === "boolean" &&
    typeof onEnabledChange === "function";
  const showRemove = typeof onRemove === "function";
  const isPassive = !showToggle && !showRemove;
  const content = context.source === "grading_flag"
    ? <Icon name="flag" size={10} />
    : label;

  if (isPassive) {
    return (
      <Tooltip content={tooltip}>
        <span
          className={classNames(badgeClassName, className)}
          data-testid={testId ?? testIds?.badge}
          {...rest}
        >
          {content}
        </span>
      </Tooltip>
    );
  }

  return (
    <div className={classNames("workbench-composer-chip", className)} {...rest}>
      <Tooltip content={tooltip}>
        <span className={badgeClassName} data-testid={testId ?? testIds?.badge}>
          {content}
        </span>
      </Tooltip>
      {showToggle && (
        <label className="workbench-composer-chip-toggle">
          <input
            type="checkbox"
            checked={enabled}
            aria-label={`${label} context ${enabled ? "on" : "off"}`}
            onChange={(event) => onEnabledChange(event.target.checked)}
            data-testid={testIds?.toggle}
          />
        </label>
      )}
      {showRemove && (
        <button
          type="button"
          className="link-button workbench-composer-chip-remove"
          onClick={onRemove}
          aria-label={`Remove ${label} context`}
          data-testid={testIds?.remove}
        >
          <Icon name="times" size={8} />
        </button>
      )}
    </div>
  );
}
