/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

'use strict';

var LexicalComposerContext = require('@lexical/react/LexicalComposerContext');
var lexical = require('lexical');
var react = require('react');

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

function ClearEditorPlugin({
  onClear
}) {
  const [editor] = LexicalComposerContext.useLexicalComposerContext();
  useLayoutEffectImpl(() => {
    return editor.registerCommand(lexical.CLEAR_EDITOR_COMMAND, payload => {
      editor.update(() => {
        if (onClear == null) {
          const root = lexical.$getRoot();
          const selection = lexical.$getSelection();
          const paragraph = lexical.$createParagraphNode();
          root.clear();
          root.append(paragraph);
          if (selection !== null) {
            paragraph.select();
          }
          if (lexical.$isRangeSelection(selection)) {
            selection.format = 0;
          }
        } else {
          onClear();
        }
      });
      return true;
    }, lexical.COMMAND_PRIORITY_EDITOR);
  }, [editor, onClear]);
  return null;
}

exports.ClearEditorPlugin = ClearEditorPlugin;
