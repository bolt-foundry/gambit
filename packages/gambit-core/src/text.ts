export function joinTextParts(parts: Array<string>): string {
  return parts.filter(Boolean).join("");
}
