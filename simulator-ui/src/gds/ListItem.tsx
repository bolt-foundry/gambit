import React from "react";
import { classNames } from "../utils.ts";

export default function ListItem(
  props: React.HTMLAttributes<HTMLDivElement> & {
    title?: React.ReactNode;
    description?: React.ReactNode;
    meta?: React.ReactNode;
  },
) {
  const { className, title, description, meta, children, ...rest } = props;

  return (
    <div className={classNames("gds-list-item", className)} {...rest}>
      {title && (
        <div className="gds-list-item-header">
          <div className="gds-list-item-title">{title}</div>
        </div>
      )}
      {description && (
        <div className="gds-list-item-description">{description}</div>
      )}
      {meta && <div className="gds-list-item-meta">{meta}</div>}
      {children}
    </div>
  );
}
