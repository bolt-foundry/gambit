/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import type { LexicalCommandLog } from './useLexicalCommandsLog';
import type { EditorSetOptions, EditorState } from 'lexical';
import * as React from 'react';
export declare const TreeView: React.ForwardRefExoticComponent<{
    editorState: EditorState;
    treeTypeButtonClassName?: string | undefined;
    timeTravelButtonClassName?: string | undefined;
    timeTravelPanelButtonClassName?: string | undefined;
    timeTravelPanelClassName?: string | undefined;
    timeTravelPanelSliderClassName?: string | undefined;
    viewClassName?: string | undefined;
    generateContent: (exportDOM: boolean) => Promise<string>;
    setEditorState: (state: EditorState, options?: EditorSetOptions) => void;
    setEditorReadOnly: (isReadonly: boolean) => void;
    commandsLog?: LexicalCommandLog | undefined;
} & React.RefAttributes<HTMLPreElement>>;
