import React from "react";
import { classNames } from "../utils.ts";

export type BadgeVariant =
  | "idle"
  | "running"
  | "completed"
  | "error"
  | "canceled";

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
  },
) {
  const { variant, status, className, children, ...rest } = props;
  const statusText = status ??
    (typeof children === "string" ? children : undefined);
  const inferredVariant = statusText
    ? STATUS_VARIANT_MAP[statusText.trim().toLowerCase()]
    : undefined;

  return (
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
}
