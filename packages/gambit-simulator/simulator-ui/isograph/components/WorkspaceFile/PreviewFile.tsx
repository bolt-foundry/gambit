import { iso } from "@iso-gambit-sim";

function formatPreviewText(content: string | null): string {
  const normalized = content ?? "";
  return normalized.length > 0 ? normalized : "(empty file)";
}

export const PreviewFile = iso(`
  field WorkspaceFile.PreviewFile @component {
    id
    path
    size
    modifiedAt
    content
  }
`)(function PreviewFile({ data }) {
  return (
    <div className="build-files-preview-body">
      <div className="build-file-meta" style={{ marginBottom: 8 }}>
        {data.path}
      </div>
      <pre className="build-file-preview">{formatPreviewText(data.content)}</pre>
    </div>
  );
});

export default PreviewFile;
