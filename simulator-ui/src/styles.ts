export const globalStyles = `
:root,
html,
body,
#root {
  height: 100%;
}
:root {
  color-scheme: light;
  font-family: "SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --color-bg: #f6f7fb;
  --color-surface: #ffffff;
  --color-surface-muted: #f8fafc;
  --color-surface-subtle: #f1f5f9;
  --color-surface-dark: #5c626d;
  --color-surface-dark-border: #4b515b;
  --color-text-on-dark: #f1f3f6;
  --color-text-on-dark-muted: #d2d6dc;
  --color-border: #e2e8f0;
  --color-border-strong: #cbd5e1;
  --color-border-emphasis: #94a3b8;
  --color-text: #0f172a;
  --color-text-strong: #111827;
  --color-text-body: #334155;
  --color-text-muted: #475569;
  --color-text-subtle: #64748b;
  --color-primary: #0b93f6;
  --color-primary-strong: #0a7fd3;
  --color-primary-dark: #1d4ed8;
  --color-primary-soft: #dbeafe;
  --color-primary-alpha-15: rgba(11, 147, 246, 0.15);
  --color-primary-alpha-25: rgba(11, 147, 246, 0.25);
  --color-primary-ring: rgba(11, 147, 246, 0.15);
  --color-accent: #4338ca;
  --color-accent-soft: #e0e7ff;
  --color-accent-border: #c7d2fe;
  --color-accent-on-dark: #cfd6ff;
  --color-success: #0f9d58;
  --color-success-strong: #16a34a;
  --color-success-soft: #dcfce7;
  --color-warning: #b45309;
  --color-warning-border: #f59e0b;
  --color-warning-soft: #fef3c7;
  --color-warning-soft-alt: #fffbeb;
  --color-danger: #b91c1c;
  --color-danger-strong: #dc2626;
  --color-danger-soft: #fee2e2;
  --color-ink-weak: rgba(0, 0, 0, 0.04);
  --color-ink-soft: rgba(0, 0, 0, 0.06);
  --color-shadow-soft: rgba(15, 23, 42, 0.06);
  --color-shadow-strong: rgba(15, 23, 42, 0.12);
  --color-shadow-border: rgba(15, 23, 42, 0.25);
  --color-overlay: rgba(15, 23, 42, 0.4);
  --color-text-on-primary-subtle: rgba(255, 255, 255, 0.9);
  --color-text-on-primary-muted: rgba(255, 255, 255, 0.7);
  --corner-radius-scale: 1;
}
@supports (corner-shape: squircle) {
  :root {
    --corner-radius-scale: 2;
  }
}
*,
*::before,
*::after {
  box-sizing: border-box;
}
body {
  margin: 0;
  background: var(--color-bg);
  overflow: hidden;
}
:where(input, textarea, select, button):focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--color-accent) inset;
}
.app-root {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.page-shell {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.app-shell {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 16px;
  gap: 16px;
  overflow: hidden;
}
.page-grid {
  flex: 1;
  display: grid;
  gap: 16px;
  min-height: 0;
  overflow: hidden;
}
.panel,
.editor-panel {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: calc(var(--panel-radius, 14px) * var(--corner-radius-scale, 1));
  corner-shape: squircle;
  padding: var(--panel-padding, 12px);
  min-height: 0;
  overflow: hidden;
}
.docs-shell {
  padding: 32px 20px 64px;
  max-width: 1040px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 28px;
}
.docs-eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.16em;
  font-size: 11px;
  font-weight: 700;
  color: var(--color-text-subtle);
  margin: 0 0 10px 0;
}
.docs-subtitle {
  text-wrap: pretty;
}
.docs-hero h1 {
  margin: 0 0 12px 0;
  font-size: clamp(28px, 4vw, 40px);
  line-height: 1.2;
  color: var(--color-text);
}
.docs-lede {
  margin: 0;
  font-size: 16px;
  max-width: 720px;
  color: var(--color-text-body);
}
.docs-callout {
  background: var(--color-surface);
  border-radius: calc(18px * var(--corner-radius-scale, 1));
  corner-shape: squircle;
  border: 1px solid var(--color-border);
  padding: 20px;
  box-shadow: 0 10px 30px var(--color-shadow-soft);
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.docs-callout-header {
  display: flex;
  gap: 14px;
  align-items: flex-start;
}
.docs-callout-header h2 {
  margin: 0 0 4px 0;
  font-size: 22px;
}
.docs-subtle {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 14px;
}
.docs-callout-body h3 {
  margin: 0 0 8px 0;
  font-size: 16px;
}
.docs-callout-body p {
  margin: 0 0 12px 0;
  color: var(--color-text-body);
}
.docs-callout-body ul {
  margin: 0 0 12px 18px;
  color: var(--color-text-body);
  padding: 0;
}
.docs-callout-body li {
  margin-bottom: 6px;
}
.docs-divider {
  height: 1px;
  background: var(--color-border);
  margin: 8px 0 12px;
}
.docs-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.docs-section-header {
  display: flex;
  align-items: center;
  gap: 10px;
}
.docs-section-header h2 {
  margin: 0;
  font-size: 22px;
}
.docs-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
}
.docs-loop {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 14px;
}
.docs-loop-step {
  border-radius: calc(16px * var(--corner-radius-scale, 1));
  corner-shape: squircle;
  border: 1px solid var(--color-border);
  background: var(--color-surface-muted);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.docs-loop-step h3 {
  margin: 0;
  font-size: 16px;
}
.docs-loop-step p {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 14px;
}
.docs-step-badge {
  align-self: flex-start;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--color-primary-soft);
  color: var(--color-primary-dark);
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.docs-tabs .docs-tab-card {
  background: var(--color-surface);
  border-radius: calc(16px * var(--corner-radius-scale, 1));
  corner-shape: squircle;
  border: 1px solid var(--color-border);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.docs-tab-row {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 14px;
  align-items: center;
}
.docs-tab-row p {
  margin: 0;
  color: var(--color-text-body);
}
.docs-tab-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px 12px;
  border-radius: calc(10px * var(--corner-radius-scale, 1));
  corner-shape: squircle;
  background: var(--color-primary-soft);
  color: var(--color-primary-dark);
  font-weight: 700;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  text-decoration: none;
  border: none;
  cursor: pointer;
}
.docs-tab-pill--gold {
  background: var(--color-warning-soft);
  color: var(--color-warning);
}
.docs-tab-pill--indigo {
  background: var(--color-accent-soft);
  color: var(--color-accent);
}
.docs-links h3 {
  margin: 0 0 8px 0;
}
.docs-links ul {
  margin: 0;
  padding-left: 18px;
}
.docs-links li {
  margin-bottom: 6px;
}
@media (max-width: 720px) {
  .docs-tab-row {
    grid-template-columns: 1fr;
    align-items: flex-start;
  }
}
pre.deck-preview,
pre.docs-command {
  background: var(--color-ink-weak);
  border-radius: calc(8px * var(--corner-radius-scale, 1));
  corner-shape: squircle;
  padding: 12px 16px;
}
code:not(pre *) {
  background: var(--color-ink-soft);
  padding: 4px;
  border-radius: calc(4px * var(--corner-radius-scale, 1));
  corner-shape: squircle;
}
.app-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}
.app-header h1 {
  margin: 0;
  font-size: 24px;
}
.deck-path {
  font-family: monospace;
  font-size: 13px;
  color: var(--color-text-muted);
  word-break: break-all;
}
.header-actions {
  display: flex;
  gap: 12px;
  align-items: center;
}
.header-actions button {
  border: 1px solid var(--color-border-strong);
  border-radius: calc(10px * var(--corner-radius-scale, 1));
  corner-shape: squircle;
  padding: 8px 14px;
  background: var(--color-surface);
  cursor: pointer;
  font-weight: 600;
}
.copy-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px dashed var(--color-border-strong);
  border-radius: 999px;
  padding: 4px 10px;
  background: var(--color-surface-muted);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  color: var(--color-text);
  transition: background 120ms ease, border-color 120ms ease;
}
.copy-badge code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 12px;
  color: var(--color-text);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.copy-badge .copy-label {
  font-weight: 600;
  color: var(--color-text-muted);
}
.copy-badge .copy-feedback {
  font-size: 11px;
  color: var(--color-success);
}
.copy-badge:hover {
  background: var(--color-border);
  border-color: var(--color-border-emphasis);
}
.copy-badge.copied {
  border-color: var(--color-success);
  background: var(--color-success-soft);
}
.status-indicator {
  text-transform: capitalize;
  font-size: 13px;
  color: var(--color-text-muted);
}
.status-indicator.connected {
  color: var(--color-success);
}
.app-main {
  grid-template-columns: 2fr 1fr;
}
.chat-column {
  --panel-radius: 16px;
  --panel-padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  overflow-y: auto;
}
.calibrate-shell .calibrate-layout {
  grid-template-columns: 280px minmax(0, 1fr) 320px;
  width: 100%;
  min-height: 0;
}
@media (max-width: 1100px) {
  .calibrate-shell .calibrate-layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .calibrate-shell .calibrate-layout .calibrate-drawer {
    position: static;
    max-height: none;
  }
}
.calibrate-shell .calibrate-runner {
  flex: 0 0 auto;
}
.calibrate-shell .calibrate-results {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.calibrate-run-card {
  border: 1px solid var(--color-border);
  border-radius: calc(14px * var(--corner-radius-scale, 1));
  corner-shape: squircle;
  background: var(--color-surface);
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
}
.calibrate-run-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  cursor: pointer;
}
.calibrate-run-header:hover .calibrate-run-toggle-icon {
  background: var(--color-surface-subtle);
}
.calibrate-run-header.active:hover .calibrate-run-toggle-icon {
  background: var(--color-primary-alpha-25);
}
.calibrate-run-title {
  font-weight: 700;
}
.calibrate-run-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.calibrate-run-subtitle {
  color: var(--color-text-muted);
  font-size: 12px;
  text-transform: capitalize;
}
.calibrate-run-turns {
  display: flex;
  align-items: center;
  gap: 6px;
}
.calibrate-run-turn {
  width: 16px;
  height: 16px;
  border-radius: calc(5px * var(--corner-radius-scale, 1));
  corner-shape: squircle;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.calibrate-run-turn--pending {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--color-border);
}
.calibrate-run-turn--empty {
  background: var(--color-surface-subtle);
  border: 1px solid var(--color-border);
}
.calibrate-run-toggle-icon {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: flex;
  justify-content: center;
  align-items: center;
  background: transparent;
  color: currentColor;
  transition: background 120ms ease, color 120ms ease, transform 200ms ease;
}
.calibrate-run-header.active .calibrate-run-toggle-icon {
  color: var(--color-primary);
  background: var(--color-primary-alpha-15);
  transform: rotate(180deg);
}
.calibrate-spinner {
  width: 16px;
  height: 16px;
  border-radius: 999px;
  border: 2px solid var(--color-shadow-border);
  border-top-color: var(--color-primary);
  animation: calibrate-spin 0.9s linear infinite;
}
.calibrate-spinner--tiny {
  width: 10px;
  height: 10px;
  border-width: 2px;
}
@keyframes calibrate-spin {
  to {
    transform: rotate(360deg);
  }
}
.calibrate-run-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.calibrate-run-section {
  border-top: 1px solid var(--color-border);
  padding-top: 12px;
}
.calibrate-run-section:first-child {
  border-top: none;
  padding-top: 0;
}
.calibrate-button-meta {
  font-size: 12px;
  text-wrap: pretty;
  margin: 0;
  margin-bottom: 0.5em;
}
.calibrate-drawer {
  --panel-radius: 16px;
  --panel-padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  position: sticky;
  top: 24px;
  max-height: calc(100vh - 48px);
  overflow-y: auto;
}
.calibrate-drawer h3 {
  margin: 0;
  font-size: 16px;
}
.drawer-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--color-border);
}
.drawer-section:first-of-type {
  border-top: none;
  padding-top: 0;
}
.drawer-meta {
  font-size: 13px;
  color: var(--color-text-muted);
}
.calibrate-summary-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.calibrate-summary-card {
  border: 1px solid var(--color-border);
  border-radius: calc(12px * var(--corner-radius-scale, 1));
  corner-shape: squircle;
  padding: 8px;
  background: var(--color-surface-muted);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.calibrate-summary-score-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.calibrate-summary-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--color-text);
}
.calibrate-summary-subtitle {
  font-size: 11px;
  color: var(--color-text-muted);
}
.ellipsis {
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
}
.gds-scrolling-text {
  display: block;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
  vertical-align: bottom;
}
.gds-scrolling-text__inner {
  display: block;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  will-change: transform;
}
.gds-scrolling-text--overflow:hover {
  overflow: hidden;
}
.gds-scrolling-text--overflow:hover .gds-scrolling-text__inner {
  width: max-content;
  max-width: none;
  overflow: visible;
  text-overflow: clip;
  animation: gds-scroll-text var(--gds-scroll-duration, 0s) linear forwards;
}
@keyframes gds-scroll-text {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(calc(-1 * var(--gds-scroll-distance, 0px)));
  }
}
@media (prefers-reduced-motion: reduce) {
  .gds-scrolling-text--overflow:hover .gds-scrolling-text__inner {
    animation: none;
    transform: translateX(0);
  }
}
.calibrate-summary-reason {
  font-size: 12px;
  color: var(--color-text);
}
.calibrate-summary-meta {
  font-size: 11px;
  color: var(--color-text-subtle);
}
.chat-row {
  display: flex;
  justify-content: flex-start;
}
.bubble {
  background: var(--color-surface-subtle);
  border-radius: calc(16px * var(--corner-radius-scale, 1));
  corner-shape: squircle;
  padding: 12px;
  width: 100%;
  box-shadow: inset 0 0 0 1px var(--color-border);
}
.bubble-user {
  background: var(--color-primary);
  color: var(--color-surface);
  box-shadow: none;
}
.bubble-role {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-border-emphasis);
  margin-bottom: 6px;
}
.bubble-user .bubble-role {
  color: var(--color-text-on-primary-muted);
}
.bubble-text {
  line-height: 1.5;
}
.bubble-json {
  background: var(--color-ink-weak);
  padding: 8px;
  border-radius: calc(8px * var(--corner-radius-scale, 1));
  corner-shape: squircle;
  font-size: 12px;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
}
.feedback-controls {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  opacity: 0.25;
  transition: opacity 120ms ease-in-out;
}
.bubble:hover .feedback-controls,
.feedback-controls:focus-within {
  opacity: 1;
}
.imessage-bubble:hover .feedback-controls {
  opacity: 1;
}
.feedback-scores {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.score-button {
  border: 1px solid var(--color-border-strong);
  background: var(--color-surface);
  border-radius: calc(8px * var(--corner-radius-scale, 1));
  corner-shape: squircle;
  padding: 4px 10px;
  cursor: pointer;
  font-size: 12px;
}
.score-button-active {
  background: var(--color-primary);
  color: var(--color-surface);
  border-color: var(--color-primary);
}
.feedback-reason {
  width: 100%;
  min-height: 48px;
  border-radius: calc(10px * var(--corner-radius-scale, 1));
  corner-shape: squircle;
  border: 1px solid var(--color-border-strong);
  padding: 8px;
  resize: vertical;
  box-sizing: border-box;
  font-family: inherit;
}
.feedback-meta {
  font-size: 11px;
  color: var(--color-text-muted);
}
.feedback-status {
  font-size: 11px;
  color: var(--color-border-emphasis);
}
.feedback-status.saving {
  color: var(--color-primary);
}
.feedback-status.unsaved {
  color: var(--color-warning);
}
.init-panel {
  border: 1px solid var(--color-border);
  border-radius: calc(14px * var(--corner-radius-scale, 1));
  corner-shape: squircle;
  background: var(--color-surface-muted);
  padding: 12px;
  margin-bottom: 12px;
}
.init-panel summary {
  cursor: pointer;
  font-weight: 700;
  color: var(--color-text);
}
.init-panel .hint {
  margin-top: 6px;
  font-size: 12px;
  color: var(--color-text-muted);
}
.init-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
  margin-top: 10px;
}
.init-field {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: calc(12px * var(--corner-radius-scale, 1));
  corner-shape: squircle;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.init-field label {
  font-weight: 700;
  color: var(--color-text-strong);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.badge {
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--color-border);
  color: var(--color-text-muted);
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
}
.badge--idle {
  background: var(--color-border);
  color: var(--color-text-muted);
}
.badge--running {
  background: var(--color-primary-soft);
  color: var(--color-primary-dark);
}
.badge--completed {
  background: var(--color-success-soft);
  color: var(--color-success);
}
.badge--error {
  background: var(--color-danger-soft);
  color: var(--color-danger);
}
.badge--canceled {
  background: var(--color-warning-soft);
  color: var(--color-warning);
}
.badge--ghost {
  background: transparent;
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
}
.init-field input,
.init-field select,
.init-field textarea {
  width: 100%;
  border: 1px solid var(--color-border-strong);
  border-radius: calc(10px * var(--corner-radius-scale, 1));
  corner-shape: squircle;
  padding: 8px;
  box-sizing: border-box;
  font-family: inherit;
}
.init-field textarea {
  min-height: 80px;
  resize: vertical;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
}
.init-summary-json {
  margin-top: 10px;
  background: var(--color-shadow-soft);
  border-radius: calc(12px * var(--corner-radius-scale, 1));
  corner-shape: squircle;
  padding: 10px;
  overflow-x: auto;
  font-size: 12px;
}
.init-missing {
  margin-top: 8px;
  font-size: 12px;
  color: var(--color-danger);
}
.init-controls {
  margin-top: 10px;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}
.secondary-note {
  font-size: 12px;
  color: var(--color-text-muted);
}
.trace-panel {
  background: var(--color-surface);
  border-radius: calc(16px * var(--corner-radius-scale, 1));
  corner-shape: squircle;
  padding: 16px;
  border: 1px solid var(--color-border);
  min-height: 0;
  overflow-y: auto;
}
.trace-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}
.trace-row {
  border: 1px solid var(--color-border);
  border-radius: calc(10px * var(--corner-radius-scale, 1));
  corner-shape: squircle;
  padding: 8px;
  background: var(--color-surface-muted);
  word-break: break-word;
  overflow-wrap: anywhere;
}
.calibrate-result-header {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.calibrate-result-main {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.calibrate-score-badge {
  min-width: 44px;
  height: 44px;
  border-radius: calc(12px * var(--corner-radius-scale, 1));
  corner-shape: squircle;
  background: var(--color-border);
  color: var(--color-text);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: 700;
}
.calibrate-score-badge--small {
  min-width: 22px;
  height: 20px;
  border-radius: calc(8px * var(--corner-radius-scale, 1));
  corner-shape: squircle;
  font-size: 12px;
}
.calibrate-score-badge--pending {
  background: var(--color-surface-subtle);
  color: var(--color-text);
}
.calibrate-score--positive {
  background: var(--color-success-strong);
  color: var(--color-surface);
}
.calibrate-score--negative {
  background: var(--color-danger-strong);
  color: var(--color-surface);
}
.calibrate-score--neutral {
  background: var(--color-text-subtle);
  color: var(--color-surface);
}
.calibrate-score--empty {
  background: var(--color-border);
  color: var(--color-text);
}
.calibrate-result-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.calibrate-result-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 700;
}
.calibrate-result-subtitle {
  font-size: 12px;
  color: var(--color-text-muted);
}
.calibrate-score-chip {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 2px 8px;
  margin-left: 6px;
  background: var(--color-border);
  color: var(--color-text);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
}
.calibrate-delta-chip {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 2px 8px;
  margin-left: 6px;
  background: var(--color-text);
  color: var(--color-surface);
  font-size: 11px;
  font-weight: 700;
}
.calibrate-alert-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  padding: 2px 8px;
  margin-left: 6px;
  background: var(--color-danger-strong);
  color: var(--color-surface);
  font-size: 11px;
  font-weight: 700;
}
.calibrate-result-reason {
  font-size: 13px;
  color: var(--color-text);
}
.calibrate-result-secondary {
  font-size: 12px;
  color: var(--color-text-subtle);
}
.calibrate-result-meta-line {
  font-size: 12px;
  color: var(--color-text-subtle);
  margin-bottom: 6px;
}
.calibrate-reference-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}
.calibrate-reference-form label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-muted);
}
.calibrate-reference-form select,
.calibrate-reference-form textarea {
  border: 1px solid var(--color-border-strong);
  border-radius: calc(10px * var(--corner-radius-scale, 1));
  corner-shape: squircle;
  padding: 6px 8px;
  font-family: inherit;
  font-size: 12px;
}
.calibrate-reference-form textarea {
  min-height: 80px;
  resize: vertical;
}
.calibrate-reference-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.calibrate-reference-form .primary {
  align-self: flex-start;
}
.calibrate-context {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.calibrate-context-compact {
  margin-top: 8px;
}
.calibrate-context-row {
  border: 1px solid var(--color-border);
  border-radius: calc(10px * var(--corner-radius-scale, 1));
  corner-shape: squircle;
  padding: 8px;
  background: var(--color-surface-muted);
}
.calibrate-context-label {
  font-size: 11px;
  font-weight: 700;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.02em;
}
.calibrate-context-bubble {
  margin-top: 6px;
  font-size: 13px;
  color: var(--color-text);
  padding: 8px 10px;
  border-radius: calc(12px * var(--corner-radius-scale, 1));
  corner-shape: squircle;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
}
.calibrate-context-user {
  background: var(--color-primary-soft);
  border-color: var(--color-primary-alpha-25);
  color: var(--color-text);
}
.calibrate-context-assistant {
  background: var(--color-surface-subtle);
  border-color: var(--color-border);
}
.calibrate-score-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.score-btn {
  border: 1px solid var(--color-border-strong);
  border-radius: calc(10px * var(--corner-radius-scale, 1));
  corner-shape: squircle;
  padding: 6px 10px;
  background: var(--color-surface);
  cursor: pointer;
  font-weight: 600;
  font-size: 12px;
  color: var(--color-text);
}
.score-btn-active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: var(--color-surface);
}
.calibrate-result-details {
  margin-top: 10px;
  display: grid;
  gap: 10px;
}
.calibrate-ref-copy {
  padding: 4px 8px;
  font-size: 11px;
}
.trace-row-highlight {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px var(--color-primary-ring);
}
.calibrate-section-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.02em;
  margin-bottom: 4px;
}
.calibrate-review-panel {
  border: 1px solid var(--color-border);
  border-radius: calc(12px * var(--corner-radius-scale, 1));
  corner-shape: squircle;
  padding: 10px;
  background: var(--color-surface-muted);
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}
.calibrate-review-reference {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.calibrate-toggle {
  padding: 6px 10px;
  font-size: 12px;
}
.calibrate-result-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.calibrate-flag-reason {
  margin-top: 8px;
}
.calibrate-flag-reason label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-muted);
}
.calibrate-flag-reason textarea {
  border: 1px solid var(--color-border-strong);
  border-radius: calc(10px * var(--corner-radius-scale, 1));
  corner-shape: squircle;
  padding: 6px 8px;
  font-family: inherit;
  font-size: 12px;
  min-height: 70px;
  resize: vertical;
}
.trace-row-user {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: var(--color-surface);
}
.trace-row-user .trace-json {
  color: var(--color-text-on-primary-subtle);
}
.trace-json {
  font-size: 11px;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
}
.tool-call-row .imessage-bubble {
  background: var(--color-surface-dark);
  border: 1px solid var(--color-surface-dark-border);
  color: var(--color-text-on-dark);
}
.tool-call-bubble {
  width: 100%;
}
.tool-call-collapse {
  width: 100%;
  border: none;
  background: none;
  padding: 0;
  text-align: left;
  cursor: pointer;
  font: inherit;
  color: inherit;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.tool-call-collapse:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}
.tool-call-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.tool-call-title {
  font-size: 13px;
}
.tool-call-status {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--color-text-muted);
}
.tool-call-status.status-completed {
  color: var(--color-success);
}
.tool-call-status.status-error {
  color: var(--color-danger);
}
.tool-call-status.status-running {
  color: var(--color-primary);
}
.tool-call-handled {
  font-size: 11px;
  font-weight: 700;
  color: var(--color-warning);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border: 1px solid var(--color-warning-border);
  border-radius: 999px;
  padding: 2px 8px;
  background: var(--color-warning-soft-alt);
}
.tool-call-id {
  font-size: 11px;
  color: var(--color-text-muted);
  word-break: break-word;
}
.tool-call-expand {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-accent-on-dark);
}
.tool-call-detail {
  margin-top: 8px;
  border-top: 1px solid var(--color-accent-border);
  padding-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.tool-call-divider {
  border-top: 1px solid var(--color-border);
  margin: 2px 0;
}
.tool-call-field {
  display: flex;
  flex-direction: column;
}
.tool-call-field-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-on-dark-muted);
  margin-bottom: 4px;
}
.tool-call-error {
  color: var(--color-danger);
}
.tool-calls-collapsible {
  margin: 8px 0;
}
.tool-calls-toggle {
  width: 100%;
  border: none;
  background: transparent;
  padding: 8px 0;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--color-text-muted);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.tool-calls-toggle::before,
.tool-calls-toggle::after {
  content: "";
  flex: 1;
  border-top: 1px solid var(--color-border);
}
.tool-calls-toggle-label {
  white-space: nowrap;
}
.tool-calls-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 6px;
}
.composer {
  background: var(--color-surface);
  padding: 12px;
  border-radius: calc(16px * var(--corner-radius-scale, 1));
  corner-shape: squircle;
  border: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.composer-inputs {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.message-input {
  width: 100%;
  border-radius: calc(10px * var(--corner-radius-scale, 1));
  corner-shape: squircle;
  border: 1px solid var(--color-border-strong);
  padding: 10px;
  resize: vertical;
  font-family: inherit;
  box-sizing: border-box;
}
.notes-inline {
  flex: 1;
  min-width: 220px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.notes-inline header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.notes-inline label {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
}
.notes-inline textarea {
  width: 100%;
  min-height: 80px;
  border-radius: calc(10px * var(--corner-radius-scale, 1));
  corner-shape: squircle;
  border: 1px solid var(--color-border-strong);
  padding: 10px;
  resize: vertical;
  font-family: inherit;
  box-sizing: border-box;
}
.notes-inline-status {
  font-size: 12px;
  color: var(--color-text-muted);
}
.notes-inline-status .state {
  font-weight: 600;
}
.notes-inline-status .state.saving {
  color: var(--color-primary);
}
.notes-inline-status .state.unsaved {
  color: var(--color-warning);
}
.notes-inline-status .state.idle {
  color: var(--color-border-emphasis);
}
.notes-inline-status .state.saved {
  color: var(--color-success);
}
.rating-controls {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  align-items: center;
}
.rating-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
}
.rating-status {
  font-size: 12px;
  color: var(--color-text-muted);
}
.rating-button {
  border: 1px solid var(--color-border-strong);
  border-radius: calc(8px * var(--corner-radius-scale, 1));
  corner-shape: squircle;
  padding: 4px 10px;
  font-size: 12px;
  background: var(--color-surface);
  cursor: pointer;
}
.rating-button.active {
  background: var(--color-primary);
  color: var(--color-surface);
  border-color: var(--color-primary);
}
.composer-actions {
  display: flex;
  gap: 10px;
}
.composer-actions button {
  padding: 10px 18px;
  border-radius: calc(10px * var(--corner-radius-scale, 1));
  corner-shape: squircle;
  border: none;
  background: var(--color-primary);
  color: var(--color-surface);
  font-weight: 600;
  cursor: pointer;
}
.reset-note {
  font-size: 12px;
  color: var(--color-warning);
}
.error {
  color: var(--color-danger);
  font-size: 13px;
}
.session-meta {
  font-size: 12px;
  color: var(--color-text-muted);
}
.session-link {
  color: var(--color-primary);
  text-decoration: none;
}
.session-link:hover {
  text-decoration: underline;
}
.session-path code {
  display: inline-block;
  word-break: break-all;
}
.sessions-drawer {
  position: fixed;
  inset: 0;
  display: flex;
  z-index: 1000;
}
.sessions-drawer-panel {
  width: min(360px, 90vw);
  background: var(--color-surface);
  border-right: 1px solid var(--color-border);
  box-shadow: 12px 0 30px var(--color-shadow-strong);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.sessions-drawer-panel header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.sessions-drawer-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.sessions-drawer-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sessions-drawer-backdrop {
  flex: 1;
  border: 0;
  padding: 0;
  background: var(--color-overlay);
  cursor: pointer;
}
.sessions-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sessions-list li {
  display: flex;
  gap: 8px;
  align-items: center;
}
.session-select-button {
  width: 100%;
  text-align: left;
  border: 0;
  border-radius: calc(8px * var(--corner-radius-scale, 1));
  corner-shape: squircle;
  padding: 8px 10px;
  background: transparent;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-family: inherit;
  box-sizing: border-box;
}
.session-select-button.active {
  background: var(--color-border);
}
.session-select-button:hover {
  background: var(--color-surface-subtle);
}
.session-select-button strong {
  font-weight: 600;
  font-size: 14px;
  color: var(--color-text);
}
.session-select-button span {
  font-size: 12px;
  color: var(--color-text-subtle);
}
.session-select-button code {
  font-size: 12px;
  color: var(--color-text-subtle);
}
.session-delete-button {
  width: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: calc(8px * var(--corner-radius-scale, 1));
}
.session-delete-button svg {
  display: block;
  min-width: 14px;
}
.trace-empty, .empty-state {
  padding: 12px;
  color: var(--color-text-muted);
  text-align: center;
}
.recent-sessions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}
.recent-session-button {
  border: 1px solid var(--color-border-strong);
  border-radius: calc(10px * var(--corner-radius-scale, 1));
  corner-shape: squircle;
  padding: 10px;
  background: var(--color-surface-muted);
  text-align: left;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.recent-session-button:hover {
  background: var(--color-border);
}
.empty-state-actions {
  margin-top: 12px;
  display: flex;
  justify-content: center;
  gap: 10px;
  flex-wrap: wrap;
}
.top-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  position: sticky;
  top: 0;
  z-index: 10;
  flex-wrap: wrap;
}
.top-nav-left {
  display: flex;
  align-items: center;
  gap: 8px;
}
.top-nav-buttons {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  flex: 1;
}
.top-nav-center {
  flex: 0 1 auto;
  display: flex;
  justify-content: center;
  min-width: 160px;
}
.top-nav-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  flex: 1;
  justify-content: flex-end;
}
.top-nav-deck {
  font-weight: 600;
  color: var(--color-text);
  font-size: 16px;
}
.top-nav-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}
.sessions-toggle {
  gap: 8px;
}
.hamburger-icon {
  width: 18px;
  height: 12px;
  display: inline-flex;
  flex-direction: column;
  justify-content: space-between;
}
.hamburger-icon span {
  display: block;
  height: 2px;
  width: 100%;
  background: var(--color-text);
  border-radius: calc(2px * var(--corner-radius-scale, 1));
  corner-shape: squircle;
}
.sessions-toggle-label {
  font-size: 13px;
  font-weight: 600;
}
.top-nav-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: flex-end;
  text-align: right;
  max-width: 100%;
}
.nav-session-path {
  font-family: monospace;
  font-size: 12px;
  color: var(--color-text-muted);
  word-break: break-all;
}
.bundle-stamp {
  font-size: 12px;
  color: var(--color-text-muted);
  background: var(--color-surface-subtle);
  border: 1px solid var(--color-border);
  border-radius: 999px;
  padding: 4px 10px;
}
.panel-tabs {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.panel-tab {
  border: 1px solid var(--color-border-strong);
  background: var(--color-surface-muted);
  border-radius: calc(10px * var(--corner-radius-scale, 1));
  corner-shape: squircle;
  padding: 8px 12px;
  cursor: pointer;
  font-weight: 600;
}
.panel-tab.active {
  background: var(--color-primary);
  color: var(--color-surface);
  border-color: var(--color-primary);
}
.editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.editor-title {
  margin: 0;
  font-size: 22px;
}
.editor-title-meta {
  margin-left: 8px;
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text-subtle);
}
.editor-status {
  font-size: 12px;
  color: var(--color-text-muted);
}
.editor-main {
  grid-template-columns: 280px 1fr 340px;
  min-height: 0;
  overflow: hidden;
}
.test-bot-sidebar {
  overflow-y: auto;
}
.flex-row {
  display: flex;
  flex-direction: row;
}
.flex-column {
  display: flex;
  flex-direction: column;
}
.flex-1 {
  flex: 1;
}
.items-center {
  align-items: center;
}
.items-baseline {
  align-items: baseline;
}
.gap-4 {
  gap: 4px;
}
.gap-6 {
  gap: 6px;
}
.gap-8 {
  gap: 8px;
}
.row-reverse {
  flex-direction: row-reverse;
}
.wrap {
  flex-wrap: wrap;
}
.gds-listbox {
  position: relative;
}
.gds-listbox-field-label {
  font-weight: 600;
  font-size: 13px;
  color: var(--color-text);
  margin-bottom: 6px;
  display: inline-flex;
}
.gds-listbox-trigger {
  width: 100%;
  border-radius: calc(10px * var(--corner-radius-scale, 1));
  corner-shape: squircle;
  border: 1px solid var(--color-border-strong);
  padding: 8px 30px 8px 10px;
  font-family: inherit;
  background: var(--color-surface);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
  text-align: left;
  position: relative;
}
.gds-listbox-trigger:hover {
  border-color: var(--color-border-emphasis);
  background: var(--color-surface-muted);
}
.gds-listbox-trigger:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.gds-listbox-label {
  font-weight: 600;
  font-size: 14px;
  color: var(--color-text);
}
.gds-listbox-meta {
  font-size: 12px;
  color: var(--color-text-subtle);
}
.gds-listbox-caret {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 12px;
  color: var(--color-text-subtle);
}
.gds-listbox-popover {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: calc(12px * var(--corner-radius-scale, 1));
  corner-shape: squircle;
  box-shadow: 0 12px 32px var(--color-shadow-strong);
  z-index: 20;
  max-height: 260px;
  overflow-y: auto;
  padding: 6px 6px;
}
.gds-listbox-option {
  width: 100%;
  text-align: left;
  border: 0;
  background: transparent;
  padding: 8px 10px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-family: inherit;
  border-radius: calc(8px * var(--corner-radius-scale, 1));
  corner-shape: squircle;
  box-sizing: border-box;
  margin-bottom: 2px;
}
.gds-listbox-option:hover {
  background: var(--color-surface-subtle);
}
.gds-listbox-option[aria-selected="true"] {
  background: var(--color-border);
}
.gds-listbox-option-label {
  font-weight: 600;
  font-size: 14px;
  color: var(--color-text);
}
.gds-listbox-option-meta {
  font-size: 12px;
  color: var(--color-text-subtle);
}
.gds-button {
  border: 1px solid var(--color-border-strong);
  border-radius: calc(10px * var(--corner-radius-scale, 1));
  corner-shape: squircle;
  background: var(--color-surface);
  cursor: pointer;
  font-weight: 600;
  font-family: inherit;
  text-decoration: none;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 8px
}
.gds-button--size-medium {
  padding: 8px 14px;
}
.gds-button--size-small {
  padding: 4px 10px;
}
.gds-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.gds-button--primary {
  background: var(--color-primary);
  color: var(--color-surface);
  border-color: var(--color-primary);
}
.gds-button--primary:hover {
  background: var(--color-primary-strong);
  border-color: var(--color-primary-strong);
}
.gds-button--primary-deemph {
  background: var(--color-primary-alpha-15);
  color: var(--color-primary);
  border-color: var(--color-primary);
}
.gds-button--primary-deemph:hover {
  background: var(--color-primary-alpha-25);
}
.gds-button--secondary {
  background: var(--color-surface-muted);
  color: var(--color-text);
}
.gds-button--secondary:hover {
  background: var(--color-border);
  border-color: var(--color-border-emphasis);
}
.gds-button--ghost {
  background: transparent;
  border-color: transparent;
  color: var(--color-text);
}
.gds-button--ghost:hover {
  border-color: var(--color-border-strong);
  background: var(--color-surface-muted);
}
.gds-button--ghost-danger {
  background: transparent;
  border-color: transparent;
  color: var(--color-danger);
}
.gds-button--ghost-danger:hover {
  background: var(--color-danger);
  color: var(--color-surface);
  border-color: var(--color-danger);
}
.gds-button--danger {
  background: var(--color-danger-soft);
  color: var(--color-danger);
  border-color: var(--color-danger);
}
.gds-button--danger:hover {
  background: var(--color-danger);
  color: var(--color-surface);
  border-color: var(--color-danger);
}
.gds-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
}
.gds-list-item {
  border-radius: calc(12px * var(--corner-radius-scale, 1));
  corner-shape: squircle;
  padding: 10px;
  background: var(--color-surface-muted);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.gds-list-item-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-weight: 700;
  color: var(--color-text);
}
.gds-list-item-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 14px;
}
.gds-list-item-meta {
  font-size: 12px;
  color: var(--color-text-muted);
  font-weight: 500;
}
.gds-list-item-meta code {
  font-size: 12px;
}
.gds-list-item-description {
  font-size: 13px;
  color: var(--color-text);
}
.imessage-thread {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 6px;
}
.test-bot-thread {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  gap: 8px;
}
.test-bot-thread-overlay {
  position: absolute;
  inset: 0;
  background: rgba(248, 250, 252, 0.86);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.test-bot-thread-card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: calc(16px * var(--corner-radius-scale, 1));
  corner-shape: squircle;
  padding: 16px;
  max-width: 640px;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
  text-align: left;
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.08);
}
.test-bot-thread-title {
  text-align: center;
  font-size: 16px;
}
.test-bot-thread-subtitle {
  text-align: center;
}
.test-bot-thread-sections {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.test-bot-thread-section {
  flex: 1 1 220px;
  border: 1px solid var(--color-border);
  border-radius: calc(12px * var(--corner-radius-scale, 1));
  corner-shape: squircle;
  padding: 10px 12px;
  background: var(--color-surface-muted);
  display: flex;
  flex-direction: column;
  gap: 6px;
  text-wrap: pretty;
}
.test-bot-thread-section button {
  margin-top: auto;
  align-self: center;
}
.test-bot-thread-section-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--color-text);
}
.test-bot-thread-section-body {
  font-size: 12px;
  color: var(--color-text-subtle);
  line-height: 1.45;
}
.imessage-row {
  display: flex;
}
.imessage-row.left {
  justify-content: flex-start;
}
.imessage-row.right {
  justify-content: flex-end;
}
.imessage-bubble {
  max-width: min(520px, 85%);
  padding: 10px 12px;
  border-radius: calc(18px * var(--corner-radius-scale, 1));
  corner-shape: squircle;
  font-size: 13px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
}
.imessage-bubble.left {
  background: var(--color-surface-subtle);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-bottom-left-radius: 6px;
}
.imessage-bubble.right {
  background: var(--color-primary-soft);
  color: var(--color-text);
  border: 1px solid var(--color-primary-alpha-25);
  border-bottom-right-radius: 6px;
}
.imessage-row.left .imessage-bubble.right {
  border-bottom-right-radius: 18px;
  border-bottom-left-radius: 6px;
}
.imessage-row.right .imessage-bubble.left {
  border-bottom-left-radius: 18px;
  border-bottom-right-radius: 6px;
}
.imessage-bubble-muted {
  opacity: 0.7;
  font-size: 12px;
  background: var(--color-surface-muted);
  border-color: var(--color-border);
}
.imessage-bubble-collapsible {
  cursor: pointer;
}
.imessage-bubble-collapsed {
  font-style: italic;
  opacity: 0.75;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.imessage-bubble-collapsed:hover,
.imessage-bubble-collapsed:focus {
  opacity: 1;
}
.assistant-thread {
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: calc(12px * var(--corner-radius-scale, 1));
  corner-shape: squircle;
  padding: 8px;
}
.assistant-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: space-between;
}
.assistant-actions button {
  padding: 8px 14px;
  border-radius: calc(10px * var(--corner-radius-scale, 1));
  corner-shape: squircle;
  border: 1px solid var(--color-primary);
  background: var(--color-primary);
  color: var(--color-surface);
  font-weight: 600;
  cursor: pointer;
}
.assistant-actions button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.patch-card {
  border: 1px solid var(--color-border-strong);
  border-radius: calc(12px * var(--corner-radius-scale, 1));
  corner-shape: squircle;
  padding: 10px;
  background: var(--color-surface-muted);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.patch-summary {
  font-weight: 700;
  color: var(--color-text);
}
.patch-meta {
  font-size: 12px;
  color: var(--color-text-muted);
}
.patch-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}
.patch-reason-input {
  width: 100%;
  border: 1px solid var(--color-border-strong);
  border-radius: calc(10px * var(--corner-radius-scale, 1));
  corner-shape: squircle;
  padding: 8px;
  font-family: inherit;
  box-sizing: border-box;
}
.placeholder {
  color: var(--color-text-muted);
  font-size: 14px;
  line-height: 1.5;
  background: var(--color-surface-subtle);
  border-radius: calc(8px * var(--corner-radius-scale, 1));
  corner-shape: squircle;
  padding: 6px 10px;
}
.placeholder.emphasis {
  background: var(--color-primary-alpha-15);
  color: var(--color-primary);
}
`;
