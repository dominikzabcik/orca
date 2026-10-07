import {
  INITIAL_SYNCHRONIZED_OUTPUT_LATCH_STATE,
  SYNCHRONIZED_OUTPUT_END_SEQUENCE,
  SYNCHRONIZED_OUTPUT_START_SEQUENCE,
  scanSynchronizedOutput,
  type SynchronizedOutputLatchState
} from './terminal-synchronized-output-scan'

// Why three: cursor-agent walks the cursor up one row at a time to erase its
// status block. One or two moves is ordinary output; a run is a full redraw.
const MIN_IN_PLACE_REDRAW_CURSOR_UPS = 3
const CURSOR_UP_ONE_ROW = '\x1b[1A'

const latchByTerminal = new WeakMap<object, SynchronizedOutputLatchState>()

function chunkRewritesInPlace(data: string): boolean {
  if (
    data.includes(SYNCHRONIZED_OUTPUT_START_SEQUENCE) ||
    data.includes(SYNCHRONIZED_OUTPUT_END_SEQUENCE)
  ) {
    return false
  }
  let seen = 0
  let index = 0
  while (seen < MIN_IN_PLACE_REDRAW_CURSOR_UPS) {
    index = data.indexOf(CURSOR_UP_ONE_ROW, index)
    if (index === -1) {
      return false
    }
    seen += 1
    index += CURSOR_UP_ONE_ROW.length
  }
  return true
}

/**
 * Paint an in-place TUI redraw once.
 *
 * cursor-agent emits a short header frame and then the full tool block inside
 * one chunk (a GitHub status poll keeps doing this for the whole wait). xterm
 * paints every erase, so the chat jumps. A frame the app already synchronized
 * is left alone.
 */
export function synchronizeInPlaceRedrawChunk(terminal: object, data: string): string {
  const previous = latchByTerminal.get(terminal) ?? INITIAL_SYNCHRONIZED_OUTPUT_LATCH_STATE
  const scan = scanSynchronizedOutput(data, previous.markerTail, previous.active)
  latchByTerminal.set(terminal, { markerTail: scan.markerTail, active: scan.active })
  if (previous.active || scan.active || !chunkRewritesInPlace(data)) {
    return data
  }
  return `${SYNCHRONIZED_OUTPUT_START_SEQUENCE}${data}${SYNCHRONIZED_OUTPUT_END_SEQUENCE}`
}
