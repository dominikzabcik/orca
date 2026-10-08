import {
  getAgentSessionOptionCatalog,
  type AgentSessionOptionCatalog
} from '../../../../shared/agent-session-option-catalog'
import { CURSOR_SESSION_OPTION_CATALOG } from '../../../../shared/agent-session-option-catalog-gemini-cursor'
import { isAgentSessionHandleProvider } from '../../../../shared/agent-session-provider-handle'
import type { AgentType } from '../../../../shared/agent-status-types'

// Over `agentSession.*` only the live read and `setOption` apply a pick, so no launch apply is named.
const LIVE_ONLY_CATALOG: AgentSessionOptionCatalog = { models: [], modelApply: {} }

const CURSOR_CONVERSATION_MODE = CURSOR_SESSION_OPTION_CATALOG.structuredConversationMode
const CURSOR_STRUCTURED_SEED_CATALOG: AgentSessionOptionCatalog = {
  models: [],
  modelApply: {},
  hostListingNamesConfiguredModel: true,
  ...(CURSOR_CONVERSATION_MODE ? { structuredConversationMode: CURSOR_CONVERSATION_MODE } : {})
}

/**
 * What a structured chat's picker shows before the session reports its own options. Only the agents
 * every build ships have a seed written against their structured option ids; another agent's
 * terminal catalog names CLI flags and models its structured session never offered, so its picker
 * starts empty and lists exactly what `agentSession.options` reports. Cursor is the exception: it
 * has no static models, but its listing is the model a new chat runs, so the picker can name it.
 */
export function structuredAgentSessionSeedCatalog(agent: AgentType): AgentSessionOptionCatalog {
  if (agent === 'cursor') {
    return CURSOR_STRUCTURED_SEED_CATALOG
  }
  return isAgentSessionHandleProvider(agent)
    ? (getAgentSessionOptionCatalog(agent) ?? LIVE_ONLY_CATALOG)
    : LIVE_ONLY_CATALOG
}
