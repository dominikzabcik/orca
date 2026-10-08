import type { CatalogModel, CatalogOption } from './agent-session-option-catalog'
import type { AgentSessionOptionsResult } from './agent-session-wire'

function listedSelect(
  id: string,
  label: string,
  category: CatalogOption['category'],
  choices: { value: string; label: string }[] | undefined,
  defaultValue: string | undefined,
  apply: CatalogOption['apply']
): CatalogOption | null {
  if (!choices || choices.length <= 1) {
    return null
  }
  const fallback = choices[0]!.value
  const selected =
    defaultValue && choices.some((choice) => choice.value === defaultValue)
      ? defaultValue
      : fallback
  return {
    id,
    label,
    category,
    kind: {
      type: 'select',
      choices,
      defaultValue: selected,
      ...(defaultValue ? { defaultIsCliDefault: true as const } : {})
    },
    apply
  }
}

function effortOption(model: AgentSessionOptionsResult['models'][number]): CatalogOption | null {
  return listedSelect(
    'effort',
    'Reasoning effort',
    'thought_level',
    model.efforts,
    model.defaultEffort,
    { midSession: { kind: 'command', build: (value) => `/effort ${String(value)}` } }
  )
}

function fastModeOption(): CatalogOption {
  return {
    id: 'fastMode',
    label: 'Fast mode',
    category: 'mode',
    kind: { type: 'boolean', defaultValue: false },
    apply: {}
  }
}

export function discoveredStructuredAgentModel(
  model: AgentSessionOptionsResult['models'][number],
  sessionSupportsFastMode: boolean
): CatalogModel {
  const effort = effortOption(model)
  const context = listedSelect(
    'context',
    'Context',
    'model_config',
    model.contextWindows,
    model.defaultContextWindow,
    {}
  )
  const thinking = listedSelect(
    'thinking',
    'Thinking',
    'model_config',
    model.thinkingLevels,
    model.defaultThinking,
    {}
  )
  return {
    id: model.id,
    label: model.label,
    ...(model.description ? { description: model.description } : {}),
    ...(model.isDefault ? { isDefault: true } : {}),
    options: [
      ...(effort ? [effort] : []),
      ...(context ? [context] : []),
      ...(thinking ? [thinking] : []),
      ...(sessionSupportsFastMode && model.supportsFastMode === true ? [fastModeOption()] : [])
    ]
  }
}

export function withStructuredConversationMode(
  model: CatalogModel,
  mode: CatalogOption | undefined
): CatalogModel {
  return mode ? { ...model, options: [...model.options, mode] } : model
}
