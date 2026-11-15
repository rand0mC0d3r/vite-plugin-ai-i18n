# Copilot instructions

## Test coverage

Keep statements, branches, functions and lines coverage of `src/**` at or above 95%, and keep it up to date.

- Measure with `bun run test:coverage`, which runs vitest with v8 coverage over `src/**`.
- Before finishing any change to `src/`, or to tests that affect coverage, run the command and confirm all four metrics are at least 95%.
- If any metric is below 95%, write the missing unit tests yourself, without waiting to be asked. Start with the uncovered lines and branches in the coverage report, then re-run the command until every metric passes.
- Add focused tests in the matching `test/` file (mirror the `src/` path) for new or changed behaviour, and for any uncovered code you find. Write each case once and cover edge cases, such as error paths and empty inputs.
- Do not write tests that only restate the implementation, check constants, or exercise language behaviour, since they inflate coverage without testing anything.
- When you change or move code under `src/`, audit the tests that cover it. Remove tests that are irrelevant now, such as tests for deleted or renamed code, and fix tests that no longer make sense, such as assertions tied to old file layouts, old names, or behaviour that has changed. Update them to test the current behaviour, or delete them if they only restate the implementation.
- Do not keep a test just to hold up coverage. If removing a test drops coverage below 95%, replace it with a test that checks real behaviour.
- Do not lower the threshold or exclude files from coverage to pass.
- Report the final four metrics in your summary to the user, plus any tests you removed or changed and why.
