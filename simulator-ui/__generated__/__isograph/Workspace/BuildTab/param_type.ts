import { type WorkspaceFile__PreviewFile__output_type } from '../../WorkspaceFile/PreviewFile/output_type.ts';

export type Workspace__BuildTab__param = {
  readonly data: {
    readonly files: {
      readonly edges: ReadonlyArray<{
        readonly node: {
          readonly id: string,
          readonly path: string,
          readonly PreviewFile: WorkspaceFile__PreviewFile__output_type,
        },
      }>,
    },
  },
  readonly parameters: Record<PropertyKey, never>,
};
