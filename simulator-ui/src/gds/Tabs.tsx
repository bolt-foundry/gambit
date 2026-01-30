import React from "react";
import Button from "./Button.tsx";
import { classNames } from "../utils.ts";

type TabItem = {
  id: string;
  label: React.ReactNode;
  disabled?: boolean;
  testId?: string;
};

type TabsProps = {
  tabs: TabItem[];
  activeId: string;
  onChange: (id: string) => void;
  size?: "small" | "medium" | "large";
  className?: string;
  style?: React.CSSProperties;
  tabClassName?: string;
};

export default function Tabs({
  tabs,
  activeId,
  onChange,
  size = "medium",
  className,
  style,
  tabClassName,
}: TabsProps) {
  return (
    <div
      className={classNames("tab-anchor-group", className)}
      role="tablist"
      style={style}
    >
      <span className="tab-anchor-indicator" aria-hidden="true" />
      {tabs.map((tab) => {
        const isActive = tab.id === activeId;
        return (
          <Button
            key={tab.id}
            tab
            size={size}
            variant={isActive ? "primary-deemph" : "ghost"}
            className={classNames(
              "tab-anchor",
              isActive && "tab-anchor--active",
              tabClassName,
            )}
            onClick={() => onChange(tab.id)}
            disabled={tab.disabled}
            data-testid={tab.testId}
            role="tab"
            aria-selected={isActive}
          >
            {tab.label}
          </Button>
        );
      })}
    </div>
  );
}
