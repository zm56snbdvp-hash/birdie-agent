export {
  loadTraceFixtures,
  validateTraceFixture,
} from './runtime-fault-corpus.mjs';

function assertTrace(events) {
  if (!Array.isArray(events)) throw new TypeError('TRACE.MINIMIZER.EVENTS_REQUIRED');
}

function* indexCombinations(length, size, start = 0, prefix = []) {
  if (prefix.length === size) {
    yield prefix;
    return;
  }

  const remaining = size - prefix.length;
  for (let index = start; index <= length - remaining; index += 1) {
    yield* indexCombinations(length, size, index + 1, [...prefix, index]);
  }
}

export function orderedSubsequences(events, size) {
  assertTrace(events);
  if (!Number.isSafeInteger(size) || size < 0 || size > events.length) {
    throw new RangeError('TRACE.MINIMIZER.INVALID_SUBSEQUENCE_SIZE');
  }

  return [...indexCombinations(events.length, size)].map((indices) => ({
    events: indices.map((index) => structuredClone(events[index])),
    sourceIndices: indices.map((index) => index + 1),
  }));
}

export async function minimizeTrace(events, reproduces) {
  assertTrace(events);
  if (events.length === 0) {
    throw new Error('TRACE.MINIMIZER.EVENTS_REQUIRED');
  }
  if (typeof reproduces !== 'function') {
    throw new TypeError('TRACE.MINIMIZER.REPRODUCER_REQUIRED');
  }

  let testedCandidates = 0;
  for (let size = 1; size <= events.length; size += 1) {
    for (const candidate of orderedSubsequences(events, size)) {
      testedCandidates += 1;
      if (await reproduces(structuredClone(candidate.events))) {
        return {
          events: candidate.events,
          sourceIndices: candidate.sourceIndices,
          testedCandidates,
        };
      }
    }
  }

  throw new Error('TRACE.MINIMIZER.NO_REPRODUCING_SUBSEQUENCE');
}
