export function getPath(path: string) {
  if (path.startsWith("http")) return null;
  if (path.startsWith("https")) return null;
  if (path.startsWith("data:")) return null;
  if (path.startsWith("file://")) return path.substring(7);
  if (path.startsWith("file:")) return path.substring(5);
  return path;
}
