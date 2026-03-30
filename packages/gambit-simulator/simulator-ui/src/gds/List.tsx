import React from "react";
import { classNames } from "../utils.ts";

export default function List(
  props: React.HTMLAttributes<HTMLDivElement>,
) {
  const { className, children, ...rest } = props;
  return (
    <div className={classNames("gds-list", className)} {...rest}>
      {children}
    </div>
  );
}
