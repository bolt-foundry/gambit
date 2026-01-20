/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

"use strict";var e=require("@lexical/react/LexicalComposerContext"),t=require("@lexical/react/useLexicalNodeSelection"),r=require("@lexical/utils"),n=require("lexical"),o=require("react"),c=require("react/jsx-runtime");const s=n.createCommand("INSERT_HORIZONTAL_RULE_COMMAND");function a({nodeKey:c}){const[s]=e.useLexicalComposerContext(),[a,i,l]=t.useLexicalNodeSelection(c);return o.useEffect((()=>r.mergeRegister(s.registerCommand(n.CLICK_COMMAND,(e=>{const t=s.getElementByKey(c);return e.target===t&&(e.shiftKey||l(),i(!a),!0)}),n.COMMAND_PRIORITY_LOW))),[l,s,a,c,i]),o.useEffect((()=>{const e=s.getElementByKey(c),t=s._config.theme.hrSelected??"selected";null!==e&&(a?r.addClassNamesToElement(e,t):r.removeClassNamesFromElement(e,t))}),[s,a,c]),null}class i extends n.DecoratorNode{static getType(){return"horizontalrule"}static clone(e){return new i(e.__key)}static importJSON(e){return u().updateFromJSON(e)}static importDOM(){return{hr:()=>({conversion:l,priority:0})}}exportDOM(){return{element:document.createElement("hr")}}createDOM(e){const t=document.createElement("hr");return r.addClassNamesToElement(t,e.theme.hr),t}getTextContent(){return"\n"}isInline(){return!1}updateDOM(){return!1}decorate(){return c.jsx(a,{nodeKey:this.__key})}}function l(){return{node:u()}}function u(){return n.$applyNodeReplacement(new i)}exports.$createHorizontalRuleNode=u,exports.$isHorizontalRuleNode=function(e){return e instanceof i},exports.HorizontalRuleNode=i,exports.INSERT_HORIZONTAL_RULE_COMMAND=s;
