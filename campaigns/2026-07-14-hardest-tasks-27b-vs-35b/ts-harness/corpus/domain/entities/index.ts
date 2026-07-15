/**
 * Domain entity types re-exported from the infrastructure layer.
 *
 * Feature code (stores, containers, hooks) MUST import domain types from here,
 * not from `@/db/idb` (infrastructure). Service files (`db/*.ts`) continue to
 * import directly from `@/db/idb`.
 */
export type {
  AtomicSkillDTO,
  ChatMessage,
  ChatSession,
  CitationDTO,
  LLMProviderConfig,
  ModelParamsDTO,
  PipelineStepTraceDTO,
  PipelineTraceDTO,
  PromptTesterMode,
  SkillCategory,
  SkillContainerDTO,
  SkillSnapshot,
  SkillType
} from '@/db/idb';
