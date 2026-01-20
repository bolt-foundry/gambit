/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import{$isLinkNode as e}from"@lexical/link";import{useLexicalComposerContext as t}from"@lexical/react/LexicalComposerContext";import{$findMatchingParent as n,isHTMLAnchorElement as r}from"@lexical/utils";import{isDOMNode as l,getNearestEditorFromDOMNode as o,$getNearestNodeFromDOMNode as i,$isElementNode as u,$getSelection as a,$isRangeSelection as c}from"lexical";import{useEffect as s}from"react";function f({newTab:f=!0,disabled:m=!1}){const[p]=t();return s((()=>{const t=t=>{const s=t.target;if(!l(s))return;const d=o(s);if(null===d)return;let v=null,x=null;if(d.update((()=>{const t=i(s);if(null!==t){const l=n(t,u);if(!m)if(e(l))v=l.sanitizeUrl(l.getURL()),x=l.getTarget();else{const e=function(e,t){let n=e;for(;null!=n;){if(t(n))return n;n=n.parentNode}return null}(s,r);null!==e&&(v=e.href,x=e.target)}}})),null===v||""===v)return;const g=p.getEditorState().read(a);if(c(g)&&!g.isCollapsed())return void t.preventDefault();const L="auxclick"===t.type&&1===t.button;window.open(v,f||L||t.metaKey||t.ctrlKey||"_blank"===x?"_blank":"_self"),t.preventDefault()},s=e=>{1===e.button&&t(e)};return p.registerRootListener(((e,n)=>{null!==n&&(n.removeEventListener("click",t),n.removeEventListener("mouseup",s)),null!==e&&(e.addEventListener("click",t),e.addEventListener("mouseup",s))}))}),[p,f,m]),null}export{f as ClickableLinkPlugin};
