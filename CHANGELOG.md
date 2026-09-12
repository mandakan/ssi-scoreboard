# Changelog

## [1.0.1](https://github.com/mandakan/ssi-scoreboard/compare/v1.0.0...v1.0.1) (2026-09-12)


### Bug Fixes

* **cache:** fail fast on cache calls while Redis is in reconnect back-off ([#551](https://github.com/mandakan/ssi-scoreboard/issues/551)) ([066b953](https://github.com/mandakan/ssi-scoreboard/commit/066b95349f33572c77e32102ad8493859bfba6a6))
* **deps:** patch next RCE + security advisories, make CI e2e hermetic ([#548](https://github.com/mandakan/ssi-scoreboard/issues/548)) ([e578e65](https://github.com/mandakan/ssi-scoreboard/commit/e578e65bb6731b237c694b0724518a36e6e4e8e0))


### Documentation

* add interactive architecture diagrams ([#545](https://github.com/mandakan/ssi-scoreboard/issues/545)) ([6fce856](https://github.com/mandakan/ssi-scoreboard/commit/6fce856f951d3e4921e07ece88d3c2f7c2abc629))
* embed static SVG diagrams in README and docs/diagrams ([#547](https://github.com/mandakan/ssi-scoreboard/issues/547)) ([f667b2f](https://github.com/mandakan/ssi-scoreboard/commit/f667b2f35aa5af884c5af014fa9605e625c7947d))

## [1.0.0](https://github.com/mandakan/ssi-scoreboard/compare/v0.1.0...v1.0.0) (2026-08-23)


### Features

* courtside grid, a minimal full-screen live view ([#532](https://github.com/mandakan/ssi-scoreboard/issues/532)) ([267d9b2](https://github.com/mandakan/ssi-scoreboard/commit/267d9b2656ff74f60906c5663ecbc017b6397e00))


### Bug Fixes

* power-factor-aware scoring and a live-grid screenshot scene ([#536](https://github.com/mandakan/ssi-scoreboard/issues/536)) ([d01103b](https://github.com/mandakan/ssi-scoreboard/commit/d01103b7def8060d141c73fb37430734ef8d0627))

## Changelog

Engineering changes, generated from Conventional Commit subjects by
[release-please](https://github.com/googleapis/release-please). See
`docs/releases.md` for how a release is cut.

User-facing highlights live in the in-app **What's New** dialog
(`lib/releases.ts`), which is hand-curated and is the only record of the
history before v1.0.0.
