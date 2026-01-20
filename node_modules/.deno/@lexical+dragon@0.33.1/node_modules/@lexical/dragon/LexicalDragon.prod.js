/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

"use strict";var e=require("lexical");exports.registerDragonSupport=function(t){const n=window.location.origin,o=o=>{if(o.origin!==n)return;const i=t.getRootElement();if(document.activeElement!==i)return;const s=o.data;if("string"==typeof s){let n;try{n=JSON.parse(s)}catch(e){return}if(n&&"nuanria_messaging"===n.protocol&&"request"===n.type){const i=n.payload;if(i&&"makeChanges"===i.functionId){const n=i.args;if(n){const[i,s,r,a,c,g]=n;t.update((()=>{const t=e.$getSelection();if(e.$isRangeSelection(t)){const n=t.anchor;let g=n.getNode(),d=0,u=0;if(e.$isTextNode(g)&&i>=0&&s>=0&&(d=i,u=i+s,t.setTextNodeRange(g,d,g,u)),d===u&&""===r||(t.insertRawText(r),g=n.getNode()),e.$isTextNode(g)){d=a,u=a+c;const e=g.getTextContentSize();d=d>e?e:d,u=u>e?e:u,t.setTextNodeRange(g,d,g,u)}o.stopImmediatePropagation()}}))}}}}};return window.addEventListener("message",o,!0),()=>{window.removeEventListener("message",o,!0)}};
