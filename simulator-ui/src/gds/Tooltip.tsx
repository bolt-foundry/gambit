import React, {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { classNames } from "../utils.ts";

export type TooltipSide = "top" | "right" | "bottom" | "left";

type TooltipPosition = {
  top: number;
  left: number;
};

export type TooltipProps = {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: TooltipSide;
  offset?: number;
  disabled?: boolean;
  openDelayMs?: number;
  closeDelayMs?: number;
  className?: string;
  tooltipClassName?: string;
  id?: string;
};

export default function Tooltip(props: TooltipProps) {
  const {
    content,
    children,
    side = "top",
    offset = 8,
    disabled = false,
    openDelayMs = 120,
    closeDelayMs = 80,
    className,
    tooltipClassName,
    id,
  } = props;

  const canUseDom = typeof document !== "undefined" &&
    typeof window !== "undefined";
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<TooltipPosition | null>(null);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generatedId = useId();
  const tooltipId = id ?? `gds-tooltip-${generatedId}`;

  const clearOpenTimer = useCallback(() => {
    if (openTimerRef.current === null) return;
    clearTimeout(openTimerRef.current);
    openTimerRef.current = null;
  }, []);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current === null) return;
    clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }, []);

  const scheduleOpen = useCallback(() => {
    if (disabled || !content) return;
    clearCloseTimer();
    clearOpenTimer();
    openTimerRef.current = setTimeout(() => {
      setOpen(true);
      openTimerRef.current = null;
    }, Math.max(0, openDelayMs));
  }, [clearCloseTimer, clearOpenTimer, content, disabled, openDelayMs]);

  const scheduleClose = useCallback(() => {
    clearOpenTimer();
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      setOpen(false);
      closeTimerRef.current = null;
    }, Math.max(0, closeDelayMs));
  }, [clearCloseTimer, clearOpenTimer, closeDelayMs]);

  const closeNow = useCallback(() => {
    clearOpenTimer();
    clearCloseTimer();
    setOpen(false);
  }, [clearCloseTimer, clearOpenTimer]);

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    const tooltip = tooltipRef.current;
    if (!anchor || !tooltip || !canUseDom) return;

    const anchorRect = anchor.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const margin = 8;
    let nextTop = 0;
    let nextLeft = 0;

    if (side === "top") {
      nextTop = anchorRect.top - offset - tooltipRect.height;
      nextLeft = anchorRect.left + (anchorRect.width - tooltipRect.width) / 2;
    } else if (side === "right") {
      nextTop = anchorRect.top + (anchorRect.height - tooltipRect.height) / 2;
      nextLeft = anchorRect.right + offset;
    } else if (side === "bottom") {
      nextTop = anchorRect.bottom + offset;
      nextLeft = anchorRect.left + (anchorRect.width - tooltipRect.width) / 2;
    } else {
      nextTop = anchorRect.top + (anchorRect.height - tooltipRect.height) / 2;
      nextLeft = anchorRect.left - offset - tooltipRect.width;
    }

    const clampedLeft = Math.min(
      Math.max(margin, nextLeft),
      window.innerWidth - tooltipRect.width - margin,
    );
    const clampedTop = Math.min(
      Math.max(margin, nextTop),
      window.innerHeight - tooltipRect.height - margin,
    );

    setPosition({ top: clampedTop, left: clampedLeft });
  }, [canUseDom, offset, side]);

  useEffect(() => {
    if (disabled || !content) {
      closeNow();
    }
  }, [closeNow, content, disabled]);

  useLayoutEffect(() => {
    if (!open || !canUseDom) return;
    updatePosition();
  }, [canUseDom, open, updatePosition]);

  useEffect(() => {
    if (!open || !canUseDom) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closeNow();
    };
    const handleReposition = () => updatePosition();
    document.addEventListener("keydown", handleEscape);
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);
    return () => {
      document.removeEventListener("keydown", handleEscape);
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
  }, [canUseDom, closeNow, open, updatePosition]);

  useEffect(() => {
    return () => {
      clearOpenTimer();
      clearCloseTimer();
    };
  }, [clearCloseTimer, clearOpenTimer]);

  const childNode = React.isValidElement(children)
    ? (() => {
      const childElement = children as React.ReactElement<{
        "aria-describedby"?: string;
      }>;
      const existing =
        typeof childElement.props["aria-describedby"] === "string"
          ? childElement.props["aria-describedby"]
          : undefined;
      const nextDescribedBy = (() => {
        if (disabled || !content) return existing;
        if (!existing) return tooltipId;
        if (existing.split(" ").includes(tooltipId)) return existing;
        return `${existing} ${tooltipId}`;
      })();
      return React.cloneElement(childElement, {
        "aria-describedby": nextDescribedBy,
      });
    })()
    : children;

  return (
    <>
      <span
        className={classNames("gds-tooltip-anchor", className)}
        ref={anchorRef}
        onMouseEnter={scheduleOpen}
        onMouseLeave={scheduleClose}
        onFocusCapture={scheduleOpen}
        onBlurCapture={(event) => {
          const relatedTarget = event.relatedTarget as Node | null;
          if (
            relatedTarget && event.currentTarget.contains(relatedTarget)
          ) return;
          scheduleClose();
        }}
      >
        {childNode}
      </span>
      {canUseDom && open && content &&
        createPortal(
          <div
            id={tooltipId}
            role="tooltip"
            ref={tooltipRef}
            className={classNames(
              "gds-tooltip",
              `gds-tooltip--${side}`,
              tooltipClassName,
            )}
            style={position ?? { top: -9999, left: -9999 }}
            aria-hidden={!open}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}
