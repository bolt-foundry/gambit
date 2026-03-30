import { useCallback, useEffect, useRef, useState } from "react";
import { classNames } from "./utils.ts";

type CopyBadgeProps = {
  label: string;
  displayValue?: string | null;
  copyValue?: string | null;
  className?: string;
};

export function CopyBadge(props: CopyBadgeProps) {
  const { label, displayValue, copyValue, className } = props;
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<
    ReturnType<typeof globalThis.setTimeout> | undefined
  >(
    undefined,
  );

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const copyTarget = copyValue ?? displayValue;
  if (!copyTarget) return null;
  const text = displayValue ?? copyTarget;

  const handleCopy = useCallback(async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(copyTarget);
      } else {
        const temp = document.createElement("textarea");
        temp.value = copyTarget;
        temp.style.position = "fixed";
        temp.style.opacity = "0";
        document.body.appendChild(temp);
        temp.select();
        document.execCommand("copy");
        document.body.removeChild(temp);
      }
      setCopied(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = globalThis.setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore copy failures silently
    }
  }, [copyTarget]);

  return (
    <button
      type="button"
      className={classNames("copy-badge", className, copied && "copied")}
      onClick={handleCopy}
      title={copied ? "Copied!" : `Click to copy ${label}`}
    >
      <span className="copy-label">{label}:</span>
      <code>{text}</code>
      {copied && <span className="copy-feedback">Copied</span>}
    </button>
  );
}
