/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import{useLexicalComposerContext as e}from"@lexical/react/LexicalComposerContext";import{useLexicalNodeSelection as t}from"@lexical/react/useLexicalNodeSelection";import{addClassNamesToElement as r,mergeRegister as n,removeClassNamesFromElement as o}from"@lexical/utils";import{createCommand as c,DecoratorNode as i,$applyNodeReplacement as u,CLICK_COMMAND as l,COMMAND_PRIORITY_LOW as m}from"lexical";import{useEffect as a}from"react";import{jsx as s}from"react/jsx-runtime";const p=c("INSERT_HORIZONTAL_RULE_COMMAND");function d({nodeKey:c}){const[i]=e(),[u,s,p]=t(c);return a((()=>n(i.registerCommand(l,(e=>{const t=i.getElementByKey(c);return e.target===t&&(e.shiftKey||p(),s(!u),!0)}),m))),[p,i,u,c,s]),a((()=>{const e=i.getElementByKey(c),t=i._config.theme.hrSelected??"selected";null!==e&&(u?r(e,t):o(e,t))}),[i,u,c]),null}class f extends i{static getType(){return"horizontalrule"}static clone(e){return new f(e.__key)}static importJSON(e){return y().updateFromJSON(e)}static importDOM(){return{hr:()=>({conversion:x,priority:0})}}exportDOM(){return{element:document.createElement("hr")}}createDOM(e){const t=document.createElement("hr");return r(t,e.theme.hr),t}getTextContent(){return"\n"}isInline(){return!1}updateDOM(){return!1}decorate(){return s(d,{nodeKey:this.__key})}}function x(){return{node:y()}}function y(){return u(new f)}function h(e){return e instanceof f}export{y as $createHorizontalRuleNode,h as $isHorizontalRuleNode,f as HorizontalRuleNode,p as INSERT_HORIZONTAL_RULE_COMMAND};
