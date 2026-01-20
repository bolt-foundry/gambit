/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import{$getSelection as e,$isRangeSelection as t,$isTextNode as n}from"lexical";function o(o){const i=window.location.origin,a=a=>{if(a.origin!==i)return;const r=o.getRootElement();if(document.activeElement!==r)return;const s=a.data;if("string"==typeof s){let i;try{i=JSON.parse(s)}catch(e){return}if(i&&"nuanria_messaging"===i.protocol&&"request"===i.type){const r=i.payload;if(r&&"makeChanges"===r.functionId){const i=r.args;if(i){const[r,s,c,g,d,f]=i;o.update((()=>{const o=e();if(t(o)){const e=o.anchor;let t=e.getNode(),i=0,f=0;if(n(t)&&r>=0&&s>=0&&(i=r,f=r+s,o.setTextNodeRange(t,i,t,f)),i===f&&""===c||(o.insertRawText(c),t=e.getNode()),n(t)){i=g,f=g+d;const e=t.getTextContentSize();i=i>e?e:i,f=f>e?e:f,o.setTextNodeRange(t,i,t,f)}a.stopImmediatePropagation()}}))}}}}};return window.addEventListener("message",a,!0),()=>{window.removeEventListener("message",a,!0)}}export{o as registerDragonSupport};
