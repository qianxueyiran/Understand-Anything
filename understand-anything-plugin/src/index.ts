export {
  buildChatContext,
  formatContextForPrompt,
  type ChatContext,
} from "./context-builder.js";
export {
  buildProductIndexChatContext,
  formatProductIndexContextForPrompt,
  type ProductIndexChatContext,
  type ProductIndexChatContextInput,
} from "./product-index-context-builder.js";
export {
  buildChatPrompt,
  buildProductAwareChatPrompt,
  type ProductAwareChatPromptInput,
} from "./understand-chat.js";
export {
  buildDiffContext,
  formatDiffAnalysis,
  type DiffContext,
} from "./diff-analyzer.js";
export {
  buildExplainContext,
  formatExplainPrompt,
  type ExplainContext,
} from "./explain-builder.js";
export { buildOnboardingGuide } from "./onboard-builder.js";
export {
  runProductIndexCli,
  type ProductIndexCliResult,
} from "./product-index-cli.js";
