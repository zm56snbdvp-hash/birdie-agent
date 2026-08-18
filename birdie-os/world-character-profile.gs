/**
 * BIRDIE OS — BirdieWorld Character Profiles V1
 * Persists exactly one character profile per authenticated birdieId.
 * Economic state is never accepted or written here.
 */
var BIRDIE_WORLD_CHARACTER_SHEET_ = "WORLD_CHARACTER_PROFILES";
var BIRDIE_WORLD_CHARACTER_HEADERS_ = [
  "birdieId","displayName","story","style","hair","face","outfit","accessories","color","createdAt","updatedAt","schemaVersion"
];

function handleBirdieWorldCharacterAuthorizedAction_(request) {
  request = request || {};
  if (String(request.source || "") !== "Birdie Agent BirdieWorld V1") throw new Error("BIRDIE_WORLD_TRUSTED_SOURCE_REQUIRED");
  var birdieId = String(request.authBirdieId || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(birdieId)) throw new Error("INVALID_BIRDIE_WORLD_AUTH_BIRDIE_ID");
  switch (String(request.action || "")) {
    case "worldGetCharacter": return birdieWorldGetCharacter_(birdieId);
    case "worldSaveCharacter": return birdieWorldSaveCharacter_(birdieId, request.character || {});
    default: throw new Error("UNKNOWN_BIRDIE_WORLD_CHARACTER_ACTION");
  }
}

function birdieWorldCharacterSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(BIRDIE_WORLD_CHARACTER_SHEET_);
  if (!sheet) {
    sheet = ss.insertSheet(BIRDIE_WORLD_CHARACTER_SHEET_);
    sheet.getRange(1,1,1,BIRDIE_WORLD_CHARACTER_HEADERS_.length).setValues([BIRDIE_WORLD_CHARACTER_HEADERS_]);
  }
  return sheet;
}

function birdieWorldGetCharacter_(birdieId) {
  var sheet = birdieWorldCharacterSheet_();
  if (sheet.getLastRow() < 2) return { success:true, data:null };
  var values = sheet.getDataRange().getValues();
  for (var r=1;r<values.length;r++) {
    if (String(values[r][0]) === birdieId) {
      var out = {};
      BIRDIE_WORLD_CHARACTER_HEADERS_.forEach(function(h,i){ out[h]=values[r][i]; });
      return { success:true, data:out };
    }
  }
  return { success:true, data:null };
}

function birdieWorldSaveCharacter_(birdieId, character) {
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var allowedStory = ["ENTDECKER","STRATEGE","GENIESSER"];
    var displayName = String(character.displayName || "").trim();
    if (!displayName || displayName.length > 40) throw new Error("INVALID_CHARACTER_NAME");
    var story = String(character.story || "ENTDECKER").toUpperCase();
    if (allowedStory.indexOf(story) < 0) throw new Error("INVALID_CHARACTER_STORY");
    function clean(v, fallback) {
      var s = String(v || fallback || "").trim();
      if (!/^[A-Za-z0-9._-]{1,80}$/.test(s)) throw new Error("INVALID_CHARACTER_FIELD");
      return s;
    }
    var now = new Date().toISOString();
    var sheet = birdieWorldCharacterSheet_();
    var existingRow = 0, createdAt = now;
    if (sheet.getLastRow() >= 2) {
      var ids = sheet.getRange(2,1,sheet.getLastRow()-1,1).getValues();
      for (var i=0;i<ids.length;i++) if (String(ids[i][0]) === birdieId) { existingRow=i+2; break; }
      if (existingRow) createdAt = String(sheet.getRange(existingRow,10).getValue() || now);
    }
    var row = [birdieId,displayName,story,clean(character.style,"CLASSIC"),clean(character.hair,"DEFAULT"),clean(character.face,"DEFAULT"),clean(character.outfit,"TRAVEL"),clean(character.accessories,"NONE"),clean(character.color,"FOREST"),createdAt,now,"birdieworld-character/v1"];
    if (existingRow) sheet.getRange(existingRow,1,1,row.length).setValues([row]); else sheet.appendRow(row);
    var out = {}; BIRDIE_WORLD_CHARACTER_HEADERS_.forEach(function(h,i){ out[h]=row[i]; });
    return { success:true, data:out };
  } finally { lock.releaseLock(); }
}
