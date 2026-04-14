# Constellation view

**Participants**: claude, dan

## Summary
The 3D node space + tree panel + nudge prompt modal — birdview's most ambitious visual surface.

## Context
- **Background**: started as a fancy visual hook, landed as a practical file-picker for Claude onboarding.
- **Requirements**: pick files in a tree, generate an @-mention prompt, paste into Claude session.
- **Decisions**: 3D was kept as a visual teaser; the tree panel is the primary UI.
- **Constraints**: pure HTML + Three.js via CDN, no build step, no runtime server dependency for the demo.

## Timeline

### 2026-04-10
**Focus**: Folder-level selection, tree event delegation, debounced search, de-emphasize the 3D pitch
- Added `selectedFolders` state + `@folder/` nudge mentions
- Event delegation on `#tree-list` for scale
- Moved the docs 3D section to the bottom of the page

**Learned**: tree-first is more honest than 3D-first for large projects.

### 2026-04-09
**Focus**: Initial Three.js constellation + blueprint tree panel + nudge modal
- Clickable 3D spheres with selection sync
- Tree panel with search
- Clipboard nudge prompt preview

## Pending
- [ ] Demo birdview hosted on the docs site
- [ ] Test coverage for the tree builder and nudge prompt builder

## Notes
See PRs #7 (Context section), #22 (constellation v1), #23 (tree + modal), #24 (cap), #25 (card balance), #26 (folder selection), #27 (docs rearrange).
