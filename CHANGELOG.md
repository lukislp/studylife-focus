## [1.2.10](https://github.com/lukislp/studylife-focus/compare/v1.2.9...v1.2.10) (2026-09-20)


### Bug Fixes

* **ci:** correct missing Harden Runner allowlist ports (github.com:22, crl:80) ([#44](https://github.com/lukislp/studylife-focus/issues/44)) ([4572567](https://github.com/lukislp/studylife-focus/commit/45725677a0a5fdbcf5e572eb0e0aa1223ed823e3))

## [1.2.9](https://github.com/lukislp/studylife-focus/compare/v1.2.8...v1.2.9) (2026-09-20)


### Bug Fixes

* **ci:** add Harden Runner in audit mode to every job ([#42](https://github.com/lukislp/studylife-focus/issues/42)) ([32a17be](https://github.com/lukislp/studylife-focus/commit/32a17beb05170038d24d40a436d9164d330613f2))

## [1.2.8](https://github.com/lukislp/studylife-focus/compare/v1.2.7...v1.2.8) (2026-09-12)


### Bug Fixes

* **release:** sign the release assets and attach build provenance ([#21](https://github.com/lukislp/studylife-focus/issues/21)) ([98a5403](https://github.com/lukislp/studylife-focus/commit/98a5403c71c6b125f0bccaf55c138ff98d815ae7))

## [1.2.7](https://github.com/lukislp/studylife-focus/compare/v1.2.6...v1.2.7) (2026-09-12)


### Bug Fixes

* **deps:** bump the dev group across 1 directory with 2 updates ([6ea201b](https://github.com/lukislp/studylife-focus/commit/6ea201b2fa6b71016eae91fd958ec98373e52e88))

## [1.2.6](https://github.com/lukislp/studylife-focus/compare/v1.2.5...v1.2.6) (2026-09-11)


### Bug Fixes

* **ci:** read-only GITHUB_TOKEN in the Dependabot auto-merge workflow ([c45c48c](https://github.com/lukislp/studylife-focus/commit/c45c48c22800e4fb704f9a85b961d1469ce116aa))

## [1.2.5](https://github.com/lukislp/studylife-focus/compare/v1.2.4...v1.2.5) (2026-09-11)


### Bug Fixes

* **spotify:** generate the PKCE verifier without modulo bias ([#14](https://github.com/lukislp/studylife-focus/issues/14)) ([8ba60e4](https://github.com/lukislp/studylife-focus/commit/8ba60e4012ec3b959dac5665042dd5fc0f2bf8a5))

## [1.2.4](https://github.com/lukislp/studylife-focus/compare/v1.2.3...v1.2.4) (2026-09-11)


### Bug Fixes

* **ci:** push release commits as a deploy key so the default branch can be ruleset-protected ([aebb5d6](https://github.com/lukislp/studylife-focus/commit/aebb5d6d4bb39bb75e402ae6954a317eef7852a3))

## [1.2.3](https://github.com/lukislp/studylife-focus/compare/v1.2.2...v1.2.3) (2026-09-04)


### Bug Fixes

* **deps:** bump the dev group with 2 updates ([734d04a](https://github.com/lukislp/studylife-focus/commit/734d04a4718a0084d3d83e6a326fcb7c17d40ecd))

## [1.2.2](https://github.com/lukislp/studylife-focus/compare/v1.2.1...v1.2.2) (2026-09-03)


### Bug Fixes

* **ci:** add Dependabot for github-actions, npm ([c6cff67](https://github.com/lukislp/studylife-focus/commit/c6cff675bee9e8a2724c382bac76aa6fded10290))

## [1.2.1](https://github.com/lukislp/studylife-focus/compare/v1.2.0...v1.2.1) (2026-08-30)


### Bug Fixes

* request the blocking host permission so new-tab navigations get blocked ([8f91814](https://github.com/lukislp/studylife-focus/commit/8f9181456b05c14d8311a334a4630aa819416f57))

# [1.2.0](https://github.com/lukislp/studylife-focus/compare/v1.1.2...v1.2.0) (2026-08-29)


### Features

* merge studylife-focustunes into this repo as StudyLife Focus ([3882b6e](https://github.com/lukislp/studylife-focus/commit/3882b6e95d26942a4408e4a7bb527011dabfac66))

## [1.1.2](https://github.com/lukislp/studylife-focusguard/compare/v1.1.1...v1.1.2) (2026-08-29)


### Bug Fixes

* retry a hint-triggered poll to catch a slow-landing save ([e8910fa](https://github.com/lukislp/studylife-focusguard/commit/e8910fa60c5cdb0300d585a72abbc64929f0973b))

## [1.1.1](https://github.com/lukislp/studylife-focusguard/compare/v1.1.0...v1.1.1) (2026-08-29)


### Bug Fixes

* poll every 30 seconds, log the poll/hint pipeline for real ([84e3a87](https://github.com/lukislp/studylife-focusguard/commit/84e3a871dabe0724940c5beac4c65143200c21eb))

# [1.1.0](https://github.com/lukislp/studylife-focusguard/compare/v1.0.1...v1.1.0) (2026-08-29)


### Features

* react instantly to a same-browser start/pause/reset ([78407f5](https://github.com/lukislp/studylife-focusguard/commit/78407f557ad7de971a4e4c5ce77cbf9619cbef96))

## [1.0.1](https://github.com/lukislp/studylife-focusguard/compare/v1.0.0...v1.0.1) (2026-08-28)


### Bug Fixes

* broken Open StudyLife link, restore swept tabs, restyle to match StudyLife ([0c72606](https://github.com/lukislp/studylife-focusguard/commit/0c726060ec5afdf6f164f7f82fc9ee53ae66f5ec))

# 1.0.0 (2026-08-28)


### Features

* scaffold the FocusGuard extension (poll, block rules, connect flow, UI) ([f20daef](https://github.com/lukislp/studylife-focusguard/commit/f20daefb934d6a118bdb9941d1410dd095f0b755)), closes [lukislp/studylife#104](https://github.com/lukislp/studylife/issues/104)
