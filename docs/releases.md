# Releases

Releases are cut by [release-please](https://github.com/googleapis/release-please).
There is no manual version bump, no hand-written changelog, and no separate
"click Deploy" step.

## The flow

1. Merge PRs into `main` as usual. Staging deploys on every push, unchanged.
2. `.github/workflows/release-please.yml` keeps a single rolling PR open,
   titled `chore(main): release X.Y.Z`. It updates `package.json`,
   `CHANGELOG.md`, and `.release-please-manifest.json`.
3. Merging that PR is the release. release-please tags `vX.Y.Z`, publishes a
   GitHub Release, and the same workflow then deploys production from that
   exact tag.
4. Run `pnpm release:post` afterwards for the social post and screenshots
   (see `docs/release-post.md`).

Production can still be deployed by hand -- `Deploy to Cloudflare` ->
`Run workflow` -- for redeploys and hotfixes.

## Squash-merge means the PR title is the changelog

We squash-merge, so the **pull request title** becomes the commit subject that
release-please parses. A title that is not a Conventional Commit is dropped from
the changelog silently and does not influence the version bump.

| Prefix | Bump | Appears in changelog |
|---|---|---|
| `feat:` | minor | Features |
| `fix:` | patch | Bug Fixes |
| `perf:` | patch | Performance |
| `docs:` | patch | Documentation |
| `deps:` | patch | Dependencies |
| `revert:` | patch | Reverts |
| `refactor:`, `test:`, `build:`, `ci:`, `style:`, `chore:` | patch | hidden |
| any prefix with `!` (e.g. `feat!:`) or a `BREAKING CHANGE:` footer | major | flagged at the top |

A release PR is only opened when at least one commit since the last release
carries a releasable type.

## Two things to know about the setup

**`release-as` was pinned to `1.0.0` for the first release and has since been
removed** (v1.0.0 shipped 2026-08-23). It forced the version to `1.0.0` so the
repo left its permanent `0.1.0` behind on a clean number. `release-as` is
sticky -- it forces the same version on *every* subsequent release -- so it was
deleted immediately afterwards. If you ever pin it again, delete it in the same
breath as the release it was pinned for, or version bumps stop working
silently.

**The deploy is a `workflow_call`, not `on: release: published`.** GitHub will
not trigger a workflow from an event raised with the default `GITHUB_TOKEN`;
it is the recursion guard. A `release: published` trigger on
`deploy-cloudflare.yml` would therefore never fire, with no error. The release
job calls the deploy workflow directly instead, which avoids introducing a PAT
or GitHub App token whose only purpose is to defeat that guard.

## Changelog vs What's New

They are separate on purpose:

- `CHANGELOG.md` -- commit-derived, engineering-facing, exhaustive.
- `lib/releases.ts` -- hand-written user-facing prose with `screenshotScenes`,
  shown once per release in the What's New dialog (see `docs/whats-new.md`).

A user-visible `feat` needs both: a conventional PR title, and a `RELEASES`
entry.

## Known side effect

The `chore(main): release X.Y.Z` commit touches `package.json`, which is not in
`deploy-staging.yml`'s `paths-ignore`. Each release therefore also triggers one
redundant staging deploy. Harmless; noted so it is not mistaken for a bug.
