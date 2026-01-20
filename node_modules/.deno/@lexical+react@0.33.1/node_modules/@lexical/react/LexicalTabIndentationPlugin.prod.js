/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

"use strict";var e=require("@lexical/react/LexicalComposerContext"),t=require("@lexical/utils"),n=require("lexical"),r=require("react");function o(e,r){return t.mergeRegister(e.registerCommand(n.KEY_TAB_COMMAND,(r=>{const o=n.$getSelection();if(!n.$isRangeSelection(o))return!1;r.preventDefault();const i=function(e){const r=e.getNodes();if(t.$filter(r,(e=>n.$isBlockElementNode(e)&&e.canIndent()?e:null)).length>0)return!0;const o=e.anchor,i=e.focus,c=i.isBefore(o)?i:o,s=c.getNode(),l=t.$getNearestBlockElementAncestorOrThrow(s);if(l.canIndent()){const e=l.getKey();let t=n.$createRangeSelection();if(t.anchor.set(e,0,"element"),t.focus.set(e,0,"element"),t=n.$normalizeSelection__EXPERIMENTAL(t),t.anchor.is(c))return!0}return!1}(o)?r.shiftKey?n.OUTDENT_CONTENT_COMMAND:n.INDENT_CONTENT_COMMAND:n.INSERT_TAB_COMMAND;return e.dispatchCommand(i,void 0)}),n.COMMAND_PRIORITY_EDITOR),e.registerCommand(n.INDENT_CONTENT_COMMAND,(()=>{if(null==r)return!1;const e=n.$getSelection();if(!n.$isRangeSelection(e))return!1;const o=e.getNodes().map((e=>t.$getNearestBlockElementAncestorOrThrow(e).getIndent()));return Math.max(...o)+1>=r}),n.COMMAND_PRIORITY_CRITICAL))}exports.TabIndentationPlugin=function({maxIndent:t}){const[n]=e.useLexicalComposerContext();return r.useEffect((()=>o(n,t)),[n,t]),null},exports.registerTabIndentation=o;
