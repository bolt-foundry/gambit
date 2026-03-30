import React from "react";
import { classNames } from "../utils.ts";

export type ButtonVariant =
  | "primary"
  | "primary-deemph"
  | "secondary"
  | "ghost"
  | "danger"
  | "ghost-danger";
export type ButtonSize = "large" | "medium" | "small";

type ButtonProps =
  & {
    variant?: ButtonVariant;
    size?: ButtonSize;
    href?: string;
    tab?: boolean;
  }
  & React.ButtonHTMLAttributes<HTMLButtonElement>
  & React.AnchorHTMLAttributes<HTMLAnchorElement>;

export default function Button(props: ButtonProps) {
  const {
    variant = "secondary",
    size = "medium",
    className,
    type,
    href,
    tab = false,
    ...rest
  } = props;

  const classes = classNames(
    "gds-button",
    `gds-button--${variant}`,
    `gds-button--size-${size}`,
    tab && "gds-button--tab",
    className,
  );

  if (href) {
    return <a className={classes} href={href} {...rest} />;
  }

  return <button type={type ?? "button"} className={classes} {...rest} />;
}
