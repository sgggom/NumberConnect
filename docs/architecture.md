# NumberConnect architecture

## Runtime boundaries

- `app/` owns startup, screen routing, and application-wide domain events.
- `core/` owns reusable infrastructure contracts that do not depend on Phaser or a specific feature.
- `gameplay/` owns NumberConnect rules, editor behavior, and presentation adapters.
- `features/` will own player-facing systems such as tasks, activities, check-in, inventory, shop, and tournaments.
- `infrastructure/` will provide local and remote implementations for persistence, time, APIs, telemetry, and configuration.
- Phaser scenes render game state and translate pointer input; they must not become the source of persistent player state.

## Cross-feature communication

Features communicate through typed events from `app/GameEvents.ts`. Tasks and activities subscribe to gameplay events instead of calling Phaser scenes or DOM controllers directly.

Reward sources must eventually call one idempotent reward service. Sign-in, tasks, advertisements, gift packs, shop purchases, and tournament prizes must not modify wallets or inventory independently.

## State ownership

- Run state: current path, current stage, remaining lives, pause state.
- Player state: progression, currencies, inventory, cosmetics, task progress, check-in history.
- Live content: activities, offers, task definitions, challenge rules, tournament seasons.

Only serializable domain state is persisted. Phaser objects, DOM nodes, tweens, and open dialogs are presentation state.

## Level editor boundary

The level editor is an independently mounted feature under `gameplay/editor/`. It owns its template, styles, drawing state, sizing rules, validation algorithm, and output construction. The host application supplies only three ports:

- obtain the next level id;
- receive a completed `LevelData` output;
- return to the previous application screen.

The editor must not access the active game session, Phaser scene, player progression, rewards, settings dialog, or application router directly.

## Migration order

1. Extract screen routing and the level editor from the application controller.
2. Move gameplay rules out of `BoardScene` into a deterministic game-session model.
3. Introduce player profile, wallet, inventory, reward service, and versioned repositories.
4. Build data-driven task, activity, check-in, challenge, and catalog definitions.
5. Add remote service adapters for trusted time, accounts, purchases, tournament scores, and leaderboards.
