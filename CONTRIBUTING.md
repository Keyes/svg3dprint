# Contributing

Bug reports, SVGs that come out wrong, and pull requests are all welcome.

## Reporting a problem

Open an issue with:

- the SVG (or a cut-down version that still shows the problem)
- the command or `build()` options you used
- what you expected and what you got (a screenshot of the slicer helps)

## Setup

Needs Node 22 or newer.

```bash
npm install
npm test         # builds, then runs everything in test/
npm run demo     # browser demo at http://127.0.0.1:5179/demo/
```

## Pull requests

- One change per pull request. Say what it fixes and how you checked it.
- Add a test for new behaviour or a fixed bug (`test/*.test.mjs`, Node's built-in test runner).
- Refactors must not change output: compare build reports and 3MF/STL files before and after.
- CI runs `npm test` on Node 22 and 24; it must pass.

## Test files

SVGs in `test/corpus/` keep their own licenses. When you add one, it must be freely licensed
(public domain, CC0, CC BY, CC BY-SA, MIT or similar) and get a row in `test/corpus/SOURCES.md`
with license, author and source link.

## Releasing (maintainers)

1. Update `CHANGELOG.md`.
2. `npm version patch` (or `minor` / `major`); this commits and creates the `vX.Y.Z` tag.
3. `git push --follow-tags`. The Publish workflow tests and publishes to npm with provenance.

By contributing you agree that your contribution is licensed under the MIT license of this project.
