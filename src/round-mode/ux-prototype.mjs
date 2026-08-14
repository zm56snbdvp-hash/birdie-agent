export const UX_SCREEN_IDS = Object.freeze([
  "ROUND_HOME",
  "SCORECARD",
  "MY_GOLF",
  "COLLECTION",
  "LOST_IN_THE_WILD",
  "YOU_FOUND_A_BIRDIE"
]);

export const UX_BOTTOM_NAV = Object.freeze([
  { id: "ROUND_HOME", label: "Round" },
  { id: "MY_GOLF", label: "My Golf" },
  { id: "COLLECTION", label: "Collection" }
]);

function clone(value) {
  return structuredClone(value);
}

function assertScreen(screenId) {
  if (!UX_SCREEN_IDS.includes(screenId)) {
    throw new Error(`Unknown UX screen: ${screenId}`);
  }
  return screenId;
}

export function createSandboxUxFixture() {
  return {
    sandbox: true,
    dataClassification: "SYNTHETIC_ONLY",
    platformDecision: "UNDECIDED",
    hardwareIdentification: "ABSTRACT",
    profile: {
      birdieId: "BIRDIE-SANDBOX-UX",
      displayName: "Sandbox Birdie"
    },
    round: {
      roundId: "ROUND-SANDBOX-UX",
      courseRef: "SANDBOX-COURSE",
      courseDataMode: "REFERENCE_ONLY",
      status: "ACTIVE",
      holeCount: 3,
      currentHole: 2,
      activeObjectId: "BALL-SANDBOX-B",
      score: {
        scoredHoles: 2,
        totalStrokes: 9,
        totalPutts: 4,
        totalPenalties: 1,
        holes: [
          { holeNumber: 1, strokes: 4, putts: 2, penalties: 0, status: "COMPLETED" },
          { holeNumber: 2, strokes: 5, putts: 2, penalties: 1, status: "ACTIVE" },
          { holeNumber: 3, strokes: null, putts: null, penalties: null, status: "PENDING" }
        ]
      }
    },
    collection: [
      {
        objectId: "BALL-SANDBOX-A",
        displayName: "Birdie A",
        objectState: "RESTING",
        identityLabel: "Birdie identity",
        identityTechnology: null
      },
      {
        objectId: "BALL-SANDBOX-B",
        displayName: "Birdie B",
        objectState: "IN_PLAY",
        identityLabel: "Birdie identity",
        identityTechnology: null
      }
    ],
    lostBirdie: {
      objectId: "BALL-SANDBOX-B",
      displayName: "Birdie B",
      state: "LOST",
      privacySafeLastSeen: {
        visibility: "PRIVATE",
        locationLabel: null,
        privateLocationRecorded: true,
        exactCoordinatesStoredPrivately: false,
        latitude: null,
        longitude: null,
        recordedAt: "2026-08-12T11:00:00.000Z"
      }
    },
    foundBirdie: {
      objectId: "BALL-SANDBOX-FOUND",
      displayName: "Found Birdie",
      ownershipState: "UNCLAIMED_SANDBOX",
      identificationAction: "IDENTIFY_BIRDIE_ABSTRACTLY",
      transferEnabled: false,
      coinEffectEnabled: false
    }
  };
}

export function createRoundModeUxPrototype(fixture = createSandboxUxFixture()) {
  if (fixture?.sandbox !== true || fixture?.dataClassification !== "SYNTHETIC_ONLY") {
    throw new Error("UX prototype accepts synthetic sandbox data only");
  }

  let activeScreen = "ROUND_HOME";
  const history = [activeScreen];
  const state = clone(fixture);

  function navigation() {
    return {
      activeScreen,
      bottomNav: UX_BOTTOM_NAV.map((item) => ({
        ...item,
        active: item.id === activeScreen
      }))
    };
  }

  function roundHomeView() {
    return {
      screenId: "ROUND_HOME",
      eyebrow: "Round Mode · Sandbox",
      title: `Hole ${state.round.currentHole} of ${state.round.holeCount}`,
      primaryMetric: `${state.round.score.totalStrokes} strokes`,
      secondaryMetric: `${state.round.score.totalPutts} putts · ${state.round.score.totalPenalties} penalty`,
      activeBirdie: state.collection.find((item) => item.objectId === state.round.activeObjectId),
      actions: [
        { id: "OPEN_SCORECARD", label: "Scorecard" },
        { id: "OPEN_LOST", label: "Birdie lost" },
        { id: "SWITCH_BIRDIE", label: "Switch Birdie" }
      ],
      privacyNote: "Exact location stays private by default."
    };
  }

  function scorecardView() {
    return {
      screenId: "SCORECARD",
      eyebrow: "Scorecard · Sandbox",
      title: state.round.courseRef,
      totals: {
        strokes: state.round.score.totalStrokes,
        putts: state.round.score.totalPutts,
        penalties: state.round.score.totalPenalties
      },
      holes: clone(state.round.score.holes),
      courseDataMode: state.round.courseDataMode,
      gpsDataUsed: false,
      note: "Par and GPS facts are not invented in the prototype."
    };
  }

  function myGolfView() {
    return {
      screenId: "MY_GOLF",
      eyebrow: "My Golf · Sandbox",
      title: "Your round",
      cards: [
        {
          id: state.round.roundId,
          status: state.round.status,
          courseRef: state.round.courseRef,
          progress: `${state.round.score.scoredHoles}/${state.round.holeCount} holes scored`,
          strokes: state.round.score.totalStrokes
        }
      ],
      platformDecision: state.platformDecision
    };
  }

  function collectionView() {
    return {
      screenId: "COLLECTION",
      eyebrow: "My Birdie Collection · Sandbox",
      title: "Your Birdies",
      objects: clone(state.collection),
      identificationMode: state.hardwareIdentification,
      note: "Identity technology stays abstract; the prototype makes no hardware choice."
    };
  }

  function lostView() {
    const lastSeen = state.lostBirdie.privacySafeLastSeen;
    return {
      screenId: "LOST_IN_THE_WILD",
      eyebrow: "Lost in the Wild · Sandbox",
      title: `${state.lostBirdie.displayName} is lost`,
      status: state.lostBirdie.state,
      lastSeen: {
        label: lastSeen.locationLabel || "Private location saved",
        visibility: lastSeen.visibility,
        recordedAt: lastSeen.recordedAt,
        latitude: null,
        longitude: null
      },
      actions: [
        { id: "MARK_FOUND_LOCAL", label: "I found my Birdie" },
        { id: "BACK_TO_ROUND", label: "Back to round" }
      ],
      privacyNote: "The UX never exposes exact coordinates."
    };
  }

  function foundView() {
    return {
      screenId: "YOU_FOUND_A_BIRDIE",
      eyebrow: "You Found a Birdie · Sandbox",
      title: "Nice find.",
      body: "Identify the Birdie without choosing an identification technology. Ownership transfer is not executed in this prototype.",
      object: clone(state.foundBirdie),
      actions: [
        { id: "IDENTIFY_BIRDIE", label: "Identify this Birdie" },
        { id: "KEEP_SAFE", label: "Keep it safe for now" }
      ]
    };
  }

  function getView(screenId = activeScreen) {
    switch (assertScreen(screenId)) {
      case "ROUND_HOME": return roundHomeView();
      case "SCORECARD": return scorecardView();
      case "MY_GOLF": return myGolfView();
      case "COLLECTION": return collectionView();
      case "LOST_IN_THE_WILD": return lostView();
      case "YOU_FOUND_A_BIRDIE": return foundView();
      default: throw new Error("Unreachable UX screen");
    }
  }

  return {
    navigate(screenId) {
      activeScreen = assertScreen(screenId);
      history.push(activeScreen);
      return clone(getView());
    },
    getView(screenId) {
      return clone(getView(screenId));
    },
    getNavigation() {
      return clone(navigation());
    },
    getHistory() {
      return [...history];
    },
    snapshot() {
      return clone({
        activeScreen,
        navigation: navigation(),
        fixture: state,
        currentView: getView()
      });
    }
  };
}
