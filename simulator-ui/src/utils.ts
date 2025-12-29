export function classNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function formatTimestamp(iso?: string) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

export function formatTimestampShort(iso?: string) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const now = new Date();
  const includeYear = date.getFullYear() !== now.getFullYear();
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: includeYear ? "numeric" : undefined,
    hour: "numeric",
    minute: "2-digit",
  });
}
