/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useLexicalNodeSelection } from '@lexical/react/useLexicalNodeSelection';
import { addClassNamesToElement, mergeRegister, removeClassNamesFromElement } from '@lexical/utils';
import { createCommand, DecoratorNode, $applyNodeReplacement, CLICK_COMMAND, COMMAND_PRIORITY_LOW } from 'lexical';
import { useEffect } from 'react';
import { jsx } from 'react/jsx-runtime';

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

const INSERT_HORIZONTAL_RULE_COMMAND = createCommand('INSERT_HORIZONTAL_RULE_COMMAND');
function HorizontalRuleComponent({
  nodeKey
}) {
  const [editor] = useLexicalComposerContext();
  const [isSelected, setSelected, clearSelection] = useLexicalNodeSelection(nodeKey);
  useEffect(() => {
    return mergeRegister(editor.registerCommand(CLICK_COMMAND, event => {
      const hrElem = editor.getElementByKey(nodeKey);
      if (event.target === hrElem) {
        if (!event.shiftKey) {
          clearSelection();
        }
        setSelected(!isSelected);
        return true;
      }
      return false;
    }, COMMAND_PRIORITY_LOW));
  }, [clearSelection, editor, isSelected, nodeKey, setSelected]);
  useEffect(() => {
    const hrElem = editor.getElementByKey(nodeKey);
    const isSelectedClassName = editor._config.theme.hrSelected ?? 'selected';
    if (hrElem !== null) {
      if (isSelected) {
        addClassNamesToElement(hrElem, isSelectedClassName);
      } else {
        removeClassNamesFromElement(hrElem, isSelectedClassName);
      }
    }
  }, [editor, isSelected, nodeKey]);
  return null;
}
class HorizontalRuleNode extends DecoratorNode {
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
    addClassNamesToElement(element, config.theme.hr);
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
    return /*#__PURE__*/jsx(HorizontalRuleComponent, {
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
  return $applyNodeReplacement(new HorizontalRuleNode());
}
function $isHorizontalRuleNode(node) {
  return node instanceof HorizontalRuleNode;
}

export { $createHorizontalRuleNode, $isHorizontalRuleNode, HorizontalRuleNode, INSERT_HORIZONTAL_RULE_COMMAND };
