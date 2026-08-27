import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

function extractRunBlocks(source) {
  const lines = source.split("\n");
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^ {8}run: \|$/.test(lines[index])) continue;
    const block = [];
    for (index += 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (line === "") {
        block.push("");
        continue;
      }
      if (!line.startsWith("          ")) {
        index -= 1;
        break;
      }
      block.push(line.slice(10));
    }
    blocks.push(block.join("\n"));
  }
  return blocks;
}

test("BirdieWorld Beta wires the cinematic, creator and ready journey", () => {
  const bootstrap = read("clients/unity/BirdieWorld/Assets/BirdieWorld/Scripts/BirdieWorldBetaBootstrap.cs");
  const avatar = read("clients/unity/BirdieWorld/Assets/BirdieWorld/Scripts/BirdieWorldAvatarPreview.cs");
  assert.match(bootstrap, /BuildCinematicOpener\(\)/);
  assert.match(bootstrap, /AddComponent<BirdieWorldCinematicOpener>\(\)/);
  assert.match(bootstrap, /BuildReadyScreen\(\)/);
  assert.match(bootstrap, /ShowReady\(/);
  assert.match(bootstrap, /DEIN BIRDIE IST BEREIT\./);
  assert.match(bootstrap, /AddComponent<BirdieWorldAvatarPreview>\(\)/);
  assert.match(bootstrap, /RefreshCreatorPreview\(\)/);
  assert.doesNotMatch(bootstrap, /3D CHARACTER PREVIEW|Avatar-Renderer kommt/);
  assert.match(avatar, /HumanAvatarPreview/);
  assert.match(avatar, /public void Apply\(CharacterProfile profile, string liveName\)/);
  assert.match(avatar, /StoryName\(profile\.story\)/);
  assert.match(avatar, /SignatureColor\(profile\.color\)/);
  assert.doesNotMatch(avatar, /bird mascot|mascot|leni/i);
});

test("the final art direction is required at build time and remains runtime-optional", () => {
  const helper = read("clients/unity/BirdieWorld/Assets/BirdieWorld/Scripts/BirdieWorldArt.cs");
  const opener = read("clients/unity/BirdieWorld/Assets/BirdieWorld/Scripts/BirdieWorldCinematicOpener.cs");
  const bootstrap = read("clients/unity/BirdieWorld/Assets/BirdieWorld/Scripts/BirdieWorldBetaBootstrap.cs");
  const avatar = read("clients/unity/BirdieWorld/Assets/BirdieWorld/Scripts/BirdieWorldAvatarPreview.cs");
  const journey = read("clients/unity/BirdieWorld/Assets/BirdieWorld/Scripts/BirdieWorldFirstJourney.cs");
  const builder = read("clients/unity/BirdieWorld/Assets/BirdieWorld/Editor/BirdieWorldWebBuild.cs");
  const assets = ["express-hero.png", "platform-night.png", "express-journey.png", "nest-forecourt.png", "avatar-human.png"];
  for (const asset of assets) {
    assert.equal(fs.existsSync(path.join(root, "clients/unity/BirdieWorld/Assets/BirdieWorld/Resources/BirdieWorldArt", asset)), true, asset);
    assert.match(builder, new RegExp(asset.replace(".", "\\.")));
  }
  assert.match(helper, /Resources\.Load<Texture2D>\(resourcePath\)/);
  assert.match(helper, /if \(texture == null\) return null/);
  assert.match(opener, /BirdieWorldArt\/express-hero/);
  assert.match(bootstrap, /BirdieWorldArt\/nest-forecourt/);
  assert.match(avatar, /BirdieWorldArt\/avatar-human/);
  assert.match(journey, /BirdieWorldArt\/platform-night/);
  assert.match(journey, /BirdieWorldArt\/express-journey/);
  assert.match(journey, /BirdieWorldArt\/nest-forecourt/);
  assert.match(builder, /ValidateRequiredArt\(\)/);
});

test("character choices provide immediate visual state without changing the persistence contract", () => {
  const bootstrap = read("clients/unity/BirdieWorld/Assets/BirdieWorld/Scripts/BirdieWorldBetaBootstrap.cs");
  assert.match(bootstrap, /Dictionary<string, GameObject> storyChoices/);
  assert.match(bootstrap, /Dictionary<string, GameObject> colorChoices/);
  assert.match(bootstrap, /RefreshChoiceStates\(storyChoices, profile\?\.story\)/);
  assert.match(bootstrap, /RefreshChoiceStates\(colorChoices, profile\?\.color\)/);
  assert.match(bootstrap, /profileRevision\+\+;\s*statusText\.text = \$"Story gewählt/);
  assert.match(bootstrap, /profileRevision\+\+;\s*statusText\.text = \$"Farbe gewählt/);
});

test("the Unity and WebGL shells adapt to iPhone portrait and safe-area insets", () => {
  const bootstrap = read("clients/unity/BirdieWorld/Assets/BirdieWorld/Scripts/BirdieWorldBetaBootstrap.cs");
  const cinematic = read("clients/unity/BirdieWorld/Assets/BirdieWorld/Scripts/BirdieWorldCinematicOpener.cs");
  const template = read("clients/unity/BirdieWorld/Assets/WebGLTemplates/BirdieWorldBeta/index.html");
  assert.match(bootstrap, /ApplyResponsiveLayout\(true\)/);
  assert.match(bootstrap, /layoutHeight > layoutWidth/);
  assert.match(bootstrap, /Stretch\(creatorPreviewLayout, new Vector2\(0f, 0\.58f\), Vector2\.one\)/);
  assert.match(bootstrap, /Stretch\(creatorFormLayout, Vector2\.zero, new Vector2\(1f, 0\.58f\)\)/);
  assert.match(cinematic, /ApplyResponsiveLayout\(true\)/);
  assert.match(cinematic, /layoutHeight>layoutWidth/);
  assert.match(cinematic, /Stretch\(routeLayout,new Vector2\(\.10f,\.27f\),new Vector2\(\.90f,\.59f\)\)/);
  assert.match(cinematic, /Stretch\(boardLayout,new Vector2\(\.18f,\.13f\),new Vector2\(\.82f,\.22f\)\)/);
  assert.match(template, /env\(safe-area-inset-top, 0px\)/);
  assert.match(template, /env\(safe-area-inset-bottom, 0px\)/);
  assert.match(template, /@media \(orientation: portrait\)/);
});

test("authenticated persistence isolates account state from signed-out drafts", () => {
  const bootstrap = read("clients/unity/BirdieWorld/Assets/BirdieWorld/Scripts/BirdieWorldBetaBootstrap.cs");
  assert.match(bootstrap, /new GameObject\("BirdieWorld Auth Session"\)/);
  assert.match(bootstrap, /persistence\.Initialize\(characterApi\)/);
  assert.match(bootstrap, /authSession\.Initialize\(characterApi\)/);
  assert.match(bootstrap, /if \(!profileIsAccountScoped\)\s*\{[\s\S]*?store\.Save\(profile\)/);
  assert.match(bootstrap, /if \(!persistence\.IsServerConfigured \|\| !accountProfileReady\)/);
  assert.match(bootstrap, /persistence\.LoadServerProfile\(/);
  assert.match(bootstrap, /persistence\.CancelPendingRequests\(\)/);
  assert.match(bootstrap, /nameField\.onValueChanged\.AddListener\(value =>[\s\S]*profile\.displayName = value/);
  assert.match(bootstrap, /if \(!accountProfileReady\)\s*\{\s*HandleAuthenticatedSession\(\)/);
  assert.match(bootstrap, /sessionGeneration != authSession\.Generation/);
  assert.match(bootstrap, /profileRevision/);
  assert.match(bootstrap, /accountProfileReady = true;[\s\S]*?pendingUnboundDraft = null;[\s\S]*?store\.Clear\(\)/);
  assert.match(bootstrap, /serverProfile == null && revisionAtLoad == profileRevision/);
  assert.doesNotMatch(bootstrap, /SaveFromServer/);
});

test("the Unity write DTO cannot serialize identity, timestamps or economics", () => {
  const api = read("clients/unity/BirdieWorld/Assets/BirdieWorld/Scripts/BirdieWorldCharacterApi.cs");
  const writeDto = api.slice(
    api.indexOf("public sealed class CharacterWriteData"),
    api.indexOf("public sealed class CharacterData")
  );
  for (const forbidden of [
    "birdieId",
    "characterId",
    "createdAt",
    "updatedAt",
    "coin",
    "balance",
    "points",
    "amount",
    "transaction",
    "redemption"
  ]) {
    assert.doesNotMatch(writeDto.toLowerCase(), new RegExp(forbidden.toLowerCase()));
  }
  assert.match(api, /request\.timeout = 20/);
  assert.match(api, /ProductionHost = "agent\.birdieandbreakfast\.de"/);
  assert.match(api, /uri\.IsDefaultPort/);
  assert.match(api, /uri\.AbsolutePath/);
  assert.match(api, /uri\.UserInfo/);
});

test("the WebGL auth bridge accepts an in-memory JSON session and supports account switching", () => {
  const auth = read("clients/unity/BirdieWorld/Assets/BirdieWorld/Scripts/BirdieWorldAuthSession.cs");
  const template = read("clients/unity/BirdieWorld/Assets/WebGLTemplates/BirdieWorldBeta/index.html");
  const builder = read("clients/unity/BirdieWorld/Assets/BirdieWorld/Editor/BirdieWorldWebBuild.cs");
  assert.match(auth, /public void ApplyJson\(string json\)/);
  assert.match(auth, /Generation\+\+/);
  assert.match(auth, /characterApi\?\.ClearSession\(\)/);
  assert.match(auth, /RejectConfiguration/);
  assert.match(auth, /sessionKey/);
  assert.match(auth, /Refreshed/);
  assert.match(auth, /StringComparison\.Ordinal/);
  assert.doesNotMatch(auth, /PlayerPrefs|absoluteURL|queryString/i);
  assert.match(template, /event\.origin !== window\.location\.origin/);
  assert.match(template, /SendMessage\(\s*"BirdieWorld Auth Session",\s*"ApplyJson"/);
  assert.match(template, /birdieworld:session-clear/);
  assert.match(template, /sessionKey/);
  assert.match(template, /payload\.sub/);
  assert.match(template, /payload\[birdieIdClaim\]/);
  assert.match(template, /payload\.iss/);
  assert.match(template, /https:\/\/birdieandbreakfast\.de\/birdie_id/);
  assert.match(template, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(template, /sessionRevision/);
  assert.match(template, /if \(!session\) \{\s*rejectSessionUpdate\(\)/);
  assert.doesNotMatch(template, /localStorage|sessionStorage|console\.(?:log|debug)/);
  assert.match(builder, /PlayerSettings\.WebGL\.template = "PROJECT:BirdieWorldBeta"/);
});

test("BirdieOS owns durable character identity and blocks spreadsheet formula names", () => {
  const source = read("birdie-os/world-character-profile.gs");
  assert.match(source, /"schemaVersion","characterId"/);
  assert.match(source, /Utilities\.getUuid\(\)/);
  assert.match(source, /\^\[=\+\\-@\]/);
  assert.match(source, /BIRDIE_WORLD_CHARACTER_AUTH_UNVERIFIED/);
  assert.match(source, /birdieWorldCharacterAuthScopeHook_/);
  assert.match(source, /INVALID_STORED_CHARACTER_ID/);
  assert.match(source, /DUPLICATE_BIRDIE_WORLD_CHARACTER_ID/);
  assert.doesNotMatch(source, /character\.characterId|character\.birdieId/);
  assert.match(source, /"birdieworld-character\/v1",characterId/);
});

test("build automation cannot deploy production without exact Founder confirmation", () => {
  const release = read("clients/unity/BirdieWorld/release-webgl.sh");
  const windowsBuild = read("clients/unity/BirdieWorld/build-webgl.ps1");
  const workflow = read(".github/workflows/birdieworld-webgl-deploy.yml");
  assert.match(release, /MODE="\$\{1:---build-only\}"/);
  assert.match(release, /Local production release is blocked/);
  assert.match(release, /birdieworld-files\.sha256/);
  assert.doesNotMatch(release, /deploy --prod|VERCEL_TOKEN|vercel@/);
  assert.match(workflow, /default: build-only/);
  assert.match(workflow, /accepted_run_id/);
  assert.match(workflow, /accepted_manifest_sha256/);
  assert.match(workflow, /actions\/download-artifact@[0-9a-f]{40}/);
  assert.match(workflow, /actions\/checkout@[0-9a-f]{40}/);
  assert.match(workflow, /actions\/upload-artifact@[0-9a-f]{40}/);
  assert.match(workflow, /game-ci\/unity-builder@[0-9a-f]{40}/);
  assert.match(workflow, /sha256sum --strict -c birdieworld-files\.sha256/);
  assert.match(workflow, /name: birdieworld-production/);
  assert.match(workflow, /prevent_self_review/);
  assert.match(workflow, /can_admins_bypass !== false/);
  assert.match(workflow, /BIRDIEWORLD_FOUNDER_REVIEWER_LOGIN/);
  assert.match(workflow, /deployment-branch-policies\?per_page=100/);
  assert.match(workflow, /branchPoliciesResponse\.total_count === 1/);
  assert.match(workflow, /branchPolicies\[0\]\.name === 'main'/);
  assert.match(workflow, /branchPolicies\[0\]\.type === 'branch'/);
  assert.match(workflow, /run\.path !== '\.github\/workflows\/birdieworld-webgl-deploy\.yml'/);
  assert.match(workflow, /buildJobs\[0\]\.conclusion !== 'success'/);
  assert.match(workflow, /actualPaths\.size !== paths\.size/);
  assert.match(workflow, /requiredPaths = \['\.\/index\.html', '\.\/birdieworld-build\.json', '\.\/vercel\.json'\]/);
  assert.match(workflow, /BIRDIEWORLD_INVITE_GATE_HMAC_KEY/);
  assert.match(workflow, /birdieworld-invite-v1/);
  assert.match(workflow, /ageMs > 30 \* 60 \* 1000/);
  assert.match(workflow, /GO_BIRDIEWORLD_CHARACTER_BETA_02/);
  assert.doesNotMatch(workflow, /GO_BIRDIEWORLD_CHARACTER_BETA_01/);
  assert.match(workflow, /vercel@59\.5\.0/);
  assert.doesNotMatch(workflow, /vercel@latest/);
  assert.match(workflow, /birdieworld-build\.json/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.doesNotMatch(workflow, /^\s+push:/m);
  assert.match(windowsBuild, /6000\.0\.76f1/);
  assert.match(windowsBuild, /BirdieWorld\.Editor\.BirdieWorldWebBuild\.BuildWebGL/);
  assert.match(windowsBuild, /birdieworld:session/);
  assert.match(windowsBuild, /birdieworld-build\.json/);
  assert.match(windowsBuild, /birdieworld-files\.sha256/);
  assert.match(windowsBuild, /sourceSha/);
  assert.match(release, /sha256sum[\s\S]*shasum -a 256/);
  assert.doesNotMatch(windowsBuild, /vercel|deploy/i);
});

test("BirdieWorld release actions are immutable and every shell block parses", () => {
  const workflow = read(".github/workflows/birdieworld-webgl-deploy.yml");
  const actions = [...workflow.matchAll(/^\s*uses:\s*([^\s#]+)/gm)].map((match) => match[1]);
  assert.equal(actions.length, 4);
  for (const action of actions) assert.match(action, /^[^@]+@[0-9a-f]{40}$/);

  const blocks = extractRunBlocks(workflow);
  assert.ok(blocks.length >= 9);
  for (const [index, block] of blocks.entries()) {
    const parsed = spawnSync("bash", ["-n"], { encoding: "utf8", input: block });
    assert.equal(parsed.status, 0, `BirdieWorld run block ${index + 1}: ${parsed.stderr}`);
  }
});

test("invite-only receipt is project-bound and expires", () => {
  const workflow = read(".github/workflows/birdieworld-webgl-deploy.yml");
  const match = workflow.match(/      - name: Verify fresh invite-only receipt[\s\S]*?          node <<'NODE'\n([\s\S]*?)\n          NODE/);
  assert.ok(match, "invite receipt verifier must remain embedded in the protected release job");
  const verifier = match[1].replace(/^ {10}/gm, "");
  const key = "k".repeat(32);
  const orgId = "team_birdie";
  const projectId = "prj_birdieworld";
  const digest = "a".repeat(64);
  const receiptFor = (checkedAt, project = projectId) => crypto
    .createHmac("sha256", key)
    .update(["birdieworld-invite-v1", orgId, project, digest, checkedAt].join("\n"))
    .digest("hex");
  const run = (checkedAt, receipt, project = projectId) => spawnSync(process.execPath, ["-"], {
    encoding: "utf8",
    input: verifier,
    env: {
      ...process.env,
      INVITE_GATE_HMAC_KEY: key,
      INVITE_GATE_CHECKED_AT: checkedAt,
      INVITE_GATE_RECEIPT: receipt,
      ACCEPTED_MANIFEST_SHA256: digest,
      VERCEL_ORG_ID: orgId,
      VERCEL_PROJECT_ID: project
    }
  });

  const current = new Date().toISOString();
  assert.equal(run(current, receiptFor(current)).status, 0);
  assert.equal(run(current, receiptFor(current), "prj_wrong").status, 13);
  const future = new Date(Date.now() + 60 * 1000).toISOString();
  assert.equal(run(future, receiptFor(future)).status, 13);
  const stale = new Date(Date.now() - 31 * 60 * 1000).toISOString();
  assert.equal(run(stale, receiptFor(stale)).status, 13);
});
