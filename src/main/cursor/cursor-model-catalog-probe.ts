import type { AgentModelCatalogProbe } from '../native-chat/agent-model-catalog/agent-model-catalog-store'
import { cursorModelsToSessionOptions } from './cursor-model-catalog'
import { listCursorSdkModels } from './cursor-sdk-connection'

export function createCursorModelCatalogProbe(input: {
  resolveApiKey?: () => string | undefined
}): AgentModelCatalogProbe {
  return async () => {
    const apiKey = input.resolveApiKey?.()?.trim() || undefined
    const listed = await listCursorSdkModels({ apiKey })
    return {
      models: cursorModelsToSessionOptions(listed),
      fastModeTierByModel: new Map(),
      origin: 'probe'
    }
  }
}
