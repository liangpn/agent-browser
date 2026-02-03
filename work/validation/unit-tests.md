---
date: 2026-01-31
source: local npm test
notes:
  - browser-shell unit tests pass
  - browser-shell tool payload is minimal (`session_id/exit_code/stdout/stderr`)
  - full test suite fails on this machine because Playwright browsers are not installed
---

## browser-shell unit tests (PASS)

Command:

```bash
NO_COLOR=1 FORCE_COLOR=0 npm test -- work/test/browser-shell-policy.test.ts work/test/browser-shell-args.test.ts work/test/browser-shell-output.test.ts
```

Output: `work/validation/npm-test-browser-shell.log`

## full test suite (FAIL)

Command:

```bash
NO_COLOR=1 FORCE_COLOR=0 npm test
```

Output: `work/validation/npm-test-full.log`

Error excerpt: `work/validation/npm-test-full.tail.txt`
