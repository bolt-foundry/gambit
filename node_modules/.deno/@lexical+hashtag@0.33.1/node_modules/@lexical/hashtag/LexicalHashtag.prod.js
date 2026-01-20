/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

"use strict";var e=require("@lexical/utils"),t=require("lexical");class r extends t.TextNode{static getType(){return"hashtag"}static clone(e){return new r(e.__text,e.__key)}createDOM(t){const r=super.createDOM(t);return e.addClassNamesToElement(r,t.theme.hashtag),r}static importJSON(e){return a().updateFromJSON(e)}canInsertTextBefore(){return!1}isTextEntity(){return!0}}function a(e=""){return t.$applyNodeReplacement(new r(e))}exports.$createHashtagNode=a,exports.$isHashtagNode=function(e){return e instanceof r},exports.HashtagNode=r;
