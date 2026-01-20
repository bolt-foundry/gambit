/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import{LinkNode as t,TOGGLE_LINK_COMMAND as r,$toggleLink as e}from"@lexical/link";import{useLexicalComposerContext as o}from"@lexical/react/LexicalComposerContext";import{mergeRegister as i,objectKlassEquals as l}from"@lexical/utils";import{COMMAND_PRIORITY_LOW as n,PASTE_COMMAND as a,$getSelection as m,$isRangeSelection as s,$isElementNode as u}from"lexical";import{useEffect as d}from"react";function c({validateUrl:c,attributes:p}){const[f]=o();return d((()=>{if(!f.hasNodes([t]))throw new Error("LinkPlugin: LinkNode not registered on editor");return i(f.registerCommand(r,(t=>{if(null===t)return e(t),!0;if("string"==typeof t)return!(void 0!==c&&!c(t))&&(e(t,p),!0);{const{url:r,target:o,rel:i,title:l}=t;return e(r,{...p,rel:i,target:o,title:l}),!0}}),n),void 0!==c?f.registerCommand(a,(t=>{const e=m();if(!s(e)||e.isCollapsed()||!l(t,ClipboardEvent))return!1;if(null===t.clipboardData)return!1;const o=t.clipboardData.getData("text");return!!c(o)&&(!e.getNodes().some((t=>u(t)))&&(f.dispatchCommand(r,{...p,url:o}),t.preventDefault(),!0))}),n):()=>{})}),[f,c,p]),null}export{c as LinkPlugin};
