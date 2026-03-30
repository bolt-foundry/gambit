import React from "react";
import { classNames } from "../utils.ts";

export default function PageShell(props: {
  className?: string;
  children: React.ReactNode;
}) {
  const { className, children } = props;
  return <div className={classNames("app-shell", className)}>{children}</div>;
}
