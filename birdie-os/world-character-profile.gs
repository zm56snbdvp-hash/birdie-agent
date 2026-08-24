/**
 * BIRDIE OS — BirdieWorld Character Profiles V1
 * Persists exactly one character profile per authenticated birdieId.
 * Economic state is never accepted or written here.
 */
var BIRDIE_WORLD_CHARACTER_SHEET_ = "WORLD_CHARACTER_PROFILES";
var BIRDIE_WORLD_CHARACTER_HEADERS_ = [
  "birdieId","displayName","story","style","hair","face","outfit","accessories","color","createdAt","updatedAt","schemaVersion","characterId"
];
var BIRDIE_WORLD_CHARACTER_SCOPES_ = {
  READ: "birdie-world:character:read",
  WRITE: "birdie-world:character:write"
};
var BIRDIE_WORLD_CHARACTER_ACTIVE_AUTH_CONTEXT_ = null;

function handleBirdieWorldCharacterAuthorizedAction_(request) {
  request = request || {};
  if (String(request.source || "") !== "Birdie Agent BirdieWorld V1") throw new Error("BIRDIE_WORLD_TRUSTED_SOURCE_REQUIRED");
  var action = String(request.action || "");
  var scope = birdieWorldCharacterAuthorizedScopeForAction_(action);
  var subject = String(request.authSubject || "").trim();
  if (!/^[^\s]{1,300}$/.test(subject)) throw new Error("INVALID_BIRDIE_WORLD_AUTH_SUBJECT");
  var birdieId = String(request.authBirdieId || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(birdieId)) throw new Error("INVALID_BIRDIE_WORLD_AUTH_BIRDIE_ID");

  var previous = BIRDIE_WORLD_CHARACTER_ACTIVE_AUTH_CONTEXT_;
  BIRDIE_WORLD_CHARACTER_ACTIVE_AUTH_CONTEXT_ = {
    request: request,
    action: action,
    subject: subject,
    birdieId: birdieId,
    scope: scope
  };
  try {
    return handleBirdieWorldCharacterAction_(request);
  } finally {
    BIRDIE_WORLD_CHARACTER_ACTIVE_AUTH_CONTEXT_ = previous;
  }
}

function birdieWorldCharacterAuthorizedScopeForAction_(action) {
  switch (String(action || "")) {
    case "worldGetCharacter": return BIRDIE_WORLD_CHARACTER_SCOPES_.READ;
    case "worldSaveCharacter": return BIRDIE_WORLD_CHARACTER_SCOPES_.WRITE;
    default: throw new Error("UNKNOWN_BIRDIE_WORLD_CHARACTER_ACTION");
  }
}

function birdieWorldCharacterAuthScopeHook_(input) {
  var context = BIRDIE_WORLD_CHARACTER_ACTIVE_AUTH_CONTEXT_;
  if (
    !context ||
    context.request !== input.request ||
    context.action !== String(input.request.action || "") ||
    context.scope !== input.requiredScope
  ) throw new Error("BIRDIE_WORLD_CHARACTER_AUTH_UNVERIFIED");
  return {
    verified: true,
    subject: context.subject,
    birdieId: context.birdieId,
    scopes: [context.scope]
  };
}

function birdieWorldCharacterRequireAuthScope_(request, requiredScope) {
  var auth = birdieWorldCharacterAuthScopeHook_({ request:request, requiredScope:requiredScope });
  if (!auth.verified || auth.scopes.indexOf(requiredScope) < 0) throw new Error("BIRDIE_WORLD_CHARACTER_AUTH_UNVERIFIED");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(String(auth.birdieId || ""))) {
    throw new Error("INVALID_BIRDIE_WORLD_AUTH_BIRDIE_ID");
  }
  return auth;
}

function handleBirdieWorldCharacterAction_(request) {
  switch (String(request.action || "")) {
    case "worldGetCharacter": return birdieWorldGetCharacter_(request);
    case "worldSaveCharacter": return birdieWorldSaveCharacter_(request);
    default: throw new Error("UNKNOWN_BIRDIE_WORLD_CHARACTER_ACTION");
  }
}

function birdieWorldCharacterSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(BIRDIE_WORLD_CHARACTER_SHEET_);
  if (!sheet) {
    sheet = ss.insertSheet(BIRDIE_WORLD_CHARACTER_SHEET_);
    sheet.getRange(1,1,1,BIRDIE_WORLD_CHARACTER_HEADERS_.length).setValues([BIRDIE_WORLD_CHARACTER_HEADERS_]);
    return sheet;
  }

  var lastColumn = sheet.getLastColumn();
  if (lastColumn > BIRDIE_WORLD_CHARACTER_HEADERS_.length) {
    throw new Error("BIRDIE_WORLD_CHARACTER_HEADER_MISMATCH");
  }
  if (lastColumn > 0) {
    var existingHeaders = sheet.getRange(1,1,1,lastColumn).getValues()[0];
    var sharedLength = Math.min(existingHeaders.length, BIRDIE_WORLD_CHARACTER_HEADERS_.length);
    for (var i=0;i<sharedLength;i++) {
      if (String(existingHeaders[i]) !== BIRDIE_WORLD_CHARACTER_HEADERS_[i]) {
        throw new Error("BIRDIE_WORLD_CHARACTER_HEADER_MISMATCH");
      }
    }
  }
  if (lastColumn < BIRDIE_WORLD_CHARACTER_HEADERS_.length) {
    var missingHeaders = BIRDIE_WORLD_CHARACTER_HEADERS_.slice(lastColumn);
    sheet.getRange(1,lastColumn+1,1,missingHeaders.length).setValues([missingHeaders]);
  }
  return sheet;
}

function birdieWorldCharacterId_() {
  var characterId = String(Utilities.getUuid()).replace(/-/g, "").toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(characterId)) throw new Error("INVALID_GENERATED_CHARACTER_ID");
  return characterId;
}

function birdieWorldValidateStoredCharacterIds_(values) {
  var seen = {};
  for (var r=1;r<values.length;r++) {
    var characterId = String(values[r][12] || "").trim();
    if (!characterId) continue;
    if (!/^[a-f0-9]{32}$/.test(characterId)) throw new Error("INVALID_STORED_CHARACTER_ID");
    if (seen[characterId]) throw new Error("DUPLICATE_BIRDIE_WORLD_CHARACTER_ID");
    seen[characterId] = true;
  }
  return seen;
}

function birdieWorldNewCharacterId_(seen) {
  for (var attempt=0;attempt<3;attempt++) {
    var characterId = birdieWorldCharacterId_();
    if (!seen[characterId]) return characterId;
  }
  throw new Error("DUPLICATE_GENERATED_CHARACTER_ID");
}

function birdieWorldGetCharacter_(request) {
  var auth = birdieWorldCharacterRequireAuthScope_(request, BIRDIE_WORLD_CHARACTER_SCOPES_.READ);
  var birdieId = auth.birdieId;
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sheet = birdieWorldCharacterSheet_();
    if (sheet.getLastRow() < 2) return { success:true, data:null };
    var values = sheet.getDataRange().getValues();
    var seen = birdieWorldValidateStoredCharacterIds_(values);
    var match = null, matchRow = 0;
    for (var r=1;r<values.length;r++) {
      if (String(values[r][0]) === birdieId) {
        if (match) throw new Error("DUPLICATE_BIRDIE_WORLD_CHARACTER");
        var out = {};
        BIRDIE_WORLD_CHARACTER_HEADERS_.forEach(function(h,i){ out[h]=values[r][i]; });
        match = out;
        matchRow = r + 1;
      }
    }
    if (match && !String(match.characterId || "").trim()) {
      match.characterId = birdieWorldNewCharacterId_(seen);
      sheet.getRange(matchRow,13,1,1).setValues([[match.characterId]]);
    }
    return { success:true, data:match };
  } finally {
    lock.releaseLock();
  }
}

function birdieWorldSaveCharacter_(request) {
  var auth = birdieWorldCharacterRequireAuthScope_(request, BIRDIE_WORLD_CHARACTER_SCOPES_.WRITE);
  var birdieId = auth.birdieId;
  var character = request.character || {};
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var allowedStory = ["ENTDECKER","STRATEGE","GENIESSER"];
    var displayName = String(character.displayName || "").trim();
    if (displayName.length < 2 || displayName.length > 40 || /[\u0000-\u001F\u007F]/.test(displayName) || /^[=+\-@]/.test(displayName)) {
      throw new Error("INVALID_CHARACTER_NAME");
    }
    var story = String(character.story || "ENTDECKER").toUpperCase();
    if (allowedStory.indexOf(story) < 0) throw new Error("INVALID_CHARACTER_STORY");
    function clean(v, fallback) {
      var s = String(v || fallback || "").trim();
      if (!/^[A-Za-z0-9._-]{1,80}$/.test(s)) throw new Error("INVALID_CHARACTER_FIELD");
      return s;
    }
    var now = new Date().toISOString();
    var sheet = birdieWorldCharacterSheet_();
    var existingRow = 0, createdAt = now, characterId = "", seen = {};
    if (sheet.getLastRow() >= 2) {
      var values = sheet.getDataRange().getValues();
      seen = birdieWorldValidateStoredCharacterIds_(values);
      var ids = sheet.getRange(2,1,sheet.getLastRow()-1,1).getValues();
      for (var i=0;i<ids.length;i++) if (String(ids[i][0]) === birdieId) {
        if (existingRow) throw new Error("DUPLICATE_BIRDIE_WORLD_CHARACTER");
        existingRow=i+2;
      }
      if (existingRow) {
        createdAt = String(sheet.getRange(existingRow,10).getValue() || now);
        characterId = String(sheet.getRange(existingRow,13).getValue() || "").trim();
      }
    }
    if (!characterId) characterId = birdieWorldNewCharacterId_(seen);
    var row = [birdieId,displayName,story,clean(character.style,"CLASSIC"),clean(character.hair,"DEFAULT"),clean(character.face,"DEFAULT"),clean(character.outfit,"TRAVEL"),clean(character.accessories,"NONE"),clean(character.color,"FOREST"),createdAt,now,"birdieworld-character/v1",characterId];
    if (existingRow) sheet.getRange(existingRow,1,1,row.length).setValues([row]); else sheet.appendRow(row);
    var out = {}; BIRDIE_WORLD_CHARACTER_HEADERS_.forEach(function(h,i){ out[h]=row[i]; });
    return { success:true, data:out };
  } finally { lock.releaseLock(); }
}
