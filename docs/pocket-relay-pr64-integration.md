# Pocket Relay / Desktop-Alpha Integration Boundary

PR #64 currently exposes an internal, local desktop IPC contract for module
navigation and surface mode changes. That contract is not a remote security
boundary and must not be reused by an iPhone.

This branch adds `pocket-relay-host.v1` under
`packages/protocol/src/pocket-relay-host.mjs`. It is an internal, versioned
effect envelope for a future host adapter. The envelope binds:

- `effectId`, `commandId`, and `idempotencyKey`
- source `deviceId` and exact `targetDeviceId`
- one of `link.open.v1` or `pc.lock.v1`
- fixed scope, effect digest, lease ID, and typed payload

The included `MockPocketRelayHostExecutor` returns `productionEffect: false`
and requires an active effect lease. File transfer and workflow actions are
not part of this host contract and fail closed. No named pipe, shell,
PowerShell, arbitrary executable, or caller-selected file path is used.

`PocketRelayHostAdapter` is the only production binding point. It remains
fail-closed unless the caller explicitly supplies both hooks, sets
`enableProductionEffects: true`, and runs on `win32`. It re-validates the
target and lease, invokes each hook with the lease abort signal, checks the
lease again after the hook, and returns the same receipt on an exact
`effectId` retry without repeating the OS effect.

This integration branch, layered on PR #64, also contains crate-local native implementations in
`apps/desktop/src-tauri/src/pocket_relay_host.rs`. They validate the HTTPS
authority and call only Windows `ShellExecuteW` with the fixed `open` verb or
`LockWorkStation`. They are intentionally not Tauri commands and are not yet
reachable from the WebView or the local core pipe.

## Next host step

After the Pocket Relay gateway and Desktop Alpha have a reviewed deployment
boundary, bind two explicit Windows hooks to this adapter:

```text
openHttpsLink(url, { signal })
lockInteractiveSession({ signal })
```

Those hooks must be implemented behind Windows ACLs and an adapter-controlled
commit boundary. The existing `\\.\pipe\birdie.core.control.v1` remains local
IPC and is not an authentication mechanism for Pocket Relay.
