/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import{addClassNamesToElement as t}from"@lexical/utils";import{TextNode as e,$applyNodeReplacement as r}from"lexical";class n extends e{static getType(){return"hashtag"}static clone(t){return new n(t.__text,t.__key)}createDOM(e){const r=super.createDOM(e);return t(r,e.theme.hashtag),r}static importJSON(t){return a().updateFromJSON(t)}canInsertTextBefore(){return!1}isTextEntity(){return!0}}function a(t=""){return r(new n(t))}function c(t){return t instanceof n}export{a as $createHashtagNode,c as $isHashtagNode,n as HashtagNode};
