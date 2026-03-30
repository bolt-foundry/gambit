import React from "react";
import { classNames } from "../utils.ts";

type PageGridProps<T extends React.ElementType = "div"> = {
  as?: T;
  className?: string;
  columns?: string;
  children?: React.ReactNode;
} & Omit<React.ComponentPropsWithoutRef<T>, "as" | "className" | "children">;

export default function PageGrid<T extends React.ElementType = "div">(
  props: PageGridProps<T>,
) {
  const { as, className, columns, children, ...rest } = props;
  const Component = (as ?? "div") as React.ElementType;
  return (
    <Component
      className={classNames("page-grid", className)}
      style={columns ? { gridTemplateColumns: columns } : undefined}
      {...rest}
    >
      {children}
    </Component>
  );
}
