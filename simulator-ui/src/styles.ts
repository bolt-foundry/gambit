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
}
*,
*::before,
*::after {
  box-sizing: border-box;
}
body {
  margin: 0;
  background: #f6f7fb;
  overflow: hidden;
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
  padding: 24px;
  gap: 16px;
  overflow: hidden;
}
.docs-shell {
  padding: 12px 16px;
}
pre.deck-preview,
pre.docs-command {
  background: rgba(0, 0, 0, 0.04);
  border-radius: 8px;
  padding: 12px 16px;
}
code:not(pre *) {
  background: rgba(0, 0, 0, 0.06);
  padding: 4px;
  border-radius: 4px;
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
  color: #475569;
  word-break: break-all;
}
.header-actions {
  display: flex;
  gap: 12px;
  align-items: center;
}
.header-actions button {
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  padding: 8px 14px;
  background: white;
  cursor: pointer;
  font-weight: 600;
}
button.ghost-btn,
a.ghost-btn {
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  padding: 8px 14px;
  background: white;
  cursor: pointer;
  font-weight: 600;
  text-decoration: none;
  color: inherit;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
button.primary,
a.primary {
  border: 1px solid #0b93f6;
  border-radius: 10px;
  padding: 8px 14px;
  background: #0b93f6;
  color: white;
  cursor: pointer;
  font-weight: 600;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
button.primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.header-actions button.primary {
  background: #0b93f6;
  color: white;
  border-color: #0b93f6;
}
.copy-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px dashed #cbd5e1;
  border-radius: 999px;
  padding: 4px 10px;
  background: #f8fafc;
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  color: #0f172a;
  transition: background 120ms ease, border-color 120ms ease;
}
.copy-badge code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 12px;
  color: #0f172a;
}
.copy-badge .copy-label {
  font-weight: 600;
  color: #475569;
}
.copy-badge .copy-feedback {
  font-size: 11px;
  color: #0f9d58;
}
.copy-badge:hover {
  background: #e2e8f0;
  border-color: #94a3b8;
}
.copy-badge.copied {
  border-color: #0f9d58;
  background: #dcfce7;
}
.status-indicator {
  text-transform: capitalize;
  font-size: 13px;
  color: #475569;
}
.status-indicator.connected {
  color: #0f9d58;
}
.app-main {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 16px;
  overflow: hidden;
}
.chat-column {
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: #ffffff;
  border-radius: 16px;
  padding: 16px;
  border: 1px solid #e2e8f0;
  min-height: 0;
  overflow-y: auto;
}
.calibrate-shell .calibrate-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 16px;
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
.calibrate-shell .calibrate-main-column {
  min-height: 0;
  gap: 12px;
  overflow: hidden;
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
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  background: #ffffff;
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
  color: #475569;
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
  border-radius: 5px;
  display: inline-block;
}
.calibrate-run-turn--pending {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #e2e8f0;
}
.calibrate-run-turn--empty {
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
}
.calibrate-spinner {
  width: 16px;
  height: 16px;
  border-radius: 999px;
  border: 2px solid rgba(15, 23, 42, 0.25);
  border-top-color: #0b93f6;
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
  border-top: 1px solid #e2e8f0;
  padding-top: 12px;
}
.calibrate-run-section:first-child {
  border-top: none;
  padding-top: 0;
}
.calibrate-drawer {
  background: #ffffff;
  border-radius: 16px;
  border: 1px solid #e2e8f0;
  padding: 16px;
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
  border-top: 1px solid #e2e8f0;
}
.drawer-section:first-of-type {
  border-top: none;
  padding-top: 0;
}
.drawer-meta {
  font-size: 13px;
  color: #475569;
}
.calibrate-drawer .ghost-btn {
  width: 100%;
  justify-content: center;
}
.chat-row {
  display: flex;
  justify-content: flex-start;
}
.bubble {
  background: #f1f5f9;
  border-radius: 16px;
  padding: 12px;
  width: 100%;
  box-shadow: inset 0 0 0 1px #e2e8f0;
}
.bubble-user {
  background: #0b93f6;
  color: white;
  box-shadow: none;
}
.bubble-role {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #94a3b8;
  margin-bottom: 6px;
}
.bubble-user .bubble-role {
  color: rgba(255,255,255,0.7);
}
.bubble-text {
  line-height: 1.5;
}
.bubble-json {
  background: rgba(0,0,0,0.04);
  padding: 8px;
  border-radius: 8px;
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
  border: 1px solid #cbd5e1;
  background: white;
  border-radius: 8px;
  padding: 4px 10px;
  cursor: pointer;
  font-size: 12px;
}
.score-button-active {
  background: #0b93f6;
  color: white;
  border-color: #0b93f6;
}
.feedback-reason {
  width: 100%;
  min-height: 48px;
  border-radius: 10px;
  border: 1px solid #cbd5e1;
  padding: 8px;
  resize: vertical;
  box-sizing: border-box;
  font-family: inherit;
}
.feedback-meta {
  font-size: 11px;
  color: #475569;
}
.feedback-status {
  font-size: 11px;
  color: #94a3b8;
}
.feedback-status.saving {
  color: #0b93f6;
}
.feedback-status.unsaved {
  color: #b45309;
}
.init-panel {
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  background: #f8fafc;
  padding: 12px;
  margin-bottom: 12px;
}
.init-panel summary {
  cursor: pointer;
  font-weight: 700;
  color: #0f172a;
}
.init-panel .hint {
  margin-top: 6px;
  font-size: 12px;
  color: #475569;
}
.init-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
  margin-top: 10px;
}
.init-field {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.init-field label {
  font-weight: 700;
  color: #111827;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.badge {
  padding: 2px 8px;
  border-radius: 999px;
  background: #e2e8f0;
  color: #475569;
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
}
.init-field input,
.init-field select,
.init-field textarea {
  width: 100%;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
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
  background: rgba(15, 23, 42, 0.06);
  border-radius: 12px;
  padding: 10px;
  overflow-x: auto;
  font-size: 12px;
}
.init-missing {
  margin-top: 8px;
  font-size: 12px;
  color: #b91c1c;
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
  color: #475569;
}
.trace-panel {
  background: white;
  border-radius: 16px;
  padding: 16px;
  border: 1px solid #e2e8f0;
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
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 8px;
  background: #f8fafc;
  word-break: break-word;
  overflow-wrap: anywhere;
}
.calibrate-result-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
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
  border-radius: 12px;
  background: #e2e8f0;
  color: #0f172a;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: 700;
}
.calibrate-score-badge--pending {
  background: #f1f5f9;
  color: #0f172a;
}
.calibrate-score--positive {
  background: #16a34a;
  color: #ffffff;
}
.calibrate-score--negative {
  background: #dc2626;
  color: #ffffff;
}
.calibrate-score--neutral {
  background: #64748b;
  color: #ffffff;
}
.calibrate-score--empty {
  background: #e2e8f0;
  color: #0f172a;
}
.calibrate-result-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.calibrate-result-title {
  font-weight: 700;
}
.calibrate-result-subtitle {
  font-size: 12px;
  color: #475569;
}
.calibrate-score-chip {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 2px 8px;
  margin-left: 6px;
  background: #e2e8f0;
  color: #0f172a;
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
  background: #0f172a;
  color: #ffffff;
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
  background: #dc2626;
  color: #ffffff;
  font-size: 11px;
  font-weight: 700;
}
.calibrate-result-reason {
  font-size: 13px;
  color: #0f172a;
}
.calibrate-result-secondary {
  font-size: 12px;
  color: #64748b;
}
.calibrate-result-meta-line {
  font-size: 12px;
  color: #64748b;
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
  color: #475569;
}
.calibrate-reference-form select,
.calibrate-reference-form textarea {
  border: 1px solid #cbd5e1;
  border-radius: 10px;
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
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 8px;
  background: #f8fafc;
}
.calibrate-context-label {
  font-size: 11px;
  font-weight: 700;
  color: #475569;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}
.calibrate-context-bubble {
  margin-top: 6px;
  font-size: 13px;
  color: #0f172a;
  padding: 8px 10px;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
  background: #ffffff;
}
.calibrate-context-user {
  background: #0b93f6;
  border-color: #0b93f6;
  color: #ffffff;
}
.calibrate-context-assistant {
  background: #f1f5f9;
  border-color: #e2e8f0;
}
.calibrate-score-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.score-btn {
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  padding: 6px 10px;
  background: #ffffff;
  cursor: pointer;
  font-weight: 600;
  font-size: 12px;
  color: #0f172a;
}
.score-btn-active {
  background: #0b93f6;
  border-color: #0b93f6;
  color: #ffffff;
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
  border-color: #0b93f6;
  box-shadow: 0 0 0 2px rgba(11, 147, 246, 0.15);
}
.calibrate-section-title {
  font-size: 12px;
  font-weight: 700;
  color: #475569;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  margin-bottom: 4px;
}
.calibrate-toggle {
  padding: 6px 10px;
  font-size: 12px;
}
.calibrate-result-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  align-self: center;
}
.trace-row-user {
  background: #0b93f6;
  border-color: #0b93f6;
  color: #ffffff;
}
.trace-row-user .trace-json {
  color: rgba(255, 255, 255, 0.9);
}
.trace-json {
  font-size: 11px;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
}
.tool-call-row .imessage-bubble {
  background: #eef2ff;
  border: 1px solid #c7d2fe;
  color: #0f172a;
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
  outline: 2px solid #4338ca;
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
  color: #475569;
}
.tool-call-status.status-completed {
  color: #0f9d58;
}
.tool-call-status.status-error {
  color: #b91c1c;
}
.tool-call-status.status-running {
  color: #0b93f6;
}
.tool-call-handled {
  font-size: 11px;
  font-weight: 700;
  color: #b45309;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border: 1px solid #f59e0b;
  border-radius: 999px;
  padding: 2px 8px;
  background: #fffbeb;
}
.tool-call-id {
  font-size: 11px;
  color: #475569;
  word-break: break-word;
}
.tool-call-expand {
  font-size: 12px;
  font-weight: 600;
  color: #4338ca;
}
.tool-call-detail {
  margin-top: 8px;
  border-top: 1px solid #c7d2fe;
  padding-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.tool-call-divider {
  border-top: 1px solid #e2e8f0;
  margin: 2px 0;
}
.tool-call-field {
  display: flex;
  flex-direction: column;
}
.tool-call-field-label {
  font-size: 11px;
  font-weight: 600;
  color: #475569;
  margin-bottom: 4px;
}
.tool-call-error {
  color: #b91c1c;
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
  color: #475569;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.tool-calls-toggle::before,
.tool-calls-toggle::after {
  content: "";
  flex: 1;
  border-top: 1px solid #e2e8f0;
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
  background: white;
  padding: 12px;
  border-radius: 16px;
  border: 1px solid #e2e8f0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.composer-inputs {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.message-input {
  width: 100%;
  min-height: 80px;
  border-radius: 10px;
  border: 1px solid #cbd5e1;
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
  color: #0f172a;
}
.notes-inline textarea {
  width: 100%;
  min-height: 80px;
  border-radius: 10px;
  border: 1px solid #cbd5e1;
  padding: 10px;
  resize: vertical;
  font-family: inherit;
  box-sizing: border-box;
}
.notes-inline-status {
  font-size: 12px;
  color: #475569;
}
.notes-inline-status .state {
  font-weight: 600;
}
.notes-inline-status .state.saving {
  color: #0b93f6;
}
.notes-inline-status .state.unsaved {
  color: #b45309;
}
.notes-inline-status .state.idle {
  color: #94a3b8;
}
.notes-inline-status .state.saved {
  color: #0f9d58;
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
  color: #0f172a;
}
.rating-status {
  font-size: 12px;
  color: #475569;
}
.rating-button {
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 4px 10px;
  font-size: 12px;
  background: white;
  cursor: pointer;
}
.rating-button.active {
  background: #0b93f6;
  color: white;
  border-color: #0b93f6;
}
.composer-actions {
  display: flex;
  gap: 10px;
}
.composer-actions button {
  padding: 10px 18px;
  border-radius: 10px;
  border: none;
  background: #0b93f6;
  color: white;
  font-weight: 600;
  cursor: pointer;
}
.reset-note {
  font-size: 12px;
  color: #b45309;
}
.error {
  color: #b91c1c;
  font-size: 13px;
}
.session-meta {
  font-size: 12px;
  color: #475569;
}
.session-link {
  color: #0b93f6;
  text-decoration: none;
}
.session-link:hover {
  text-decoration: underline;
}
.session-path code {
  display: inline-block;
  word-break: break-all;
}
.sessions-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15,23,42,0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.sessions-dialog {
  background: white;
  border-radius: 16px;
  padding: 20px;
  width: min(520px, 90%);
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.sessions-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
}
.sessions-dialog header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.sessions-dialog ul {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sessions-dialog li {
  display: flex;
  gap: 8px;
  align-items: stretch;
}
.session-select-button {
  width: 100%;
  text-align: left;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  padding: 10px;
  background: #f8fafc;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.session-select-button:hover {
  background: #e2e8f0;
}
.session-delete-button {
  width: 36px;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  background: #f8fafc;
  color: #b91c1c;
  cursor: pointer;
  font-weight: 700;
}
.session-delete-button:hover {
  background: #fee2e2;
}
.trace-empty, .empty-state {
  padding: 12px;
  color: #475569;
  text-align: center;
}
.recent-sessions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}
.recent-session-button {
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  padding: 10px;
  background: #f8fafc;
  text-align: left;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.recent-session-button:hover {
  background: #e2e8f0;
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
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  background: white;
  border-bottom: 1px solid #e2e8f0;
  position: sticky;
  top: 0;
  z-index: 10;
  flex-wrap: wrap;
}
.top-nav-buttons {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.top-nav button {
  border: 1px solid #cbd5e1;
  background: #f8fafc;
  border-radius: 10px;
  padding: 8px 12px;
  cursor: pointer;
  font-weight: 600;
}
.top-nav button.active {
  background: #0b93f6;
  color: white;
  border-color: #0b93f6;
}
.top-nav-info {
  margin-left: auto;
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
  color: #475569;
  word-break: break-all;
}
.bundle-stamp {
  font-size: 12px;
  color: #475569;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
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
  border: 1px solid #cbd5e1;
  background: #f8fafc;
  border-radius: 10px;
  padding: 8px 12px;
  cursor: pointer;
  font-weight: 600;
}
.panel-tab.active {
  background: #0b93f6;
  color: white;
  border-color: #0b93f6;
}
.editor-shell {
  height: 100%;
  min-height: 0;
  background: #f6f7fb;
  display: flex;
  flex-direction: column;
  padding: 16px;
  gap: 12px;
  overflow: hidden;
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
.editor-status {
  font-size: 13px;
  color: #475569;
}
.editor-main {
  flex: 1;
  display: grid;
  grid-template-columns: 280px 1fr 340px;
  gap: 12px;
  min-height: 0;
  overflow: hidden;
}
.editor-panel {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  padding: 12px;
  min-height: 0;
  overflow: hidden;
}
.editor-panel.test-bot-sidebar {
  overflow-y: auto;
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
  border-radius: 18px;
  font-size: 13px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
}
.imessage-bubble.left {
  background: #f1f5f9;
  color: #0f172a;
  border: 1px solid #e2e8f0;
  border-bottom-left-radius: 6px;
}
.imessage-bubble.right {
  background: #0b93f6;
  color: white;
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
  background: #f8fafc;
  border-color: #e2e8f0;
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
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
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
  border-radius: 10px;
  border: 1px solid #0b93f6;
  background: #0b93f6;
  color: white;
  font-weight: 600;
  cursor: pointer;
}
.assistant-actions button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.patch-card {
  border: 1px solid #cbd5e1;
  border-radius: 12px;
  padding: 10px;
  background: #f8fafc;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.patch-summary {
  font-weight: 700;
  color: #0f172a;
}
.patch-meta {
  font-size: 12px;
  color: #475569;
}
.patch-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}
.patch-reason-input {
  width: 100%;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  padding: 8px;
  font-family: inherit;
  box-sizing: border-box;
}
.placeholder {
  color: #475569;
  font-size: 14px;
  line-height: 1.5;
}
`;
