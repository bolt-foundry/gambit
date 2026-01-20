/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

'use strict';

var utils = require('@lexical/utils');
var lexical = require('lexical');

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

// Do not require this module directly! Use normal `invariant` calls.

function formatDevErrorMessage(message) {
  throw new Error(message);
}

const SUPPORTED_URL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'sms:', 'tel:']);

/** @noInheritDoc */
class LinkNode extends lexical.ElementNode {
  /** @internal */

  /** @internal */

  /** @internal */

  /** @internal */

  static getType() {
    return 'link';
  }
  static clone(node) {
    return new LinkNode(node.__url, {
      rel: node.__rel,
      target: node.__target,
      title: node.__title
    }, node.__key);
  }
  constructor(url = '', attributes = {}, key) {
    super(key);
    const {
      target = null,
      rel = null,
      title = null
    } = attributes;
    this.__url = url;
    this.__target = target;
    this.__rel = rel;
    this.__title = title;
  }
  createDOM(config) {
    const element = document.createElement('a');
    this.updateLinkDOM(null, element, config);
    utils.addClassNamesToElement(element, config.theme.link);
    return element;
  }
  updateLinkDOM(prevNode, anchor, config) {
    if (utils.isHTMLAnchorElement(anchor)) {
      if (!prevNode || prevNode.__url !== this.__url) {
        anchor.href = this.sanitizeUrl(this.__url);
      }
      for (const attr of ['target', 'rel', 'title']) {
        const key = `__${attr}`;
        const value = this[key];
        if (!prevNode || prevNode[key] !== value) {
          if (value) {
            anchor[attr] = value;
          } else {
            anchor.removeAttribute(attr);
          }
        }
      }
    }
  }
  updateDOM(prevNode, anchor, config) {
    this.updateLinkDOM(prevNode, anchor, config);
    return false;
  }
  static importDOM() {
    return {
      a: node => ({
        conversion: $convertAnchorElement,
        priority: 1
      })
    };
  }
  static importJSON(serializedNode) {
    return $createLinkNode().updateFromJSON(serializedNode);
  }
  updateFromJSON(serializedNode) {
    return super.updateFromJSON(serializedNode).setURL(serializedNode.url).setRel(serializedNode.rel || null).setTarget(serializedNode.target || null).setTitle(serializedNode.title || null);
  }
  sanitizeUrl(url) {
    url = formatUrl(url);
    try {
      const parsedUrl = new URL(formatUrl(url));
      // eslint-disable-next-line no-script-url
      if (!SUPPORTED_URL_PROTOCOLS.has(parsedUrl.protocol)) {
        return 'about:blank';
      }
    } catch (_unused) {
      return url;
    }
    return url;
  }
  exportJSON() {
    return {
      ...super.exportJSON(),
      rel: this.getRel(),
      target: this.getTarget(),
      title: this.getTitle(),
      url: this.getURL()
    };
  }
  getURL() {
    return this.getLatest().__url;
  }
  setURL(url) {
    const writable = this.getWritable();
    writable.__url = url;
    return writable;
  }
  getTarget() {
    return this.getLatest().__target;
  }
  setTarget(target) {
    const writable = this.getWritable();
    writable.__target = target;
    return writable;
  }
  getRel() {
    return this.getLatest().__rel;
  }
  setRel(rel) {
    const writable = this.getWritable();
    writable.__rel = rel;
    return writable;
  }
  getTitle() {
    return this.getLatest().__title;
  }
  setTitle(title) {
    const writable = this.getWritable();
    writable.__title = title;
    return writable;
  }
  insertNewAfter(_, restoreSelection = true) {
    const linkNode = $createLinkNode(this.__url, {
      rel: this.__rel,
      target: this.__target,
      title: this.__title
    });
    this.insertAfter(linkNode, restoreSelection);
    return linkNode;
  }
  canInsertTextBefore() {
    return false;
  }
  canInsertTextAfter() {
    return false;
  }
  canBeEmpty() {
    return false;
  }
  isInline() {
    return true;
  }
  extractWithChild(child, selection, destination) {
    if (!lexical.$isRangeSelection(selection)) {
      return false;
    }
    const anchorNode = selection.anchor.getNode();
    const focusNode = selection.focus.getNode();
    return this.isParentOf(anchorNode) && this.isParentOf(focusNode) && selection.getTextContent().length > 0;
  }
  isEmailURI() {
    return this.__url.startsWith('mailto:');
  }
  isWebSiteURI() {
    return this.__url.startsWith('https://') || this.__url.startsWith('http://');
  }
}
function $convertAnchorElement(domNode) {
  let node = null;
  if (utils.isHTMLAnchorElement(domNode)) {
    const content = domNode.textContent;
    if (content !== null && content !== '' || domNode.children.length > 0) {
      node = $createLinkNode(domNode.getAttribute('href') || '', {
        rel: domNode.getAttribute('rel'),
        target: domNode.getAttribute('target'),
        title: domNode.getAttribute('title')
      });
    }
  }
  return {
    node
  };
}

/**
 * Takes a URL and creates a LinkNode.
 * @param url - The URL the LinkNode should direct to.
 * @param attributes - Optional HTML a tag attributes \\{ target, rel, title \\}
 * @returns The LinkNode.
 */
function $createLinkNode(url = '', attributes) {
  return lexical.$applyNodeReplacement(new LinkNode(url, attributes));
}

/**
 * Determines if node is a LinkNode.
 * @param node - The node to be checked.
 * @returns true if node is a LinkNode, false otherwise.
 */
function $isLinkNode(node) {
  return node instanceof LinkNode;
}
// Custom node type to override `canInsertTextAfter` that will
// allow typing within the link
class AutoLinkNode extends LinkNode {
  /** @internal */
  /** Indicates whether the autolink was ever unlinked. **/

  constructor(url = '', attributes = {}, key) {
    super(url, attributes, key);
    this.__isUnlinked = attributes.isUnlinked !== undefined && attributes.isUnlinked !== null ? attributes.isUnlinked : false;
  }
  static getType() {
    return 'autolink';
  }
  static clone(node) {
    return new AutoLinkNode(node.__url, {
      isUnlinked: node.__isUnlinked,
      rel: node.__rel,
      target: node.__target,
      title: node.__title
    }, node.__key);
  }
  getIsUnlinked() {
    return this.__isUnlinked;
  }
  setIsUnlinked(value) {
    const self = this.getWritable();
    self.__isUnlinked = value;
    return self;
  }
  createDOM(config) {
    if (this.__isUnlinked) {
      return document.createElement('span');
    } else {
      return super.createDOM(config);
    }
  }
  updateDOM(prevNode, anchor, config) {
    return super.updateDOM(prevNode, anchor, config) || prevNode.__isUnlinked !== this.__isUnlinked;
  }
  static importJSON(serializedNode) {
    return $createAutoLinkNode().updateFromJSON(serializedNode);
  }
  updateFromJSON(serializedNode) {
    return super.updateFromJSON(serializedNode).setIsUnlinked(serializedNode.isUnlinked || false);
  }
  static importDOM() {
    // TODO: Should link node should handle the import over autolink?
    return null;
  }
  exportJSON() {
    return {
      ...super.exportJSON(),
      isUnlinked: this.__isUnlinked
    };
  }
  insertNewAfter(selection, restoreSelection = true) {
    const element = this.getParentOrThrow().insertNewAfter(selection, restoreSelection);
    if (lexical.$isElementNode(element)) {
      const linkNode = $createAutoLinkNode(this.__url, {
        isUnlinked: this.__isUnlinked,
        rel: this.__rel,
        target: this.__target,
        title: this.__title
      });
      element.append(linkNode);
      return linkNode;
    }
    return null;
  }
}

/**
 * Takes a URL and creates an AutoLinkNode. AutoLinkNodes are generally automatically generated
 * during typing, which is especially useful when a button to generate a LinkNode is not practical.
 * @param url - The URL the LinkNode should direct to.
 * @param attributes - Optional HTML a tag attributes. \\{ target, rel, title \\}
 * @returns The LinkNode.
 */
function $createAutoLinkNode(url = '', attributes) {
  return lexical.$applyNodeReplacement(new AutoLinkNode(url, attributes));
}

/**
 * Determines if node is an AutoLinkNode.
 * @param node - The node to be checked.
 * @returns true if node is an AutoLinkNode, false otherwise.
 */
function $isAutoLinkNode(node) {
  return node instanceof AutoLinkNode;
}
const TOGGLE_LINK_COMMAND = lexical.createCommand('TOGGLE_LINK_COMMAND');
function $getPointNode(point, offset) {
  if (point.type === 'element') {
    const node = point.getNode();
    if (!lexical.$isElementNode(node)) {
      formatDevErrorMessage(`$getPointNode: element point is not an ElementNode`);
    }
    const childNode = node.getChildren()[point.offset + offset];
    return childNode || null;
  }
  return null;
}

/**
 * Preserve the logical start/end of a RangeSelection in situations where
 * the point is an element that may be reparented in the callback.
 *
 * @param $fn The function to run
 * @returns The result of the callback
 */
function $withSelectedNodes($fn) {
  const initialSelection = lexical.$getSelection();
  if (!lexical.$isRangeSelection(initialSelection)) {
    return $fn();
  }
  const normalized = lexical.$normalizeSelection__EXPERIMENTAL(initialSelection);
  const isBackwards = normalized.isBackward();
  const anchorNode = $getPointNode(normalized.anchor, isBackwards ? -1 : 0);
  const focusNode = $getPointNode(normalized.focus, isBackwards ? 0 : -1);
  const rval = $fn();
  if (anchorNode || focusNode) {
    const updatedSelection = lexical.$getSelection();
    if (lexical.$isRangeSelection(updatedSelection)) {
      const finalSelection = updatedSelection.clone();
      if (anchorNode) {
        const anchorParent = anchorNode.getParent();
        if (anchorParent) {
          finalSelection.anchor.set(anchorParent.getKey(), anchorNode.getIndexWithinParent() + (isBackwards ? 1 : 0), 'element');
        }
      }
      if (focusNode) {
        const focusParent = focusNode.getParent();
        if (focusParent) {
          finalSelection.focus.set(focusParent.getKey(), focusNode.getIndexWithinParent() + (isBackwards ? 0 : 1), 'element');
        }
      }
      lexical.$setSelection(lexical.$normalizeSelection__EXPERIMENTAL(finalSelection));
    }
  }
  return rval;
}

/**
 * Generates or updates a LinkNode. It can also delete a LinkNode if the URL is null,
 * but saves any children and brings them up to the parent node.
 * @param url - The URL the link directs to.
 * @param attributes - Optional HTML a tag attributes. \\{ target, rel, title \\}
 */
function $toggleLink(url, attributes = {}) {
  const {
    target,
    title
  } = attributes;
  const rel = attributes.rel === undefined ? 'noreferrer' : attributes.rel;
  const selection = lexical.$getSelection();
  if (selection === null || !lexical.$isRangeSelection(selection) && !lexical.$isNodeSelection(selection)) {
    return;
  }
  if (lexical.$isNodeSelection(selection)) {
    const nodes = selection.getNodes();
    if (nodes.length === 0) {
      return;
    }

    // Handle all selected nodes
    nodes.forEach(node => {
      if (url === null) {
        // Remove link
        const linkParent = utils.$findMatchingParent(node, parent => !$isAutoLinkNode(parent) && $isLinkNode(parent));
        if (linkParent) {
          linkParent.insertBefore(node);
          if (linkParent.getChildren().length === 0) {
            linkParent.remove();
          }
        }
      } else {
        // Add/Update link
        const existingLink = utils.$findMatchingParent(node, parent => !$isAutoLinkNode(parent) && $isLinkNode(parent));
        if (existingLink) {
          existingLink.setURL(url);
          if (target !== undefined) {
            existingLink.setTarget(target);
          }
          if (rel !== undefined) {
            existingLink.setRel(rel);
          }
        } else {
          const linkNode = $createLinkNode(url, {
            rel,
            target
          });
          node.insertBefore(linkNode);
          linkNode.append(node);
        }
      }
    });
    return;
  }

  // Handle RangeSelection
  const nodes = selection.extract();
  if (url === null) {
    // Remove LinkNodes
    nodes.forEach(node => {
      const parentLink = utils.$findMatchingParent(node, parent => !$isAutoLinkNode(parent) && $isLinkNode(parent));
      if (parentLink) {
        const children = parentLink.getChildren();
        for (let i = 0; i < children.length; i++) {
          parentLink.insertBefore(children[i]);
        }
        parentLink.remove();
      }
    });
    return;
  }
  const updatedNodes = new Set();
  const updateLinkNode = linkNode => {
    if (updatedNodes.has(linkNode.getKey())) {
      return;
    }
    updatedNodes.add(linkNode.getKey());
    linkNode.setURL(url);
    if (target !== undefined) {
      linkNode.setTarget(target);
    }
    if (rel !== undefined) {
      linkNode.setRel(rel);
    }
    if (title !== undefined) {
      linkNode.setTitle(title);
    }
  };
  // Add or merge LinkNodes
  if (nodes.length === 1) {
    const firstNode = nodes[0];
    // if the first node is a LinkNode or if its
    // parent is a LinkNode, we update the URL, target and rel.
    const linkNode = $getAncestor(firstNode, $isLinkNode);
    if (linkNode !== null) {
      return updateLinkNode(linkNode);
    }
  }
  $withSelectedNodes(() => {
    let linkNode = null;
    for (const node of nodes) {
      if (!node.isAttached()) {
        continue;
      }
      const parentLinkNode = $getAncestor(node, $isLinkNode);
      if (parentLinkNode) {
        updateLinkNode(parentLinkNode);
        continue;
      }
      if (lexical.$isElementNode(node)) {
        if (!node.isInline()) {
          // Ignore block nodes, if there are any children we will see them
          // later and wrap in a new LinkNode
          continue;
        }
        if ($isLinkNode(node)) {
          // If it's not an autolink node and we don't already have a LinkNode
          // in this block then we can update it and re-use it
          if (!$isAutoLinkNode(node) && (linkNode === null || !linkNode.getParentOrThrow().isParentOf(node))) {
            updateLinkNode(node);
            linkNode = node;
            continue;
          }
          // Unwrap LinkNode, we already have one or it's an AutoLinkNode
          for (const child of node.getChildren()) {
            node.insertBefore(child);
          }
          node.remove();
          continue;
        }
      }
      const prevLinkNode = node.getPreviousSibling();
      if ($isLinkNode(prevLinkNode) && prevLinkNode.is(linkNode)) {
        prevLinkNode.append(node);
        continue;
      }
      linkNode = $createLinkNode(url, {
        rel,
        target,
        title
      });
      node.insertAfter(linkNode);
      linkNode.append(node);
    }
  });
}
/** @deprecated renamed to {@link $toggleLink} by @lexical/eslint-plugin rules-of-lexical */
const toggleLink = $toggleLink;
function $getAncestor(node, predicate) {
  let parent = node;
  while (parent !== null && parent.getParent() !== null && !predicate(parent)) {
    parent = parent.getParentOrThrow();
  }
  return predicate(parent) ? parent : null;
}
const PHONE_NUMBER_REGEX = /^\+?[0-9\s()-]{5,}$/;

/**
 * Formats a URL string by adding appropriate protocol if missing
 *
 * @param url - URL to format
 * @returns Formatted URL with appropriate protocol
 */
function formatUrl(url) {
  // Check if URL already has a protocol
  if (url.match(/^[a-z][a-z0-9+.-]*:/i)) {
    // URL already has a protocol, leave it as is
    return url;
  }
  // Check if it's a relative path (starting with '/', '.', or '#')
  else if (url.match(/^[/#.]/)) {
    // Relative path, leave it as is
    return url;
  }

  // Check for email address
  else if (url.includes('@')) {
    return `mailto:${url}`;
  }

  // Check for phone number
  else if (PHONE_NUMBER_REGEX.test(url)) {
    return `tel:${url}`;
  }

  // For everything else, return with https:// prefix
  return `https://${url}`;
}

exports.$createAutoLinkNode = $createAutoLinkNode;
exports.$createLinkNode = $createLinkNode;
exports.$isAutoLinkNode = $isAutoLinkNode;
exports.$isLinkNode = $isLinkNode;
exports.$toggleLink = $toggleLink;
exports.AutoLinkNode = AutoLinkNode;
exports.LinkNode = LinkNode;
exports.TOGGLE_LINK_COMMAND = TOGGLE_LINK_COMMAND;
exports.formatUrl = formatUrl;
exports.toggleLink = toggleLink;
