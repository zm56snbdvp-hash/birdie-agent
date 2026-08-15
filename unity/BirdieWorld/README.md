# BirdieWorld Unity Foundation

This is the bounded Unity foundation for the public supporter beta of
BirdieWorld. It lives in the existing canonical repository and imports the
existing `birdieworld-estate-handoff-v1` contract. It does not fork product
truth or reproduce coordinates by hand.

## Locked technical baseline

- Unity `6000.5.8f1` (Unity 6.5 Update)
- Universal Render Pipeline `17.3.0`
- Input System `1.17.0`
- Unity Authentication `3.7.3` with username/password accounts
- Web build first, mobile-browser controls included
- one generated scene: `BirdieEstate_Blockout`
- presentation-only, client-session-only state

## First local start

1. Install Unity Hub and Unity 6.5 (`6000.5.8f1`) with **Web Build Support**.
2. Open the project folder `unity/BirdieWorld` from this repository.
3. Wait for package import to finish.
4. In Unity choose **BirdieWorld → Prepare Unity Foundation**.
5. Open `Assets/BirdieWorld/Scenes/BirdieEstate_Blockout.unity` and press Play.
6. Walk with WASD/arrows or drag with one finger/mouse.
7. Link the project under **Edit → Project Settings → Services**.
8. Under **Services → Authentication → Configure**, add and save the
   **Username and Password** identity provider.
9. For a local Web candidate choose **BirdieWorld → Build Supporter Web**.

The preparation command copies the canonical manifest into Unity's Resources
folder, validates both contract versions and refuses any manifest that enables
quests, progression, multiplayer, persistence, location tracking or authority.

## Supporter account rule

The world is publicly reachable after hosting, but movement is locked until the
visitor creates an account or signs in through Unity Authentication. The client
does not store passwords or service secrets. It does not send hidden telemetry,
contact supporters, write Coin state, process payments or grant permissions.

## Scope freeze

Included: ground, locked nine-landmark composition, hotel/stable/pond collision
geometry, Golden Estate palette, nine visual-only scale figures, bounded player
movement and third-person camera.

Included account scope: username/password signup, sign-in, sign-out and session
resume only.

Excluded: quests, progression, multiplayer, world persistence, profile editing,
inventory/economy, Coin, payments and unrelated product features.
