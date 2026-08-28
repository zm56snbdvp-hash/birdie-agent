# Pocket Relay mock host

This process is a loopback-only conformance host for `pocket-relay/v1`. It
never opens a real link, copies a real host file, starts a production
workflow, or locks Windows. The pairing code is supplied only at runtime.

```powershell
$env:POCKET_RELAY_MOCK_PAIRING_CODE = '<runtime-only-value>'
npm run mock:pocket-relay
```

Use `npm run smoke:pocket-relay` for the self-contained test path; it creates
an ephemeral pairing value internally and prints no credentials.
