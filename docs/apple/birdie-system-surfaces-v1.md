# Birdie System Surfaces v1

Status: implementation contract for the native iOS 18 client.

## Architecture decision

Birdie uses a **staged-action architecture** for every system surface:

1. Siri, Shortcuts, Back Tap, controls, widgets, and deep links produce a typed `BirdieRoute` through `BirdieIntentCoordinator` or the app router.
2. An app-local route may contain a short-lived draft, but handling it never performs a domain write or network action. Drafts are never serialized into URLs or the App Group.
3. The iPhone app opens the matching read-only view or an explicit preview.
4. Writes and external requests are available only behind a separate in-app confirmation.

The stable contracts and minimized snapshot store live in `BirdieShared`. The iOS-18 control launch intent lives in `BirdieIntents` and is compiled into the app and widget extension. `BirdieIntentCoordinator` has only a route-staging dependency and rejects unsupported sources or any action marked for direct execution. Siri/App Shortcut intents, draft/thought storage, EventKit, Keychain, and networking remain app-only. The widget has no credential and reads only the versioned App Group snapshot plus the non-authorizing display context.

This boundary is intended for later Drop, Approval, and Recall actions: add a stable action identifier and policy first, then a preview UI and a confirmed executor. Never add a direct executor to an intent.

## Public action and entity contracts

Contract version: `BirdieActionKind.contractVersion == 1`.

| Action | Stable ID / entity ID | Risk | Intent behavior |
| --- | --- | --- | --- |
| Birdie fragen | `ask` | `stagedExternalAction` | Opens preview; sends only after in-app confirmation |
| Gedanke merken | `capture-thought` | `stagedWrite` | Opens preview; stores only after in-app confirmation |
| Briefing | `briefing` | `readOnly` | Opens Day Pilot |
| Nächster Schritt | `next-step` | `readOnly` | Opens Day Pilot and highlights the next-step entry |

All `BirdieActionEntity.id` values equal the stable action ID. Renaming an ID, intent type, shortcut phrase, widget kind, control kind, or focus raw value requires a migration.

App Shortcut types:

- `AskBirdieIntent`
- `CaptureThoughtIntent`
- `BirdieBriefingIntent`
- `BirdieNextStepIntent`

Control launch type: `OpenBirdieActionIntent`, an iOS 18 `OpenIntent` with a `BirdieActionEntity` target. It stages navigation only. Ask, capture, and control entry points require local-device authentication before their intent runs.

Focus raw values are `work`, `personal`, and `rest`. Focus selects presentation and redaction only. It is never consulted by `BirdieActionCatalog` and cannot grant calendar, reminder, write, network, or approval authority.

## Deep-link contract

Accepted version-1 links:

```text
birdie://action/ask
birdie://action/capture-thought
birdie://action/briefing
birdie://action/next-step
```

The Personal-Team variant uses the otherwise identical `birdie-personal://`
scheme so both builds can be installed at the same time without ambiguous URL
ownership.

Optional `source` and `focus` query items are parsed as untrusted input; the parsed source is always normalized to `externalDeepLink`. Draft, unknown, duplicated, empty-invalid, userinfo, port, fragment, encoded-path ambiguity, unknown schemes, hosts, actions, and extra path segments fail closed. Generated URLs never contain drafts. The app displays a preview; a deep link can never apply the represented action. Sensitive credentials must never be placed in a URL.

## Day Pilot data contract

`DayPilotSnapshot.contractVersion == 1` contains:

- generated timestamp;
- concrete next reminder/task;
- concrete next calendar event;
- open reminder count;
- open approval count and optional next approval;
- briefing text.

The phone reads calendar and reminders through separate EventKit permissions, each requested only after its own button tap. Existing authorization is read on refresh; no prompt occurs at launch. Calendar write-only access can create a confirmed event but cannot read events; the UI offers an explicit full-access upgrade. An event or reminder change follows a two-step UI: generate an immutable preview with exact destination identifier/title, start, optional end, and time zone, then confirm that same value. If the destination disappears, the commit fails and requires a new preview. Only `DayPilotEventStore.applyConfirmed` calls EventKit save APIs.

The approval provider is deliberately `unavailable` until a scoped, structured mobile endpoint exists. The app does not embed or reuse `BIRDIE_AGENT_API_KEY` and never invents approvals.

## Privacy and device behavior

- Widget payload comes from `group.de.birdieandbreakfast.birdie` (personal builds use their own configured group) and expires after six hours.
- Pending intent routes expire after five minutes; pending drafts and confirmed thoughts use app-only defaults.
- Personal titles and briefing text are marked `privacySensitive`.
- Phone and widget targets use complete Data Protection. WidgetKit therefore substitutes protected content while the device is locked; its explicit privacy-redacted view is also generic.
- Rest presentation replaces task, event, and approval titles with neutral labels.
- Work prioritizes tasks, Personal prioritizes calendar context, and Rest withholds titles. A routed focus updates presentation but never grants access.
- No credential is written to the snapshot or widget extension.
- The custom URL parser treats all incoming data as untrusted.

iPhone 13 mini is a supported baseline on iOS 18. Siri, Shortcuts, Back Tap, Home Screen widget, Lock Screen widget, and controls remain usable. Dynamic Island is not used. Action Button support is optional and supplied automatically by the same Control Widget on devices that have the button.

## Verification

The `BirdiePhoneTests` XCTest bundle covers stable entities, strict route rejection, TTL/purge behavior, app-only draft/thought storage, intent coordinator and authentication metadata, Focus-policy independence, snapshot redaction, separate EventKit permission requests, and confirmed immutable proposals. `test/apple-system-surfaces-contract.test.mjs` keeps the source/XcodeGen/security wiring testable on non-Apple hosts.

Apple CI must generate both XcodeGen projects, run the XCTest bundle on an available iOS simulator, and build the app plus iOS widget without signing. A physical-device smoke test is still required for Siri indexing, Back Tap, Control Center/Lock Screen placement, lock redaction, real EventKit prompts, and iPhone 13 mini layout.

## Next integration step

Add one scoped, read-only, versioned endpoint such as `GET /watch/day-pilot/v1` that returns structured `nextTask`, `briefing`, and `openApprovals` under the existing narrow mobile/Watch authentication boundary. Replace only the currently unavailable provider after that contract has server tests. Keep idea writes and all approval execution as separate confirmed in-app flows.
