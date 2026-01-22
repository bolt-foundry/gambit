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

export type ListboxOption = {
  value: string;
  label: string;
  meta?: string | null;
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
  const selected = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value],
  );

  const updatePopover = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    setPopoverStyle({
      position: "fixed",
      top: rect.bottom + 6,
      left: rect.left,
      width: rect.width,
    });
  }, []);

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

  return (
    <div className="gds-listbox" ref={rootRef}>
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
        <span className="gds-listbox-label">
          {selected?.label ?? placeholder}
        </span>
        {selected?.meta && (
          <span className="gds-listbox-meta">{selected.meta}</span>
        )}
        <span className="gds-listbox-caret" aria-hidden="true">
          <svg
            width="8"
            height="5"
            viewBox="0 0 8 5"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M6.8648 1.05185L3.95833 3.95833C3.83482 4.08183 3.67838 4.13947 3.52194 4.13947C3.3655 4.13947 3.20906 4.08183 3.08556 3.95833L0.179082 1.05185C-0.059694 0.813073 -0.059694 0.417858 0.179082 0.179082C0.417858 -0.059694 0.813073 -0.059694 1.05185 0.179082L3.52194 2.64918L5.99204 0.179082C6.23081 -0.059694 6.62603 -0.059694 6.8648 0.179082C7.10358 0.417858 7.10358 0.804839 6.8648 1.05185Z"
              fill="currentColor"
            />
          </svg>
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
            {options.map((option) => {
              const isSelected = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className="gds-listbox-option"
                  onClick={() => {
                    setOpen(false);
                    onChange(option.value);
                  }}
                >
                  <span className="gds-listbox-option-label">
                    {option.label}
                  </span>
                  {option.meta && (
                    <span className="gds-listbox-option-meta">
                      {option.meta}
                    </span>
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
