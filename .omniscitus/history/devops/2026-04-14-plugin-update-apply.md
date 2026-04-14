# Plugin update apply — `/omniscitus-update` + stale-migrate nag

**Domain**: devops
**Status**: closed
**Created**: 2026-04-13
**Last updated**: 2026-04-14

## Intent

Plugin upgrades (`/plugin install omniscitus --force`) swap the cached
files in `~/.claude/plugins/` but can't retroactively refresh what migrate
previously wrote into the *project* — the `CLAUDE.md` onboarding block,
the statusline indicator, `.omniscitus/README.md`. Users had no path to
pick up improvements short of deleting `.omniscitus/` and re-migrating.

## What landed

- **`/omniscitus-update` skill** (#58, `2b88ea7`) — reads `anchor.yaml`,
  diffs each footprint entry against the current plugin version's
  canonical content, shows the user each diff, applies on explicit
  consent, and bumps `anchor.migrate_version`. Idempotent, marker-based
  for `appended` sections, never overwrites silently.
- **`anchor.migrate_version` field** — migrate records which plugin
  version last wrote the canonical footprint content. Pre-0.6 anchors
  without the field are treated as "unknown" and handled gracefully.
- **SessionStart stale-migrate nag** — `version-check.cjs` now walks up
  from cwd to find `anchor.yaml`, reads `migrate_version`, compares to
  installed plugin version. If newer, emits a second nag line pointing
  at `/omniscitus-update`. Same 24h rate limit as the marketplace-upgrade
  nag, merged cache.
- **Surgical `/omniscitus-uninstall`** (#48, #49, #50, `c1cb021`, `f82a004`,
  `280572f`) — reads the footprint and applies remove-section /
  git-checkout / delete / restore per entry, then removes `.omniscitus/`
  itself. Includes dry-run, idempotency, and per-entry reporting.

## Decisions worth remembering

- **Always ask, never silently overwrite.** Migrate and update both go
  through `AskUserQuestion` for every external file. The project owner
  stays in the driver's seat.
- **Record `skipped_canonical:` in anchor.yaml.** When a user
  deliberately keeps a bespoke version of CLAUDE.md / statusline /
  README, update remembers so future runs don't re-propose the same
  diff.
- **Two-stage nag**: first marketplace upgrade available → run
  `/plugin install … --force`. Second after that → run
  `/omniscitus-update`. Keeps the two concerns separate.

## Pending

- `/omniscitus-update` currently proposes every footprint entry even
  when `skipped_canonical` lists it. Could be smarter and suppress
  those proposals automatically. Revisit if users complain.
