export const BrainStatus = Object.freeze({
  COMPLETED: 'COMPLETED',
  UNAVAILABLE: 'UNAVAILABLE',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
});

function cleanText(value, maximumLength = 8_000) {
  return String(value ?? '').trim().slice(0, maximumLength);
}

export class DisabledBrain {
  async respond(request) {
    return Object.freeze({
      status: BrainStatus.UNAVAILABLE,
      turnId: request?.turnId ?? null,
      text: '',
      language: request?.language ?? 'und',
      provider: 'disabled',
      model: 'none',
      errorCode: 'BRAIN.PROVIDER.UNAVAILABLE',
    });
  }
}

// This provider exists only to validate the complete local orchestration and
// speech-output path. It does not imitate an AI answer and never repeats the
// user's transcript, reducing accidental content exposure during smoke tests.
export class DevelopmentAcknowledgementBrain {
  async respond(request) {
    const turnId = cleanText(request?.turnId, 256);
    const transcript = cleanText(request?.transcript);
    if (!turnId || !transcript) {
      return Object.freeze({
        status: BrainStatus.FAILED,
        turnId: turnId || null,
        text: '',
        language: request?.language ?? 'und',
        provider: 'development-ack',
        model: 'deterministic-v1',
        errorCode: 'BRAIN.REQUEST.INVALID',
      });
    }

    const language = String(request?.language ?? '').toLowerCase();
    const text = language.startsWith('de')
      ? 'Ich bin da. Der lokale Birdie Dialogpfad funktioniert.'
      : 'I am here. The local Birdie conversation path is working.';

    return Object.freeze({
      status: BrainStatus.COMPLETED,
      turnId,
      text,
      language: language || 'und',
      provider: 'development-ack',
      model: 'deterministic-v1',
      errorCode: null,
    });
  }
}

export function createBrainFromEnvironment(environment = process.env) {
  const requested = String(
    environment.BIRDIE_BRAIN_PROVIDER ?? 'disabled',
  ).trim().toLowerCase();

  if (requested === 'development-ack') {
    return Object.freeze({
      brain: new DevelopmentAcknowledgementBrain(),
      provider: 'development-ack',
      status: 'READY',
      errorCode: null,
    });
  }

  return Object.freeze({
    brain: new DisabledBrain(),
    provider: 'disabled',
    status: 'UNAVAILABLE',
    errorCode: requested === 'disabled'
      ? 'BRAIN.PROVIDER.UNAVAILABLE'
      : 'BRAIN.PROVIDER.UNKNOWN',
  });
}
