/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import{useLexicalComposerContext as e}from"@lexical/react/LexicalComposerContext";import{CLEAR_EDITOR_COMMAND as o,$getRoot as t,$getSelection as n,$createParagraphNode as r,$isRangeSelection as l,COMMAND_PRIORITY_EDITOR as i}from"lexical";import{useLayoutEffect as c,useEffect as m}from"react";const a="undefined"!=typeof window&&void 0!==window.document&&void 0!==window.document.createElement?c:m;function d({onClear:c}){const[m]=e();return a((()=>m.registerCommand(o,(e=>(m.update((()=>{if(null==c){const e=t(),o=n(),i=r();e.clear(),e.append(i),null!==o&&i.select(),l(o)&&(o.format=0)}else c()})),!0)),i)),[m,c]),null}export{d as ClearEditorPlugin};
