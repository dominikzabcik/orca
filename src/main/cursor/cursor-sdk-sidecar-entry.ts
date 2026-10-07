/**
 * Plain-Node process that owns one @cursor/sdk local agent.
 * Must not import electron: it is launched with ELECTRON_RUN_AS_NODE.
 */
import { createInterface } from 'node:readline'
import type { AgentOptions, LocalAgentOptions } from '@cursor/sdk'
import type * as CursorSdk from '@cursor/sdk'
import type { CursorSidecarCommand, CursorSidecarEvent } from './cursor-sdk-protocol'
import {
  forwardCursorSdkDelta,
  forwardCursorSdkMessage,
  INITIAL_CURSOR_RUN_FORWARD_STATE,
  type CursorRunForwardState
} from './cursor-sdk-run-events'

type SdkModule = typeof CursorSdk
type LiveAgent = Awaited<ReturnType<SdkModule['Agent']['create']>>
type LiveRun = Awaited<ReturnType<LiveAgent['send']>>

let agent: LiveAgent | null = null
let run: LiveRun | null = null
let disposing = false
let forward: CursorRunForwardState = INITIAL_CURSOR_RUN_FORWARD_STATE

function emitForward(next: { state: CursorRunForwardState; events: CursorSidecarEvent[] }): void {
  forward = next.state
  for (const event of next.events) {
    emit(event)
  }
}

function emit(event: CursorSidecarEvent): void {
  process.stdout.write(`${JSON.stringify(event)}\n`)
}

async function loadSdk(): Promise<SdkModule> {
  return import('@cursor/sdk')
}

async function ensureSignedIn(sdk: SdkModule, apiKey: string | undefined): Promise<void> {
  if (apiKey) {
    return
  }
  const status = await sdk.Cursor.auth.status()
  if (status.status === 'logged-in') {
    return
  }
  await sdk.Cursor.auth.login({
    openBrowser: true,
    onLoginUrl: (url) => emit({ type: 'loginUrl', url })
  })
}

async function startAgent(
  sdk: SdkModule,
  command: Extract<CursorSidecarCommand, { type: 'start' }>
): Promise<void> {
  await ensureSignedIn(sdk, command.apiKey)
  const store = new sdk.JsonlLocalAgentStore(command.storeDir)
  const local: LocalAgentOptions = {
    cwd: command.cwd,
    store,
    settingSources: ['project', 'user', 'team', 'plugins'],
    sandboxOptions: { enabled: command.sandbox },
    autoReview: command.autoReview
  }
  const options: AgentOptions = {
    ...(command.apiKey ? { apiKey: command.apiKey } : {}),
    model: command.model,
    mode: command.mode,
    local
  }
  agent = command.agentId
    ? await sdk.Agent.resume(command.agentId, options)
    : await sdk.Agent.create(options)
  emit({ type: 'ready', agentId: agent.agentId })
}

async function consumeRun(next: LiveRun): Promise<void> {
  run = next
  try {
    for await (const event of next.stream()) {
      emitForward(forwardCursorSdkMessage(forward, event))
    }
    const result = await next.wait()
    emit({
      type: 'result',
      status: result.status,
      ...(result.result ? { result: result.result } : {}),
      ...(result.error?.message ? { error: result.error.message } : {}),
      ...(typeof result.durationMs === 'number' ? { durationMs: result.durationMs } : {})
    })
  } finally {
    if (run === next) {
      run = null
    }
  }
}

async function onSend(command: Extract<CursorSidecarCommand, { type: 'send' }>): Promise<void> {
  if (!agent) {
    throw new Error('Cursor agent is not started')
  }
  const message =
    command.images && command.images.length > 0
      ? { text: command.text, images: command.images }
      : command.text
  forward = INITIAL_CURSOR_RUN_FORWARD_STATE
  const next = await agent.send(message, {
    ...(command.model ? { model: command.model } : {}),
    ...(command.mode ? { mode: command.mode } : {}),
    onDelta: ({ update }) => {
      emitForward(forwardCursorSdkDelta(forward, update))
    }
  })
  await consumeRun(next)
}

function reportCommandError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  const code = error instanceof Error && 'code' in error ? String(error.code) : undefined
  if (!agent) {
    emit({ type: 'startupError', message, ...(code ? { code } : {}) })
    process.exitCode = 1
    return true
  }
  emit({ type: 'result', status: 'error', error: message })
  return false
}

async function handle(command: CursorSidecarCommand): Promise<void> {
  if (command.type === 'start') {
    const sdk = await loadSdk()
    await startAgent(sdk, command)
    return
  }
  if (command.type === 'send') {
    await onSend(command)
    return
  }
  if (command.type === 'steer') {
    const outcome = (await run?.steer?.(command.text)) ?? 'revert_to_followup'
    emit({ type: 'steer', id: command.id, outcome })
    return
  }
  if (command.type === 'cancel') {
    await run?.cancel()
    return
  }
  if (command.type === 'dispose') {
    disposing = true
    await agent?.[Symbol.asyncDispose]?.()
    agent = null
  }
}

function parseCommand(line: string): CursorSidecarCommand | null {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return null
  }
  const type = value.type
  if (
    type !== 'start' &&
    type !== 'send' &&
    type !== 'steer' &&
    type !== 'cancel' &&
    type !== 'dispose'
  ) {
    return null
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: type is one of the sidecar commands; the handler reads only the fields that command uses.
  return value as CursorSidecarCommand
}

async function main(): Promise<void> {
  if (process.argv[2] === 'models') {
    const sdk = await loadSdk()
    const models = await sdk.Cursor.models.list(
      process.env.CURSOR_API_KEY ? { apiKey: process.env.CURSOR_API_KEY } : {}
    )
    process.stdout.write(`${JSON.stringify({ models })}\n`)
    return
  }
  const lines = createInterface({ input: process.stdin })
  let inFlightSend: Promise<void> | null = null
  for await (const line of lines) {
    if (!line.trim() || disposing) {
      continue
    }
    const command = parseCommand(line)
    if (!command) {
      continue
    }
    // Why: send streams until the turn ends. Awaiting it here would leave steer and cancel unread.
    if (command.type === 'send') {
      inFlightSend = handle(command).catch((error: unknown) => {
        reportCommandError(error)
      })
      continue
    }
    try {
      await handle(command)
    } catch (error) {
      if (reportCommandError(error)) {
        break
      }
    }
    if (disposing) {
      break
    }
  }
  await inFlightSend
}

main()
  .catch((error: unknown) => {
    emit({
      type: 'startupError',
      message: error instanceof Error ? error.message : String(error)
    })
    process.exitCode = 1
  })
  .finally(() => {
    emit({ type: 'exited', code: typeof process.exitCode === 'number' ? process.exitCode : 0 })
  })
