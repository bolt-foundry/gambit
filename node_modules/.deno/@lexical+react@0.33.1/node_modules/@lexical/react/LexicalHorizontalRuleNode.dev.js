/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

'use strict';

var LexicalComposerContext = require('@lexical/react/LexicalComposerContext');
var useLexicalNodeSelection = require('@lexical/react/useLexicalNodeSelection');
var utils = require('@lexical/utils');
var lexical = require('lexical');
var react = require('react');
var jsxRuntime = require('react/jsx-runtime');

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

const INSERT_HORIZONTAL_RULE_COMMAND = lexical.createCommand('INSERT_HORIZONTAL_RULE_COMMAND');
function HorizontalRuleComponent({
  nodeKey
}) {
  const [editor] = LexicalComposerContext.useLexicalComposerContext();
  const [isSelected, setSelected, clearSelection] = useLexicalNodeSelection.useLexicalNodeSelection(nodeKey);
  react.useEffect(() => {
    return utils.mergeRegister(editor.registerCommand(lexical.CLICK_COMMAND, event => {
      const hrElem = editor.getElementByKey(nodeKey);
      if (event.target === hrElem) {
        if (!event.shiftKey) {
          clearSelection();
        }
        setSelected(!isSelected);
        return true;
      }
      return false;
    }, lexical.COMMAND_PRIORITY_LOW));
  }, [clearSelection, editor, isSelected, nodeKey, setSelected]);
  react.useEffect(() => {
    const hrElem = editor.getElementByKey(nodeKey);
    const isSelectedClassName = editor._config.theme.hrSelected ?? 'selected';
    if (hrElem !== null) {
      if (isSelected) {
        utils.addClassNamesToElement(hrElem, isSelectedClassName);
      } else {
        utils.removeClassNamesFromElement(hrElem, isSelectedClassName);
      }
    }
  }, [editor, isSelected, nodeKey]);
  return null;
}
class HorizontalRuleNode extends lexical.DecoratorNode {
  static getType() {
    return 'horizontalrule';
  }
  static clone(node) {
    return new HorizontalRuleNode(node.__key);
  }
  static importJSON(serializedNode) {
    return $createHorizontalRuleNode().updateFromJSON(serializedNode);
  }
  static importDOM() {
    return {
      hr: () => ({
        conversion: $convertHorizontalRuleElement,
        priority: 0
      })
    };
  }
  exportDOM() {
    return {
      element: document.createElement('hr')
    };
  }
  createDOM(config) {
    const element = document.createElement('hr');
    utils.addClassNamesToElement(element, config.theme.hr);
    return element;
  }
  getTextContent() {
    return '\n';
  }
  isInline() {
    return false;
  }
  updateDOM() {
    return false;
  }
  decorate() {
    return /*#__PURE__*/jsxRuntime.jsx(HorizontalRuleComponent, {
      nodeKey: this.__key
    });
  }
}
function $convertHorizontalRuleElement() {
  return {
    node: $createHorizontalRuleNode()
  };
}
function $createHorizontalRuleNode() {
  return lexical.$applyNodeReplacement(new HorizontalRuleNode());
}
function $isHorizontalRuleNode(node) {
  return node instanceof HorizontalRuleNode;
}

exports.$createHorizontalRuleNode = $createHorizontalRuleNode;
exports.$isHorizontalRuleNode = $isHorizontalRuleNode;
exports.HorizontalRuleNode = HorizontalRuleNode;
exports.INSERT_HORIZONTAL_RULE_COMMAND = INSERT_HORIZONTAL_RULE_COMMAND;
