import {
  HOLE_STATUSES,
  LOCATION_EVENT_TYPES,
  OBJECT_STATES,
  PLAY_SESSION_STATUSES,
  ROUND_MODE_RULE_VERSION,
  ROUND_STATUSES,
  RoundModeValidationError,
  assertRuleVersion,
  nextObjectState,
  normalizeLocationInput,
  requireEnum,
  requireNonNegativeInteger,
  requirePositiveInteger,
  requireString
} from "./model.mjs";

function clone(value) {
  return structuredClone(value);
}

function defaultIdFactory(prefix, counter) {
  return `${prefix}-${String(counter).padStart(4, "0")}`;
}

export function createRoundModeSandbox({
  now = () => new Date().toISOString(),
  idFactory = defaultIdFactory
} = {}) {
  const rounds = [];
  const roundHoles = [];
  const objectPlaySessions = [];
  const objectLocationEvents = [];
  const objectStates = new Map();
  const counters = new Map();

  function nextId(prefix) {
    const next = (counters.get(prefix) || 0) + 1;
    counters.set(prefix, next);
    return idFactory(prefix, next);
  }

  function findRound(roundId) {
    const round = rounds.find((item) => item.roundId === roundId);
    if (!round) throw new RoundModeValidationError("ROUND_NOT_FOUND", `Round ${roundId} not found`);
    return round;
  }

  function findHole(roundId, holeNumber) {
    const hole = roundHoles.find(
      (item) => item.roundId === roundId && item.holeNumber === holeNumber
    );
    if (!hole) {
      throw new RoundModeValidationError(
        "ROUND_HOLE_NOT_FOUND",
        `Hole ${holeNumber} not found in round ${roundId}`
      );
    }
    return hole;
  }

  function getObjectStateRecord(objectId) {
    return objectStates.get(objectId) || {
      objectId,
      state: "RESTING",
      roundId: null,
      activeSessionId: null,
      updatedAt: null,
      ruleVersion: ROUND_MODE_RULE_VERSION
    };
  }

  function setObjectState(objectId, event, { roundId = null, activeSessionId = null } = {}) {
    const current = getObjectStateRecord(objectId);
    const next = nextObjectState(current.state, event);
    const record = {
      objectId,
      state: next,
      roundId: next === "RESTING" ? null : roundId ?? current.roundId,
      activeSessionId: next === "IN_PLAY" ? activeSessionId : null,
      updatedAt: now(),
      ruleVersion: ROUND_MODE_RULE_VERSION
    };
    objectStates.set(objectId, record);
    return record;
  }

  function activeSessionForRound(roundId) {
    return objectPlaySessions.find(
      (session) => session.roundId === roundId && session.status === "ACTIVE"
    );
  }

  function activeSessionForObject(objectId) {
    return objectPlaySessions.find(
      (session) => session.objectId === objectId && session.status === "ACTIVE"
    );
  }

  function closeSession(session, status) {
    requireEnum(status, "status", PLAY_SESSION_STATUSES);
    session.status = status;
    session.endedAt = now();
    return session;
  }

  function createLocationEvent(input) {
    const round = findRound(requireString(input.roundId, "roundId", 100));
    if (round.status !== "ACTIVE") {
      throw new RoundModeValidationError(
        "ROUND_NOT_ACTIVE",
        `Round ${round.roundId} is not active`
      );
    }
    const objectId = requireString(input.objectId, "objectId", 100);
    const birdieId = requireString(input.birdieId, "birdieId", 100);
    const eventType = requireEnum(input.eventType, "eventType", LOCATION_EVENT_TYPES);
    const location = normalizeLocationInput(input);
    const record = {
      locationEventId: nextId("LOC"),
      roundId: round.roundId,
      objectId,
      birdieId,
      eventType,
      visibility: location.visibility,
      locationLabel: location.locationLabel,
      latitude: location.latitude,
      longitude: location.longitude,
      exactLocationOptIn: location.exactLocationOptIn,
      recordedAt: now(),
      ruleVersion: round.ruleVersion,
      sandbox: true
    };
    objectLocationEvents.push(record);
    return clone(record);
  }

  function latestLocationEventForObject(objectId) {
    for (let index = objectLocationEvents.length - 1; index >= 0; index -= 1) {
      if (objectLocationEvents[index].objectId === objectId) return objectLocationEvents[index];
    }
    return null;
  }

  return {
    getRuleVersion() {
      return ROUND_MODE_RULE_VERSION;
    },

    startRound(input = {}) {
      const birdieId = requireString(input.birdieId, "birdieId", 100);
      const holeCount = requirePositiveInteger(input.holeCount || 18, "holeCount", 18);
      const ruleVersion = assertRuleVersion(input.ruleVersion);
      const round = {
        roundId: nextId("ROUND"),
        birdieId,
        courseRef: input.courseRef ? requireString(input.courseRef, "courseRef", 180) : null,
        status: "ACTIVE",
        holeCount,
        startedAt: now(),
        endedAt: null,
        ruleVersion,
        sandbox: true
      };
      rounds.push(round);
      for (let holeNumber = 1; holeNumber <= holeCount; holeNumber += 1) {
        roundHoles.push({
          roundHoleId: nextId("HOLE"),
          roundId: round.roundId,
          holeNumber,
          status: "PENDING",
          startedAt: null,
          completedAt: null,
          strokes: null,
          putts: null,
          penalties: null,
          scoreEnteredAt: null,
          scoreRevision: 0,
          scoreSource: null,
          ruleVersion,
          sandbox: true
        });
      }
      return clone(round);
    },

    activateHole(roundId, holeNumber) {
      const round = findRound(requireString(roundId, "roundId", 100));
      if (round.status !== "ACTIVE") {
        throw new RoundModeValidationError("ROUND_NOT_ACTIVE", `Round ${roundId} is not active`);
      }
      const hole = findHole(roundId, requirePositiveInteger(holeNumber, "holeNumber", round.holeCount));
      if (hole.status === "COMPLETED") {
        throw new RoundModeValidationError("HOLE_ALREADY_COMPLETED", `Hole ${holeNumber} is complete`);
      }
      for (const other of roundHoles) {
        if (other.roundId === roundId && other.status === "ACTIVE" && other !== hole) {
          throw new RoundModeValidationError(
            "ANOTHER_HOLE_ACTIVE",
            `Hole ${other.holeNumber} is already active`
          );
        }
      }
      hole.status = "ACTIVE";
      hole.startedAt ||= now();
      return clone(hole);
    },

    recordHoleScore(roundId, holeNumber, input = {}) {
      const round = findRound(requireString(roundId, "roundId", 100));
      if (round.status !== "ACTIVE") {
        throw new RoundModeValidationError("ROUND_NOT_ACTIVE", `Round ${roundId} is not active`);
      }
      const hole = findHole(roundId, requirePositiveInteger(holeNumber, "holeNumber", round.holeCount));
      if (hole.status === "PENDING") {
        throw new RoundModeValidationError(
          "HOLE_NOT_STARTED",
          `Hole ${holeNumber} must be activated before score entry`
        );
      }
      hole.strokes = requirePositiveInteger(input.strokes, "strokes", 30);
      hole.putts = input.putts === undefined || input.putts === null
        ? null
        : requireNonNegativeInteger(input.putts, "putts", 20);
      hole.penalties = input.penalties === undefined || input.penalties === null
        ? null
        : requireNonNegativeInteger(input.penalties, "penalties", 20);
      hole.scoreEnteredAt = now();
      hole.scoreRevision += 1;
      hole.scoreSource = "USER_ENTERED_SANDBOX";
      return clone(hole);
    },

    completeHole(roundId, holeNumber) {
      const round = findRound(requireString(roundId, "roundId", 100));
      const hole = findHole(roundId, requirePositiveInteger(holeNumber, "holeNumber", round.holeCount));
      if (hole.status !== "ACTIVE") {
        throw new RoundModeValidationError("HOLE_NOT_ACTIVE", `Hole ${holeNumber} is not active`);
      }
      hole.status = "COMPLETED";
      hole.completedAt = now();
      return clone(hole);
    },

    getScorecard(roundId) {
      const round = findRound(requireString(roundId, "roundId", 100));
      const holes = roundHoles
        .filter((hole) => hole.roundId === round.roundId)
        .sort((a, b) => a.holeNumber - b.holeNumber);
      const scored = holes.filter((hole) => hole.strokes !== null);
      const puttValues = scored.filter((hole) => hole.putts !== null);
      const penaltyValues = scored.filter((hole) => hole.penalties !== null);
      return clone({
        roundId: round.roundId,
        birdieId: round.birdieId,
        courseRef: round.courseRef,
        status: round.status,
        ruleVersion: round.ruleVersion,
        holeCount: round.holeCount,
        scoredHoles: scored.length,
        unscoredHoles: holes.length - scored.length,
        scoreComplete: scored.length === holes.length,
        totals: {
          strokes: scored.reduce((sum, hole) => sum + hole.strokes, 0),
          putts: puttValues.reduce((sum, hole) => sum + hole.putts, 0),
          penalties: penaltyValues.reduce((sum, hole) => sum + hole.penalties, 0)
        },
        holes: holes.map((hole) => ({
          holeNumber: hole.holeNumber,
          status: hole.status,
          strokes: hole.strokes,
          putts: hole.putts,
          penalties: hole.penalties,
          scoreRevision: hole.scoreRevision,
          scoreSource: hole.scoreSource
        })),
        courseDataMode: round.courseRef ? "REFERENCE_ONLY" : "UNSPECIFIED",
        gpsDataUsed: false,
        sandbox: true
      });
    },

    selectObject(input = {}) {
      const round = findRound(requireString(input.roundId, "roundId", 100));
      if (round.status !== "ACTIVE") {
        throw new RoundModeValidationError("ROUND_NOT_ACTIVE", `Round ${round.roundId} is not active`);
      }
      const birdieId = requireString(input.birdieId, "birdieId", 100);
      if (birdieId !== round.birdieId) {
        throw new RoundModeValidationError(
          "ROUND_OWNER_MISMATCH",
          "birdieId must match the sandbox round owner"
        );
      }
      const objectId = requireString(input.objectId, "objectId", 100);
      const objectState = getObjectStateRecord(objectId);
      if (!OBJECT_STATES.includes(objectState.state)) {
        throw new RoundModeValidationError("INVALID_OBJECT_STATE", "Unknown object state");
      }
      if (!["RESTING", "FOUND"].includes(objectState.state)) {
        throw new RoundModeValidationError(
          "OBJECT_NOT_SELECTABLE",
          `Object ${objectId} cannot be selected from ${objectState.state}`
        );
      }
      const existingRoundSession = activeSessionForRound(round.roundId);
      if (existingRoundSession) {
        throw new RoundModeValidationError(
          "ROUND_ALREADY_HAS_ACTIVE_OBJECT",
          `Round ${round.roundId} already has object ${existingRoundSession.objectId} in play`
        );
      }
      const session = {
        playSessionId: nextId("PLAY"),
        roundId: round.roundId,
        roundHoleId: input.holeNumber
          ? findHole(round.roundId, requirePositiveInteger(input.holeNumber, "holeNumber", round.holeCount))
              .roundHoleId
          : null,
        objectId,
        birdieId,
        status: "ACTIVE",
        startedAt: now(),
        endedAt: null,
        ruleVersion: round.ruleVersion,
        sandbox: true
      };
      objectPlaySessions.push(session);
      setObjectState(objectId, "SELECT_FOR_PLAY", {
        roundId: round.roundId,
        activeSessionId: session.playSessionId
      });
      return clone(session);
    },

    switchObject(input = {}) {
      const roundId = requireString(input.roundId, "roundId", 100);
      const current = activeSessionForRound(roundId);
      if (!current) {
        throw new RoundModeValidationError("NO_ACTIVE_OBJECT", `Round ${roundId} has no active object`);
      }
      if (input.fromObjectId && current.objectId !== input.fromObjectId) {
        throw new RoundModeValidationError(
          "ACTIVE_OBJECT_MISMATCH",
          `Expected ${current.objectId} as the active object`
        );
      }
      closeSession(current, "SWITCHED_OUT");
      setObjectState(current.objectId, "SWITCH_OUT");
      return this.selectObject({
        roundId,
        objectId: requireString(input.toObjectId, "toObjectId", 100),
        birdieId: requireString(input.birdieId, "birdieId", 100),
        holeNumber: input.holeNumber
      });
    },

    recordLocation(input = {}) {
      return createLocationEvent({ ...input, eventType: input.eventType || "LAST_SEEN" });
    },

    getPrivacySafeLastSeen(objectId) {
      const normalizedObjectId = requireString(objectId, "objectId", 100);
      const event = latestLocationEventForObject(normalizedObjectId);
      if (!event) return null;
      return clone({
        objectId: event.objectId,
        roundId: event.roundId,
        eventType: event.eventType,
        recordedAt: event.recordedAt,
        visibility: event.visibility,
        locationLabel: event.visibility === "PRIVATE" ? null : event.locationLabel,
        privateLocationRecorded: event.visibility === "PRIVATE",
        exactCoordinatesStoredPrivately: event.latitude !== null && event.longitude !== null,
        latitude: null,
        longitude: null,
        ruleVersion: event.ruleVersion,
        sandbox: true
      });
    },

    markLost(input = {}) {
      const roundId = requireString(input.roundId, "roundId", 100);
      const objectId = requireString(input.objectId, "objectId", 100);
      const session = activeSessionForObject(objectId);
      if (!session || session.roundId !== roundId) {
        throw new RoundModeValidationError(
          "OBJECT_NOT_IN_PLAY",
          `Object ${objectId} is not active in round ${roundId}`
        );
      }
      closeSession(session, "LOST");
      setObjectState(objectId, "MARK_LOST", { roundId });
      return createLocationEvent({
        ...input,
        roundId,
        objectId,
        eventType: "LOST",
        visibility: input.visibility || "PRIVATE"
      });
    },

    markFound(input = {}) {
      const roundId = requireString(input.roundId, "roundId", 100);
      const objectId = requireString(input.objectId, "objectId", 100);
      const current = getObjectStateRecord(objectId);
      if (current.state !== "LOST") {
        throw new RoundModeValidationError(
          "OBJECT_NOT_LOST",
          `Object ${objectId} is ${current.state}, not LOST`
        );
      }
      setObjectState(objectId, "MARK_FOUND", { roundId });
      return createLocationEvent({
        ...input,
        roundId,
        objectId,
        eventType: "FOUND",
        visibility: input.visibility || "PRIVATE"
      });
    },

    endRound(roundId) {
      const round = findRound(requireString(roundId, "roundId", 100));
      if (round.status !== "ACTIVE") {
        throw new RoundModeValidationError("ROUND_NOT_ACTIVE", `Round ${roundId} is not active`);
      }
      const active = activeSessionForRound(roundId);
      if (active) {
        closeSession(active, "ENDED");
        setObjectState(active.objectId, "END_ROUND");
      }
      round.status = "COMPLETED";
      round.endedAt = now();
      return clone(round);
    },

    getObjectState(objectId) {
      return clone(getObjectStateRecord(requireString(objectId, "objectId", 100)));
    },

    snapshot() {
      return clone({
        ROUNDS: rounds,
        ROUND_HOLES: roundHoles,
        OBJECT_PLAY_SESSIONS: objectPlaySessions,
        OBJECT_LOCATION_EVENTS: objectLocationEvents,
        OBJECT_STATES: [...objectStates.values()],
        ruleVersion: ROUND_MODE_RULE_VERSION,
        sandbox: true
      });
    }
  };
}
