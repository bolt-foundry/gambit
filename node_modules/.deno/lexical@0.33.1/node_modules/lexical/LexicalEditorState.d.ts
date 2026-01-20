/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import type { LexicalEditor } from './LexicalEditor';
import type { NodeMap, SerializedLexicalNode } from './LexicalNode';
import type { BaseSelection } from './LexicalSelection';
import type { SerializedRootNode } from './nodes/LexicalRootNode';
export interface SerializedEditorState<T extends SerializedLexicalNode = SerializedLexicalNode> {
    root: SerializedRootNode<T>;
}
export declare function editorStateHasDirtySelection(editorState: EditorState, editor: LexicalEditor): boolean;
export declare function cloneEditorState(current: EditorState): EditorState;
export declare function createEmptyEditorState(): EditorState;
export interface EditorStateReadOptions {
    editor?: LexicalEditor | null;
}
export declare class EditorState {
    _nodeMap: NodeMap;
    _selection: null | BaseSelection;
    _flushSync: boolean;
    _readOnly: boolean;
    constructor(nodeMap: NodeMap, selection?: null | BaseSelection);
    isEmpty(): boolean;
    read<V>(callbackFn: () => V, options?: EditorStateReadOptions): V;
    clone(selection?: null | BaseSelection): EditorState;
    toJSON(): SerializedEditorState;
}
