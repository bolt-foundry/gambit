/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import { $isLinkNode } from '@lexical/link';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $findMatchingParent, isHTMLAnchorElement } from '@lexical/utils';
import { isDOMNode, getNearestEditorFromDOMNode, $getNearestNodeFromDOMNode, $isElementNode, $getSelection, $isRangeSelection } from 'lexical';
import { useEffect } from 'react';

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

function findMatchingDOM(startNode, predicate) {
  let node = startNode;
  while (node != null) {
    if (predicate(node)) {
      return node;
    }
    node = node.parentNode;
  }
  return null;
}
function ClickableLinkPlugin({
  newTab = true,
  disabled = false
}) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    const onClick = event => {
      const target = event.target;
      if (!isDOMNode(target)) {
        return;
      }
      const nearestEditor = getNearestEditorFromDOMNode(target);
      if (nearestEditor === null) {
        return;
      }
      let url = null;
      let urlTarget = null;
      nearestEditor.update(() => {
        const clickedNode = $getNearestNodeFromDOMNode(target);
        if (clickedNode !== null) {
          const maybeLinkNode = $findMatchingParent(clickedNode, $isElementNode);
          if (!disabled) {
            if ($isLinkNode(maybeLinkNode)) {
              url = maybeLinkNode.sanitizeUrl(maybeLinkNode.getURL());
              urlTarget = maybeLinkNode.getTarget();
            } else {
              const a = findMatchingDOM(target, isHTMLAnchorElement);
              if (a !== null) {
                url = a.href;
                urlTarget = a.target;
              }
            }
          }
        }
      });
      if (url === null || url === '') {
        return;
      }

      // Allow user to select link text without following url
      const selection = editor.getEditorState().read($getSelection);
      if ($isRangeSelection(selection) && !selection.isCollapsed()) {
        event.preventDefault();
        return;
      }
      const isMiddle = event.type === 'auxclick' && event.button === 1;
      window.open(url, newTab || isMiddle || event.metaKey || event.ctrlKey || urlTarget === '_blank' ? '_blank' : '_self');
      event.preventDefault();
    };
    const onMouseUp = event => {
      if (event.button === 1) {
        onClick(event);
      }
    };
    return editor.registerRootListener((rootElement, prevRootElement) => {
      if (prevRootElement !== null) {
        prevRootElement.removeEventListener('click', onClick);
        prevRootElement.removeEventListener('mouseup', onMouseUp);
      }
      if (rootElement !== null) {
        rootElement.addEventListener('click', onClick);
        rootElement.addEventListener('mouseup', onMouseUp);
      }
    });
  }, [editor, newTab, disabled]);
  return null;
}

export { ClickableLinkPlugin };
