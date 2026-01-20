/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import{ElementNode as e,$applyNodeReplacement as t}from"lexical";class r extends e{$config(){return this.config("overflow",{$transform(e){e.isEmpty()&&e.remove()},extends:e})}createDOM(e){const t=document.createElement("span"),r=e.theme.characterLimit;return"string"==typeof r&&(t.className=r),t}updateDOM(e,t){return!1}insertNewAfter(e,t=!0){return this.getParentOrThrow().insertNewAfter(e,t)}excludeFromCopy(){return!0}}function n(){return t(new r)}function o(e){return e instanceof r}export{n as $createOverflowNode,o as $isOverflowNode,r as OverflowNode};
