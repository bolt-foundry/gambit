/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

"use strict";var e=require("@lexical/link"),t=require("@lexical/react/LexicalComposerContext"),r=require("@lexical/utils"),i=require("lexical"),l=require("react");exports.LinkPlugin=function({validateUrl:n,attributes:o}){const[a]=t.useLexicalComposerContext();return l.useEffect((()=>{if(!a.hasNodes([e.LinkNode]))throw new Error("LinkPlugin: LinkNode not registered on editor");return r.mergeRegister(a.registerCommand(e.TOGGLE_LINK_COMMAND,(t=>{if(null===t)return e.$toggleLink(t),!0;if("string"==typeof t)return!(void 0!==n&&!n(t))&&(e.$toggleLink(t,o),!0);{const{url:r,target:i,rel:l,title:n}=t;return e.$toggleLink(r,{...o,rel:l,target:i,title:n}),!0}}),i.COMMAND_PRIORITY_LOW),void 0!==n?a.registerCommand(i.PASTE_COMMAND,(t=>{const l=i.$getSelection();if(!i.$isRangeSelection(l)||l.isCollapsed()||!r.objectKlassEquals(t,ClipboardEvent))return!1;if(null===t.clipboardData)return!1;const s=t.clipboardData.getData("text");return!!n(s)&&(!l.getNodes().some((e=>i.$isElementNode(e)))&&(a.dispatchCommand(e.TOGGLE_LINK_COMMAND,{...o,url:s}),t.preventDefault(),!0))}),i.COMMAND_PRIORITY_LOW):()=>{})}),[a,n,o]),null};
