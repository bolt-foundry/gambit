/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useLexicalEditable } from '@lexical/react/useLexicalEditable';
import { $canShowPlaceholderCurry } from '@lexical/text';
import { mergeRegister } from '@lexical/utils';
import { useLayoutEffect, useEffect, useState, useMemo, Suspense } from 'react';
import { flushSync, createPortal } from 'react-dom';
import { jsx, jsxs, Fragment } from 'react/jsx-runtime';
import { registerDragonSupport } from '@lexical/dragon';
import { registerPlainText } from '@lexical/plain-text';

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

const CAN_USE_DOM = typeof window !== 'undefined' && typeof window.document !== 'undefined' && typeof window.document.createElement !== 'undefined';

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */


// This workaround is no longer necessary in React 19,
// but we currently support React >=17.x
// https://github.com/facebook/react/pull/26395
const useLayoutEffectImpl = CAN_USE_DOM ? useLayoutEffect : useEffect;

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

function canShowPlaceholderFromCurrentEditorState(editor) {
  const currentCanShowPlaceholder = editor.getEditorState().read($canShowPlaceholderCurry(editor.isComposing()));
  return currentCanShowPlaceholder;
}
function useCanShowPlaceholder(editor) {
  const [canShowPlaceholder, setCanShowPlaceholder] = useState(() => canShowPlaceholderFromCurrentEditorState(editor));
  useLayoutEffectImpl(() => {
    function resetCanShowPlaceholder() {
      const currentCanShowPlaceholder = canShowPlaceholderFromCurrentEditorState(editor);
      setCanShowPlaceholder(currentCanShowPlaceholder);
    }
    resetCanShowPlaceholder();
    return mergeRegister(editor.registerUpdateListener(() => {
      resetCanShowPlaceholder();
    }), editor.registerEditableListener(() => {
      resetCanShowPlaceholder();
    }));
  }, [editor]);
  return canShowPlaceholder;
}

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

function useDecorators(editor, ErrorBoundary) {
  const [decorators, setDecorators] = useState(() => editor.getDecorators());

  // Subscribe to changes
  useLayoutEffectImpl(() => {
    return editor.registerDecoratorListener(nextDecorators => {
      flushSync(() => {
        setDecorators(nextDecorators);
      });
    });
  }, [editor]);
  useEffect(() => {
    // If the content editable mounts before the subscription is added, then
    // nothing will be rendered on initial pass. We can get around that by
    // ensuring that we set the value.
    setDecorators(editor.getDecorators());
  }, [editor]);

  // Return decorators defined as React Portals
  return useMemo(() => {
    const decoratedPortals = [];
    const decoratorKeys = Object.keys(decorators);
    for (let i = 0; i < decoratorKeys.length; i++) {
      const nodeKey = decoratorKeys[i];
      const reactDecorator = /*#__PURE__*/jsx(ErrorBoundary, {
        onError: e => editor._onError(e),
        children: /*#__PURE__*/jsx(Suspense, {
          fallback: null,
          children: decorators[nodeKey]
        })
      });
      const element = editor.getElementByKey(nodeKey);
      if (element !== null) {
        decoratedPortals.push(/*#__PURE__*/createPortal(reactDecorator, element, nodeKey));
      }
    }
    return decoratedPortals;
  }, [ErrorBoundary, decorators, editor]);
}

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

function usePlainTextSetup(editor) {
  useLayoutEffectImpl(() => {
    return mergeRegister(registerPlainText(editor), registerDragonSupport(editor));

    // We only do this for init
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);
}

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

function PlainTextPlugin({
  contentEditable,
  // TODO Remove. This property is now part of ContentEditable
  placeholder = null,
  ErrorBoundary
}) {
  const [editor] = useLexicalComposerContext();
  const decorators = useDecorators(editor, ErrorBoundary);
  usePlainTextSetup(editor);
  return /*#__PURE__*/jsxs(Fragment, {
    children: [contentEditable, /*#__PURE__*/jsx(Placeholder, {
      content: placeholder
    }), decorators]
  });
}

// TODO Remove
function Placeholder({
  content
}) {
  const [editor] = useLexicalComposerContext();
  const showPlaceholder = useCanShowPlaceholder(editor);
  const editable = useLexicalEditable();
  if (!showPlaceholder) {
    return null;
  }
  if (typeof content === 'function') {
    return content(editable);
  } else {
    return content;
  }
}

export { PlainTextPlugin };
