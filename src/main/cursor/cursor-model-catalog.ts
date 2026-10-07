import { createHash } from 'node:crypto'
import type { AgentSessionModelOption } from '../../shared/agent-session-wire'
import type { CursorSdkListedModel, CursorSdkModelSelection } from './cursor-sdk-protocol'

const DEFAULT_MODEL_IDS = ['composer-2.5', 'auto']
const CURSOR_MODEL_LIST_RETRY_MS = 1_000

export type CursorModelListCache = {
  models: CursorSdkListedModel[]
  scope: string | null
  failedScope: string | null
  failedAt: number
}

export function emptyCursorModelListCache(): CursorModelListCache {
  return { models: [], scope: null, failedScope: null, failedAt: 0 }
}

/** A failed list retries on a later read. A burst of reads does not spawn a sidecar each time. */
export async function refreshCursorModelList(
  cache: CursorModelListCache,
  input: {
    listModels?: (apiKey: string | undefined) => Promise<CursorSdkListedModel[]>
    resolveApiKey?: () => string | undefined
  }
): Promise<void> {
  if (!input.listModels) {
    return
  }
  const scope = cursorCatalogCredentialScope(input.resolveApiKey?.())
  if (cache.scope === scope) {
    return
  }
  if (cache.failedScope === scope && Date.now() - cache.failedAt < CURSOR_MODEL_LIST_RETRY_MS) {
    return
  }
  try {
    cache.models = await input.listModels(input.resolveApiKey?.()?.trim() || undefined)
    cache.scope = scope
    cache.failedScope = null
  } catch {
    cache.models = []
    cache.scope = null
    cache.failedScope = scope
    cache.failedAt = Date.now()
  }
}

export function cursorCatalogCredentialScope(apiKey: string | undefined): string {
  const key = apiKey?.trim()
  return key ? createHash('sha256').update(key).digest('hex') : 'browser-login'
}

export function cursorPreferredModelId(models: readonly CursorSdkListedModel[]): string {
  return (
    DEFAULT_MODEL_IDS.map((id) => models.find((model) => model.id === id)).find(Boolean)?.id ??
    models[0]?.id ??
    'auto'
  )
}

export function cursorModelsToSessionOptions(
  models: readonly CursorSdkListedModel[]
): AgentSessionModelOption[] {
  const preferredId = cursorPreferredModelId(models)
  return models.map((model) => {
    const effort = model.parameters?.find((parameter) => parameter.id !== 'fast')
    const fast = model.parameters?.some((parameter) => parameter.id === 'fast') ?? false
    return {
      id: model.id,
      label: model.displayName || model.id,
      ...(model.description ? { description: model.description } : {}),
      isDefault: model.id === preferredId,
      ...(effort?.values[0] ? { defaultEffort: effort.values[0].value } : {}),
      efforts: (effort?.values ?? []).map((value) => ({
        value: value.value,
        label: value.displayName || value.value
      })),
      ...(fast ? { supportsFastMode: true } : {})
    }
  })
}

export function cursorEffortParamId(
  modelId: string,
  models: readonly CursorSdkListedModel[]
): string {
  const listed = models.find((model) => model.id === modelId)
  return listed?.parameters?.find((parameter) => parameter.id !== 'fast')?.id ?? 'effort'
}

export function cursorModelSelection(
  options: Readonly<Record<string, string>>,
  models: readonly CursorSdkListedModel[]
): CursorSdkModelSelection {
  const id = options.model?.trim() || cursorPreferredModelId(models)
  const params: { id: string; value: string }[] = []
  if (options.effort) {
    params.push({ id: cursorEffortParamId(id, models), value: options.effort })
  }
  if (options.fastMode === 'true') {
    params.push({ id: 'fast', value: 'true' })
  }
  return params.length > 0 ? { id, params } : { id }
}
