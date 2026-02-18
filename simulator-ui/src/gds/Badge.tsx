import React from "react";
import Tooltip from "./Tooltip.tsx";
import { classNames } from "../utils.ts";

export type BadgeVariant =
  | "idle"
  | "running"
  | "completed"
  | "error"
  | "canceled"
  | "ghost";

const STATUS_VARIANT_MAP: Record<string, BadgeVariant> = {
  idle: "idle",
  running: "running",
  completed: "completed",
  error: "error",
  canceled: "canceled",
  pending: "running",
  finished: "completed",
};

export default function Badge(
  props: React.HTMLAttributes<HTMLSpanElement> & {
    variant?: BadgeVariant;
    title?: string;
    status?: string;
    tooltip?: React.ReactNode;
  },
) {
  const { variant, status, tooltip, className, children, ...rest } = props;
  const statusText = status ??
    (typeof children === "string" ? children : undefined);
  const inferredVariant = statusText
    ? STATUS_VARIANT_MAP[statusText.trim().toLowerCase()]
    : undefined;

  const badgeElement = (
    <span
      className={classNames(
        "badge",
        (variant ?? inferredVariant)
          ? `badge--${variant ?? inferredVariant}`
          : undefined,
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );

  if (tooltip === undefined || tooltip === null || tooltip === false) {
    return badgeElement;
  }

  return <Tooltip content={tooltip}>{badgeElement}</Tooltip>;
}
