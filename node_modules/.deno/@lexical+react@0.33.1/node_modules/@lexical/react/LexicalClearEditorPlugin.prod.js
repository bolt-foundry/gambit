/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

"use strict";var e=require("@lexical/react/LexicalComposerContext"),t=require("lexical"),o=require("react");const n="undefined"!=typeof window&&void 0!==window.document&&void 0!==window.document.createElement?o.useLayoutEffect:o.useEffect;exports.ClearEditorPlugin=function({onClear:o}){const[r]=e.useLexicalComposerContext();return n((()=>r.registerCommand(t.CLEAR_EDITOR_COMMAND,(e=>(r.update((()=>{if(null==o){const e=t.$getRoot(),o=t.$getSelection(),n=t.$createParagraphNode();e.clear(),e.append(n),null!==o&&n.select(),t.$isRangeSelection(o)&&(o.format=0)}else o()})),!0)),t.COMMAND_PRIORITY_EDITOR)),[r,o]),null};
