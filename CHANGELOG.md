# Changelog

## [1.3.0](https://github.com/mandakan/ssi-scoreboard/compare/v1.2.0...v1.3.0) (2026-09-30)


### Features

* **analysis:** selection sheet, chart switcher and deep dive ([#565](https://github.com/mandakan/ssi-scoreboard/issues/565)) ([b543fee](https://github.com/mandakan/ssi-scoreboard/commit/b543feeb2ccd125705dcab8b2c810aea8da539cc))
* **grid:** pre-match grid, 12px floor and info tab order ([#566](https://github.com/mandakan/ssi-scoreboard/issues/566)) ([13a8c11](https://github.com/mandakan/ssi-scoreboard/commit/13a8c114a11e2bf0109c0a1dab97e76abdb813e8))
* **match:** grid, info and analysis tabs replace the mode toggle ([#563](https://github.com/mandakan/ssi-scoreboard/issues/563)) ([49dfc50](https://github.com/mandakan/ssi-scoreboard/commit/49dfc5098a4ad12c37c978cf3f6794cb44ec0aa7))
* **release:** what's new dot, desktop match tabs and the match tabs release entry ([#567](https://github.com/mandakan/ssi-scoreboard/issues/567)) ([10d33ba](https://github.com/mandakan/ssi-scoreboard/commit/10d33bafa640e78377ba647fbe7790f9d20c4acd))

## [1.2.0](https://github.com/mandakan/ssi-scoreboard/compare/v1.1.0...v1.2.0) (2026-09-29)


### Features

* **telemetry:** grid time-in-view and UI section usage baseline ([#561](https://github.com/mandakan/ssi-scoreboard/issues/561)) ([1f10d6e](https://github.com/mandakan/ssi-scoreboard/commit/1f10d6edd6411e16ba3514112b213449d7dc4f66))


### Bug Fixes

* **live-grid:** stop scroll snap from hiding a stage under the name column ([#560](https://github.com/mandakan/ssi-scoreboard/issues/560)) ([199c255](https://github.com/mandakan/ssi-scoreboard/commit/199c255d545b237e77ae5c099657d62949b4c203))

## [1.1.0](https://github.com/mandakan/ssi-scoreboard/compare/v1.0.1...v1.1.0) (2026-09-15)


### Features

* **api-v1:** anonymous read access with IP-keyed rate limiting ([#555](https://github.com/mandakan/ssi-scoreboard/issues/555)) ([c37fbee](https://github.com/mandakan/ssi-scoreboard/commit/c37fbee31030ca3b87ec04456e6793e5ccdf9281)), closes [#554](https://github.com/mandakan/ssi-scoreboard/issues/554)

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
