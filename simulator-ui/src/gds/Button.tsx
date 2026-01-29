import React from "react";
import { classNames } from "../utils.ts";

export type ButtonVariant =
  | "primary"
  | "primary-deemph"
  | "secondary"
  | "ghost"
  | "danger"
  | "ghost-danger";
export type ButtonSize = "medium" | "small";

export default function Button(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant;
    size?: ButtonSize;
  },
) {
  const {
    variant = "secondary",
    size = "medium",
    className,
    type,
    ...rest
  } = props;

  return (
    <button
      type={type ?? "button"}
      className={classNames(
        "gds-button",
        `gds-button--${variant}`,
        `gds-button--size-${size}`,
        className,
      )}
      {...rest}
    />
  );
}
