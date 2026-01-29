import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { classNames } from "../utils.ts";

type ScrollingTextProps = React.HTMLAttributes<HTMLSpanElement> & {
  text: string;
  as?: "span" | "div";
  speed?: number;
};

export default function ScrollingText(props: ScrollingTextProps) {
  const { text, as, className, speed = 40, style, title, ...rest } = props;
  const containerRef = useRef<HTMLElement | null>(null);
  const innerRef = useRef<HTMLSpanElement | null>(null);
  const [scrollDistance, setScrollDistance] = useState(0);
  const [isOverflowing, setIsOverflowing] = useState(false);

  const measure = useCallback(() => {
    const container = containerRef.current;
    const inner = innerRef.current;
    if (!container || !inner) return;
    const distance = Math.max(inner.scrollWidth - container.clientWidth, 0);
    setScrollDistance(distance);
    setIsOverflowing(distance > 1);
  }, []);

  useLayoutEffect(() => {
    measure();
  }, [measure, text]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => measure());
      observer.observe(container);
      return () => observer.disconnect();
    }
    const handleResize = () => measure();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [measure]);

  const safeSpeed = speed > 0 ? speed : 40;
  const duration = scrollDistance > 0 ? scrollDistance / safeSpeed : 0;
  const Tag = (as ?? "span") as "span" | "div";
  const mergedStyle = {
    ...style,
    "--gds-scroll-distance": `${scrollDistance}px`,
    "--gds-scroll-duration": `${duration}s`,
  } as React.CSSProperties;
  const resolvedTitle = title ?? (isOverflowing ? text : undefined);
  const sharedProps = {
    className: classNames(
      "gds-scrolling-text",
      isOverflowing && "gds-scrolling-text--overflow",
      className,
    ),
    style: mergedStyle,
    title: resolvedTitle,
    ...rest,
  } as const;

  if (Tag === "div") {
    return (
      <div
        ref={(node) => {
          containerRef.current = node;
        }}
        {...sharedProps}
      >
        <span className="gds-scrolling-text__inner" ref={innerRef}>
          {text}
        </span>
      </div>
    );
  }

  return (
    <span
      ref={(node) => {
        containerRef.current = node;
      }}
      {...sharedProps}
    >
      <span className="gds-scrolling-text__inner" ref={innerRef}>
        {text}
      </span>
    </span>
  );
}
