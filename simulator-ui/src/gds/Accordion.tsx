import React, { useMemo, useState } from "react";
import { classNames } from "../utils.ts";
import Icon from "./Icon.tsx";

export type AccordionItem = {
  id: string;
  title: React.ReactNode;
  content: React.ReactNode;
  defaultOpen?: boolean;
  disabled?: boolean;
  headerActions?: React.ReactNode;
  itemClassName?: string;
  contentClassName?: string;
};

type AccordionProps = {
  items: AccordionItem[];
  allowMultiple?: boolean;
  className?: string;
};

export default function Accordion(
  { items, allowMultiple = false, className }: AccordionProps,
) {
  const defaultOpenIds = useMemo(
    () =>
      new Set(items.filter((item) => item.defaultOpen).map((item) => item.id)),
    [items],
  );
  const [openIds, setOpenIds] = useState<Set<string>>(defaultOpenIds);

  const toggleItem = (id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      const isOpen = next.has(id);
      if (allowMultiple) {
        if (isOpen) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      }
      if (isOpen) {
        next.clear();
      } else {
        next.clear();
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div className={classNames("gds-accordion", className)}>
      {items.map((item) => {
        const isOpen = openIds.has(item.id);
        const contentId = `${item.id}-content`;
        return (
          <div
            key={item.id}
            className={classNames(
              "gds-accordion-item",
              item.itemClassName,
              isOpen && "open",
            )}
          >
            <div className="gds-accordion-header">
              <button
                type="button"
                className="gds-accordion-trigger"
                aria-expanded={isOpen}
                aria-controls={contentId}
                disabled={item.disabled}
                onClick={() => toggleItem(item.id)}
              >
                <span className="gds-accordion-title">{item.title}</span>
              </button>
              {item.headerActions
                ? (
                  <span
                    className={classNames(
                      "gds-accordion-actions",
                      item.disabled && "gds-accordion-actions--disabled",
                    )}
                  >
                    {item.headerActions}
                  </span>
                )
                : null}
              <button
                type="button"
                className="gds-accordion-trigger gds-accordion-trigger--icon"
                aria-expanded={isOpen}
                aria-controls={contentId}
                disabled={item.disabled}
                onClick={() => toggleItem(item.id)}
              >
                <span className="calibrate-run-toggle-icon gds-accordion-chevron">
                  <Icon name="chevronDown" size={10} />
                </span>
              </button>
            </div>
            <div
              id={contentId}
              className={classNames(
                "gds-accordion-content",
                item.contentClassName,
              )}
              hidden={!isOpen}
            >
              <div className="gds-accordion-content-inner">
                {item.content}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
