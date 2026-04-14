# Migrate skill productionization

**Domain**: devops
**Status**: closed
**Created**: 2026-04-13
**Last updated**: 2026-04-14
**Participants**: claude, dan

## Intent

Turn `/omniscitus-migrate` from a first-run "seed blueprints + history" script
into a real, reversible install step. By the end of this arc, a migrate run
had to satisfy three hard rules:

1. Never destroy pre-existing content without consent.
2. Leave a precise trail of everything it wrote outside `.omniscitus/`.
3. Work for Korean teams as naturally as for English teams.

## What landed

- **Pre-migration anchor** (#40, `ba2612f`) — migrate now records
  `anchor.yaml` with the HEAD SHA, branch, timestamp, and a growing
  `footprint:` list of every external file write. Uninstall reads this
  to surgically reverse.
- **Language prompt + CLAUDE.md integration** (#37, `ecff91a`) — Step 0
  asks the user which language to generate docs in (history bodies,
  summaries, CLAUDE.md block). Phase 5.5 proposes an onboarding block
  in `CLAUDE.md` that Claude Code auto-loads each session.
- **First-class install step** (#36, `2a80e95`) — documentation now
  treats `/omniscitus-migrate` as the next action after `/plugin install`,
  not a footnote.
- **Richer config template** — `migrate-config.yaml` ships with
  `blueprint_splits` depth defaults and an `excluded_directories` section
  so asset-heavy repos (e.g. 35k scenario files) don't flood blueprints.

## Decisions worth remembering

- **Consent > convenience**: every external file write goes through
  `AskUserQuestion`. The skill never silently appends to `CLAUDE.md` or
  flips repo state.
- **One anchor, one source of truth**: uninstall reads the same
  `anchor.yaml` migrate writes. No duplicated bookkeeping.
- **Footprint `action:` vocabulary**: `appended` (marker-based),
  `created`, `modified`, `deleted` — covers everything uninstall needs
  without being ambiguous.

## Pending

None — this is closed. The v0.6.x release cycle (see
`devops/2026-04-14-plugin-update-apply.md`) extended the model with
`migrate_version` + `/omniscitus-update`, but the core migrate flow is
stable.
