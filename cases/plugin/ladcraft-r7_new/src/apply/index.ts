export type { InsertPosition } from "./types";

export { withAction } from "./editor-methods";
export {
  applyEditorTasks,
  collectPendingEditorTasks,
  EDITOR_AUTO_APPLY_TYPES,
  filterEditorApplyTasks,
  taskApplyKey,
  taskContentKey,
  type EditorTaskApplyResult,
} from "./task-runner";
export {
  isDocumentApplyApproval,
  isReplaceSelectionUserIntent,
  parseInsertPosition,
  parseFixIntent,
  resolveDocumentApplyPlan,
  resolveDocumentApplyIntent,
  intentToR7Task,
  intentApplyKey,
  planDedupeHit,
  extractDraftBody,
  extractInsertableMarkdown,
  assistantApplySource,
  isApplyableAssistantBlob,
  isStructuredSummaryBlob,
  isGenericInsertableDraft,
  MISSING_PROPOSAL_STATUS,
  MISSING_PROPOSAL_AGENT_NOTE,
  type DocumentApplyIntent,
  type DocumentApplyPlan,
  type FixIntent,
} from "./intent-apply";
export {
  parseR7Proposal,
  stripR7ProposalMarkup,
  type R7ProposalV1,
  type ProposalFindingItem,
} from "./proposal-parse";
export {
  buildApplyEventPayload,
  formatR7EventBlock,
  isR7EventContent,
  stripR7EventMarkup,
  feedbackNotifyKey,
  type R7ApplyEventV1,
} from "./apply-feedback";
export {
  sanitizeAssistantChatText,
  stripActionsMarkup,
  stripActionHintLines,
  appendToolWebHints,
} from "./display-sanitize";
