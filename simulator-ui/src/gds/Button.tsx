import React from "react";
import { classNames } from "../utils.ts";

export type ButtonVariant =
  | "primary"
  | "primary-deemph"
  | "secondary"
  | "ghost"
  | "danger";

export default function Button(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant;
  },
) {
  const { variant = "secondary", className, type, ...rest } = props;

  return (
    <button
      type={type ?? "button"}
      className={classNames("gds-button", `gds-button--${variant}`, className)}
      {...rest}
    />
  );
}
