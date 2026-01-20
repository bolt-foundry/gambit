/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import{useLexicalComposerContext as t}from"@lexical/react/LexicalComposerContext";import{mergeRegister as e,$getNearestBlockElementAncestorOrThrow as n,$filter as r}from"@lexical/utils";import{KEY_TAB_COMMAND as o,$getSelection as c,$isRangeSelection as i,OUTDENT_CONTENT_COMMAND as s,INDENT_CONTENT_COMMAND as a,INSERT_TAB_COMMAND as m,COMMAND_PRIORITY_EDITOR as u,COMMAND_PRIORITY_CRITICAL as l,$isBlockElementNode as f,$createRangeSelection as d,$normalizeSelection__EXPERIMENTAL as p}from"lexical";import{useEffect as g}from"react";function x(t,g){return e(t.registerCommand(o,(e=>{const o=c();if(!i(o))return!1;e.preventDefault();const u=function(t){const e=t.getNodes();if(r(e,(t=>f(t)&&t.canIndent()?t:null)).length>0)return!0;const o=t.anchor,c=t.focus,i=c.isBefore(o)?c:o,s=i.getNode(),a=n(s);if(a.canIndent()){const t=a.getKey();let e=d();if(e.anchor.set(t,0,"element"),e.focus.set(t,0,"element"),e=p(e),e.anchor.is(i))return!0}return!1}(o)?e.shiftKey?s:a:m;return t.dispatchCommand(u,void 0)}),u),t.registerCommand(a,(()=>{if(null==g)return!1;const t=c();if(!i(t))return!1;const e=t.getNodes().map((t=>n(t).getIndent()));return Math.max(...e)+1>=g}),l))}function h({maxIndent:e}){const[n]=t();return g((()=>x(n,e)),[n,e]),null}export{h as TabIndentationPlugin,x as registerTabIndentation};
