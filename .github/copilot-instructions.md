# Copilot instructions

## Test coverage

Keep statements, branches, functions and lines coverage of `src/**` at or above 95%, and keep it up to date.

- Measure with `npm run test:coverage`, which runs vitest with v8 coverage over `src/**`.
- Before finishing any change to `src/`, or to tests that affect coverage, run the command and confirm all four metrics are at least 95%.
- Add focused tests in the matching `test/` file for new or changed behaviour. Do not lower the threshold or exclude files from coverage to pass.
