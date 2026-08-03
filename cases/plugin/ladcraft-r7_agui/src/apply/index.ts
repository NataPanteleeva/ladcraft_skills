export type { InsertPosition } from "./types";

export { withAction } from "./editor-methods";
export {
  applyEditorTasks,
  collectPendingEditorTasks,
  collectPendingSearchReplaceFromChat,
  EDITOR_AUTO_APPLY_TYPES,
  filterEditorApplyTasks,
  taskApplyKey,
  taskContentKey,
  type EditorTaskApplyResult,
} from "./task-runner";
export {
  isDocumentApplyApproval,
  isReplaceSelectionUserIntent,
  isLexicalSearchReplaceIntent,
  parseLexicalSearchReplacePairs,
  planLexicalSearchReplace,
  resolveFindingsAutoApplyPlan,
  planFromFindingsItems,
  parseInsertPosition,
  parseFixIntent,
  resolveDocumentApplyPlan,
  resolveDocumentApplyIntent,
  intentToR7Task,
  intentApplyKey,
  planDedupeHit,
  extractDraftBody,
  extractInsertableMarkdown,
  extractInsertableFullBody,
  extractChernovikBody,
  extractInsertableSummaryBody,
  sanitizeInsertableBlob,
  sanitizeProposalText,
  assistantApplySource,
  isApplyableAssistantBlob,
  isStructuredSummaryBlob,
  isGenericInsertableDraft,
  findingsHaveCategoryTags,
  isMechanicalFindingCategory,
  MECHANICAL_FINDING_CATEGORIES,
  MISSING_PROPOSAL_STATUS,
  MISSING_PROPOSAL_AGENT_NOTE,
  type DocumentApplyIntent,
  type DocumentApplyPlan,
  type FixIntent,
} from "./intent-apply";
export {
  resolveActionTarget,
  resolveActionButtons,
  planFromActionId,
  fixIntentFromActionId,
  resolveInsertableText,
  type ActionId,
  type ActionButtonSpec,
  type ActionTarget,
} from "./action-buttons";
export {
  actionTargetKey,
  hashText,
  isFindingsFixActionId,
  resolveDocumentActionTarget,
} from "./action-buttons-shared";
export {
  downloadTextAsMarkdown,
  downloadTextAsWordHtml,
  triggerBrowserDownload,
} from "./local-download";
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
  stripSkillProgressNarrative,
  appendToolWebHints,
} from "./display-sanitize";
