# Changelog

## 2026-08-14

### Features
- Added support for customizing the bot's prefix and note text so translated issue comments can match your workflow and tone.
- Added support for updating translated issue titles, making it easier to keep titles and issue body language consistent.
- Improved configuration flexibility by supporting custom bot setups and messaging preferences.

### Bug fixes
- Fixed translation behavior for issues whose title is not in English.
- Fixed a case where issues with only a title and no body were not translated correctly.

### Chores
- Updated the GitHub checkout action to reduce build warnings in CI.
- Upgraded dependencies and the Node.js runtime to keep the action current and more reliable.
- Refreshed documentation and contributor metadata.

### Breaking changes
- None.
