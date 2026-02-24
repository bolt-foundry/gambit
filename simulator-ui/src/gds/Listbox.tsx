import React, {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import Icon from "./Icon.tsx";
import ScrollingText from "./ScrollingText.tsx";

export type ListboxOption = {
  kind?: "option";
  value: string;
  label: string;
  triggerLabel?: string;
  triggerMeta?: string | null;
  meta?: string | null;
  disabled?: boolean;
} | {
  kind: "header";
  label: string;
} | {
  kind: "separator";
};

export type ListboxProps = {
  value?: string | null;
  options: ListboxOption[];
  placeholder?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  label?: string;
  labelClassName?: string;
  id?: string;
  popoverMatchTriggerWidth?: boolean;
  popoverMinWidth?: number;
  popoverAlign?: "left" | "right";
  size?: "default" | "small";
};

export default function Listbox(props: ListboxProps) {
  const {
    value,
    options,
    placeholder = "Select",
    disabled = false,
    onChange,
    label,
    labelClassName,
    id,
    popoverMatchTriggerWidth = true,
    popoverMinWidth,
    popoverAlign = "left",
    size = "default",
  } = props;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties | null>(
    null,
  );
  const autoId = useId();
  const controlId = id ?? `listbox-${autoId}`;
  const labelId = `${controlId}-label`;
  const labelClasses = labelClassName
    ? `gds-listbox-field-label ${labelClassName}`
    : "gds-listbox-field-label";
  const selected = useMemo(() => {
    for (const option of options) {
      if (option.kind === "header" || option.kind === "separator") continue;
      if (option.value === value) return option;
    }
    return null;
  }, [options, value]);
  const selectedTriggerMeta = useMemo(() => {
    if (!selected) return null;
    if ("triggerMeta" in selected) return selected.triggerMeta ?? null;
    return selected.meta ?? null;
  }, [selected]);

  const updatePopover = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const style: React.CSSProperties = {
      position: "fixed",
      top: rect.bottom + 6,
    };
    if (popoverMatchTriggerWidth) {
      style.width = rect.width;
    } else if (
      typeof popoverMinWidth === "number" && Number.isFinite(popoverMinWidth)
    ) {
      style.minWidth = popoverMinWidth;
    }
    if (popoverAlign === "right") {
      style.left = popoverMatchTriggerWidth
        ? rect.right - rect.width
        : rect.right;
      if (!popoverMatchTriggerWidth) {
        style.transform = "translateX(-100%)";
      }
    } else {
      style.left = rect.left;
    }
    setPopoverStyle(style);
  }, [popoverAlign, popoverMatchTriggerWidth, popoverMinWidth]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePopover();
  }, [open, updatePopover]);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      const isInRoot = rootRef.current &&
        target &&
        rootRef.current.contains(target);
      const isInPopover = popoverRef.current &&
        target &&
        popoverRef.current.contains(target);
      if (!isInRoot && !isInPopover) {
        setOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
    };
    const handleReposition = () => updatePopover();
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleKey);
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
  }, [open, updatePopover]);

  const rootClassName = size === "small"
    ? "gds-listbox gds-listbox--size-small"
    : "gds-listbox";

  return (
    <div className={rootClassName} ref={rootRef}>
      {label && (
        <label className={labelClasses} htmlFor={controlId} id={labelId}>
          {label}
        </label>
      )}
      <button
        id={controlId}
        type="button"
        className="gds-listbox-trigger"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-labelledby={label ? labelId : undefined}
        aria-expanded={open}
        disabled={disabled}
        ref={triggerRef}
      >
        <ScrollingText
          text={selected?.triggerLabel ?? selected?.label ?? placeholder}
          className="gds-listbox-label"
        />
        {selectedTriggerMeta && (
          <ScrollingText
            text={selectedTriggerMeta}
            className="gds-listbox-meta"
          />
        )}
        <span className="gds-listbox-caret" aria-hidden="true">
          <Icon name="chevronDown" size={8} />
        </span>
      </button>
      {open && popoverStyle &&
        createPortal(
          <div
            className="gds-listbox-popover"
            role="listbox"
            style={popoverStyle}
            ref={popoverRef}
          >
            {options.map((option, index) => {
              if (option.kind === "separator") {
                return (
                  <div
                    key={`separator-${index}`}
                    className="gds-listbox-separator"
                    role="separator"
                  />
                );
              }
              if (option.kind === "header") {
                return (
                  <div
                    key={`header-${index}`}
                    className="gds-listbox-header"
                  >
                    {option.label}
                  </div>
                );
              }
              const isSelected = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className="gds-listbox-option"
                  disabled={option.disabled}
                  onClick={() => {
                    if (option.disabled) return;
                    setOpen(false);
                    onChange(option.value);
                  }}
                >
                  <ScrollingText
                    text={option.label}
                    className="gds-listbox-option-label"
                  />
                  {option.meta && (
                    <ScrollingText
                      text={option.meta}
                      className="gds-listbox-option-meta"
                    />
                  )}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}
