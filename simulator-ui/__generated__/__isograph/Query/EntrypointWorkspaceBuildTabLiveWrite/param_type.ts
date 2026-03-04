import { type WorkspaceFile__PreviewFile__output_type } from '../../WorkspaceFile/PreviewFile/output_type.ts';
import type { Query__EntrypointWorkspaceBuildTabLiveWrite__parameters } from './parameters_type.ts';

export type Query__EntrypointWorkspaceBuildTabLiveWrite__param = {
  readonly data: {
    readonly workspace: ({
      readonly id: (string | null),
      readonly files: ({
        readonly edges: (ReadonlyArray<({
          readonly node: ({
            readonly id: (string | null),
            readonly path: (string | null),
            readonly PreviewFile: WorkspaceFile__PreviewFile__output_type,
          } | null),
        } | null)> | null),
      } | null),
    } | null),
  },
  readonly parameters: Query__EntrypointWorkspaceBuildTabLiveWrite__parameters,
};
