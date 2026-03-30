import React from "react";
import { classNames } from "../utils.ts";

export type CalloutVariant = "muted" | "emphasis" | "danger";

type CalloutProps = React.HTMLAttributes<HTMLDivElement> & {
  variant?: CalloutVariant;
  title?: React.ReactNode;
  actions?: React.ReactNode;
};

export default function Callout(props: CalloutProps) {
  const {
    variant = "muted",
    title,
    actions,
    className,
    children,
    ...rest
  } = props;
  const hasStructuredContent = title !== undefined || actions !== undefined;

  return (
    <div
      className={classNames("callout", `callout--${variant}`, className)}
      {...rest}
    >
      {hasStructuredContent
        ? (
          <div className="callout-main">
            <div className="callout-body">
              {title !== undefined && (
                <div className="callout-title">{title}</div>
              )}
              {children !== undefined &&
                children !== null &&
                <div className="callout-message">{children}</div>}
            </div>
            {actions !== undefined && actions !== null && (
              <div className="callout-actions">{actions}</div>
            )}
          </div>
        )
        : children}
    </div>
  );
}
