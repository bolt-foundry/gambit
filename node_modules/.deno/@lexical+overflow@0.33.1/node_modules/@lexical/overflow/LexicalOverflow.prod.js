/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

"use strict";var e=require("lexical");class r extends e.ElementNode{$config(){return this.config("overflow",{$transform(e){e.isEmpty()&&e.remove()},extends:e.ElementNode})}createDOM(e){const r=document.createElement("span"),t=e.theme.characterLimit;return"string"==typeof t&&(r.className=t),r}updateDOM(e,r){return!1}insertNewAfter(e,r=!0){return this.getParentOrThrow().insertNewAfter(e,r)}excludeFromCopy(){return!0}}exports.$createOverflowNode=function(){return e.$applyNodeReplacement(new r)},exports.$isOverflowNode=function(e){return e instanceof r},exports.OverflowNode=r;
