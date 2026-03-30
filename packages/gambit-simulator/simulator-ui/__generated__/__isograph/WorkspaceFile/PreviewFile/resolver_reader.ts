import type {ComponentReaderArtifact, ExtractSecondParam, ReaderAst } from '@isograph/react';
import { WorkspaceFile__PreviewFile__param } from './param_type.ts';
import { PreviewFile as resolver } from '../../../../isograph/components/WorkspaceFile/PreviewFile.tsx';

const readerAst: ReaderAst<WorkspaceFile__PreviewFile__param> = [
  {
    kind: "Scalar",
    fieldName: "id",
    alias: null,
    arguments: null,
    isUpdatable: false,
  },
  {
    kind: "Scalar",
    fieldName: "path",
    alias: null,
    arguments: null,
    isUpdatable: false,
  },
  {
    kind: "Scalar",
    fieldName: "size",
    alias: null,
    arguments: null,
    isUpdatable: false,
  },
  {
    kind: "Scalar",
    fieldName: "modifiedAt",
    alias: null,
    arguments: null,
    isUpdatable: false,
  },
  {
    kind: "Scalar",
    fieldName: "content",
    alias: null,
    arguments: null,
    isUpdatable: false,
  },
];

const artifact: ComponentReaderArtifact<
  WorkspaceFile__PreviewFile__param,
  ExtractSecondParam<typeof resolver>
> = {
  kind: "ComponentReaderArtifact",
  fieldName: "PreviewFile",
  resolver,
  readerAst,
  hasUpdatable: false,
};

export default artifact;
