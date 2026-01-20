/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

"use strict";var e=require("@lexical/link"),t=require("@lexical/react/LexicalComposerContext"),n=require("@lexical/utils"),r=require("lexical"),l=require("react");exports.ClickableLinkPlugin=function({newTab:i=!0,disabled:o=!1}){const[u]=t.useLexicalComposerContext();return l.useEffect((()=>{const t=t=>{const l=t.target;if(!r.isDOMNode(l))return;const s=r.getNearestEditorFromDOMNode(l);if(null===s)return;let a=null,c=null;if(s.update((()=>{const t=r.$getNearestNodeFromDOMNode(l);if(null!==t){const i=n.$findMatchingParent(t,r.$isElementNode);if(!o)if(e.$isLinkNode(i))a=i.sanitizeUrl(i.getURL()),c=i.getTarget();else{const e=function(e,t){let n=e;for(;null!=n;){if(t(n))return n;n=n.parentNode}return null}(l,n.isHTMLAnchorElement);null!==e&&(a=e.href,c=e.target)}}})),null===a||""===a)return;const d=u.getEditorState().read(r.$getSelection);if(r.$isRangeSelection(d)&&!d.isCollapsed())return void t.preventDefault();const f="auxclick"===t.type&&1===t.button;window.open(a,i||f||t.metaKey||t.ctrlKey||"_blank"===c?"_blank":"_self"),t.preventDefault()},l=e=>{1===e.button&&t(e)};return u.registerRootListener(((e,n)=>{null!==n&&(n.removeEventListener("click",t),n.removeEventListener("mouseup",l)),null!==e&&(e.addEventListener("click",t),e.addEventListener("mouseup",l))}))}),[u,i,o]),null};
