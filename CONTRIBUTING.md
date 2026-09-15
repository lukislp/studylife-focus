# Contributing to StudyLife Focus

Thanks for taking the time. StudyLife Focus is a single-maintainer project, so the process is
deliberately small - but it is the same for every change, including the maintainer's own.

## How changes get in

1. Open an issue first for anything bigger than a typo or an obvious bug fix, so the direction can
   be agreed before you spend time on it. Use the templates under `.github/ISSUE_TEMPLATE/`.
2. Fork the repository (or branch, if you have write access) and make your change on a branch.
3. Open a pull request against `main`. The pull-request template asks for what changed and why.
4. `main` is protected: a PR merges only after the test stage of
   [`.github/workflows/ci.yml`](.github/workflows/ci.yml) is green and the branch is up to date
   with `main` (enable auto-merge and it lands on its own once that is the case). Nobody pushes to
   `main` directly, not even the maintainer.

## What a pull request needs

- **Conventional Commits.** The version and the changelog are generated from the commit messages
  (`feat:` = minor release, `fix:` = patch release, `build:`/`ci:`/`docs:`/`test:` = no release).
  Squash-merge keeps the PR title as the commit message, so give the PR a Conventional Commit
  title.
- **Green required checks.** `lint`, `build` and `review / dependency-review` are required; a red
  one blocks the merge.
- **Tests for new functionality.** New features and bug fixes come with tests in `tests/` (vitest).
  `npm test` runs in the `build` job, so a failing test blocks the merge.
- **Types.** `npm run typecheck` (`tsc --noEmit`) runs as part of `lint`; run it before pushing.
- **API contract.** `npm run contract-check` diffs this extension's hand-mirrored
  `TimerStateDtoPayload` (`src/api.ts`) against the main `studylife` repo's committed OpenAPI spec.
  If the server contract moved, update the mirror in the same PR - the check is part of `lint` and
  blocks the merge otherwise.
- **Dependencies.** `npm audit --audit-level=high` runs in `lint` and must stay clean.
- **Permissions.** Adding a `manifest.json` permission is a review topic of its own; say in the PR
  why it is needed, since it affects the browser store listing and `PRIVACY.md`.

## Running things locally

Node 24 is what CI uses.

```bash
npm ci
npm run typecheck
npm test
npm run build      # -> dist/
npm run package    # -> release/*.zip
```

`npm run watch` rebuilds on change. Load `dist/` as an unpacked extension in the browser to try it.

## Security issues

Please do not open a public issue for a vulnerability - use the private reporting path described
in [SECURITY.md](SECURITY.md). The [Code of Conduct](CODE_OF_CONDUCT.md) applies to every
interaction in this repository.
