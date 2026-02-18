import React from "react";
import Button from "./Button.tsx";
import { classNames } from "../utils.ts";

type TabItem = {
  id: string;
  label: React.ReactNode;
  disabled?: boolean;
  testId?: string;
  href?: string;
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
        const handleClick = (event: React.MouseEvent<HTMLElement>) => {
          if (tab.disabled) {
            event.preventDefault();
            return;
          }
          // Let modified clicks keep native anchor behavior (new tab/window).
          if (
            tab.href &&
            (event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey ||
              event.button !== 0)
          ) {
            return;
          }
          event.preventDefault();
          onChange(tab.id);
        };
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
            onClick={handleClick}
            disabled={tab.disabled}
            data-testid={tab.testId}
            role="tab"
            aria-selected={isActive}
            href={tab.href}
          >
            {tab.label}
          </Button>
        );
      })}
    </div>
  );
}
