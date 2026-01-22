import React, { forwardRef } from "react";
import { classNames } from "../utils.ts";

type PanelProps = React.HTMLAttributes<HTMLElement> & {
  as?: React.ElementType;
};

const Panel = forwardRef<HTMLElement, PanelProps>((props, ref) => {
  const { as: Component = "div", className, children, ...rest } = props;
  return (
    <Component className={classNames("panel", className)} ref={ref} {...rest}>
      {children}
    </Component>
  );
});

Panel.displayName = "Panel";

export default Panel;
