/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { CLEAR_EDITOR_COMMAND, $getRoot, $getSelection, $createParagraphNode, $isRangeSelection, COMMAND_PRIORITY_EDITOR } from 'lexical';
import { useLayoutEffect, useEffect } from 'react';

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

function ClearEditorPlugin({
  onClear
}) {
  const [editor] = useLexicalComposerContext();
  useLayoutEffectImpl(() => {
    return editor.registerCommand(CLEAR_EDITOR_COMMAND, payload => {
      editor.update(() => {
        if (onClear == null) {
          const root = $getRoot();
          const selection = $getSelection();
          const paragraph = $createParagraphNode();
          root.clear();
          root.append(paragraph);
          if (selection !== null) {
            paragraph.select();
          }
          if ($isRangeSelection(selection)) {
            selection.format = 0;
          }
        } else {
          onClear();
        }
      });
      return true;
    }, COMMAND_PRIORITY_EDITOR);
  }, [editor, onClear]);
  return null;
}

export { ClearEditorPlugin };
