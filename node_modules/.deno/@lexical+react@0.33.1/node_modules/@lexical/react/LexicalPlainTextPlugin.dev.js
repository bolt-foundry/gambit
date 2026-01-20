/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

'use strict';

var LexicalComposerContext = require('@lexical/react/LexicalComposerContext');
var useLexicalEditable = require('@lexical/react/useLexicalEditable');
var text = require('@lexical/text');
var utils = require('@lexical/utils');
var react = require('react');
var reactDom = require('react-dom');
var jsxRuntime = require('react/jsx-runtime');
var dragon = require('@lexical/dragon');
var plainText = require('@lexical/plain-text');

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
const useLayoutEffectImpl = CAN_USE_DOM ? react.useLayoutEffect : react.useEffect;

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

function canShowPlaceholderFromCurrentEditorState(editor) {
  const currentCanShowPlaceholder = editor.getEditorState().read(text.$canShowPlaceholderCurry(editor.isComposing()));
  return currentCanShowPlaceholder;
}
function useCanShowPlaceholder(editor) {
  const [canShowPlaceholder, setCanShowPlaceholder] = react.useState(() => canShowPlaceholderFromCurrentEditorState(editor));
  useLayoutEffectImpl(() => {
    function resetCanShowPlaceholder() {
      const currentCanShowPlaceholder = canShowPlaceholderFromCurrentEditorState(editor);
      setCanShowPlaceholder(currentCanShowPlaceholder);
    }
    resetCanShowPlaceholder();
    return utils.mergeRegister(editor.registerUpdateListener(() => {
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
  const [decorators, setDecorators] = react.useState(() => editor.getDecorators());

  // Subscribe to changes
  useLayoutEffectImpl(() => {
    return editor.registerDecoratorListener(nextDecorators => {
      reactDom.flushSync(() => {
        setDecorators(nextDecorators);
      });
    });
  }, [editor]);
  react.useEffect(() => {
    // If the content editable mounts before the subscription is added, then
    // nothing will be rendered on initial pass. We can get around that by
    // ensuring that we set the value.
    setDecorators(editor.getDecorators());
  }, [editor]);

  // Return decorators defined as React Portals
  return react.useMemo(() => {
    const decoratedPortals = [];
    const decoratorKeys = Object.keys(decorators);
    for (let i = 0; i < decoratorKeys.length; i++) {
      const nodeKey = decoratorKeys[i];
      const reactDecorator = /*#__PURE__*/jsxRuntime.jsx(ErrorBoundary, {
        onError: e => editor._onError(e),
        children: /*#__PURE__*/jsxRuntime.jsx(react.Suspense, {
          fallback: null,
          children: decorators[nodeKey]
        })
      });
      const element = editor.getElementByKey(nodeKey);
      if (element !== null) {
        decoratedPortals.push(/*#__PURE__*/reactDom.createPortal(reactDecorator, element, nodeKey));
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
    return utils.mergeRegister(plainText.registerPlainText(editor), dragon.registerDragonSupport(editor));

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
  const [editor] = LexicalComposerContext.useLexicalComposerContext();
  const decorators = useDecorators(editor, ErrorBoundary);
  usePlainTextSetup(editor);
  return /*#__PURE__*/jsxRuntime.jsxs(jsxRuntime.Fragment, {
    children: [contentEditable, /*#__PURE__*/jsxRuntime.jsx(Placeholder, {
      content: placeholder
    }), decorators]
  });
}

// TODO Remove
function Placeholder({
  content
}) {
  const [editor] = LexicalComposerContext.useLexicalComposerContext();
  const showPlaceholder = useCanShowPlaceholder(editor);
  const editable = useLexicalEditable.useLexicalEditable();
  if (!showPlaceholder) {
    return null;
  }
  if (typeof content === 'function') {
    return content(editable);
  } else {
    return content;
  }
}

exports.PlainTextPlugin = PlainTextPlugin;
