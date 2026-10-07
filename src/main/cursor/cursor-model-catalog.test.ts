import { describe, expect, it } from 'vitest'
import { cursorModelSelection, cursorModelsToSessionOptions } from './cursor-model-catalog'
import type { CursorSdkListedModel } from './cursor-sdk-protocol'

const listed: CursorSdkListedModel[] = [
  { id: 'auto', displayName: 'Auto' },
  { id: 'composer-2.5', displayName: 'Composer 2.5' }
]

describe('cursor model catalog', () => {
  it('uses the same default for the picker and a run with no chosen model', () => {
    const options = cursorModelsToSessionOptions(listed)
    const selected = cursorModelSelection({}, listed)
    expect(options.find((model) => model.isDefault)?.id).toBe('composer-2.5')
    expect(selected.id).toBe('composer-2.5')
  })
})
