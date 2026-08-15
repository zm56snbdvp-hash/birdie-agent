# BirdieWorld Unity Foundation

This is the bounded Unity foundation for the private supporter version of
BirdieWorld. It lives in the existing canonical repository and imports the
existing `birdieworld-estate-handoff-v1` contract. It does not fork product
truth or reproduce coordinates by hand.

## Locked technical baseline

- Unity `6000.3.0f1` (Unity 6.3 LTS)
- Universal Render Pipeline `17.3.0`
- Input System `1.17.0`
- Web build first, mobile-browser controls included
- one generated scene: `BirdieEstate_Blockout`
- presentation-only, client-session-only state

## First local start

1. Install Unity Hub and Unity 6.3 LTS with **Web Build Support**.
2. Open the project folder `unity/BirdieWorld` from this repository.
3. Wait for package import to finish.
4. In Unity choose **BirdieWorld → Prepare Unity Foundation**.
5. Open `Assets/BirdieWorld/Scenes/BirdieEstate_Blockout.unity` and press Play.
6. Walk with WASD/arrows or drag with one finger/mouse.
7. For a local Web candidate choose **BirdieWorld → Build Private Review Web**.

The preparation command copies the canonical manifest into Unity's Resources
folder, validates both contract versions and refuses any manifest that enables
quests, progression, multiplayer, persistence, location tracking or authority.

## Private supporter rule

The generated Web build is not private merely because its URL is unlisted.
Before any supporter receives a link, hosting must enforce an actual access gate
and the existing beta device/feedback gates must pass. This foundation does not
send telemetry, contact supporters, write Coin state or call a network service.

## Scope freeze

Included: ground, locked nine-landmark composition, hotel/stable/pond collision
geometry, Golden Estate palette, nine visual-only scale figures, bounded player
movement and third-person camera.

Excluded: quests, progression, multiplayer, persistent world state, identity,
inventory/economy, Coin, payments, production merge and public release.
