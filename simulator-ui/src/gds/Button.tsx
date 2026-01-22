import React from "react";
import { classNames } from "../utils.ts";

export type ButtonVariant = "primary" | "secondary" | "ghost";

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
