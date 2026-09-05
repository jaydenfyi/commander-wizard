# commander-wizard

## 0.1.0

### Minor Changes

- [`cb66418`](https://github.com/jaydenfyi/commander-wizard/commit/cb664181adfe65c6df49057add1af8f61c913d4d) Thanks [@jaydenfyi](https://github.com/jaydenfyi)! - Offer Keep default or Enter a value for custom-parser and non-text defaults without requiring rawDefaults. Keeping a default omits the input and leaves its value to Commander. Preserve rawDefaults as an optional prefill and require input for required positional arguments.
  
  Add opt-in validate for inline scalar text validation using existing pure, synchronous Commander parsers. InvalidArgumentError messages allow retrying in the prompt; final Commander validation remains unchanged.

### Patch Changes

- [`f77b444`](https://github.com/jaydenfyi/commander-wizard/commit/f77b4449098bec13ac37574a0d2978c68a5635c2) Thanks [@jaydenfyi](https://github.com/jaydenfyi)! - Internal refactor: split the wizard collection loop into pure planning (`planFields`), prompting (`resolve`), and emission (`emit`). No behavior change.

## 0.0.5

### Patch Changes

- [`967d0fa`](https://github.com/jaydenfyi/commander-wizard/commit/967d0fadd976458c08442bf8e26f430fb248714c) Thanks [@jaydenfyi](https://github.com/jaydenfyi)! - Review and input fidelity fixes:
  
  - omitted boolean flags now review as `not supplied` instead of showing a value that was never set
  - the rerun command line is printed as plain output outside the note, so it is copyable
  - variadic option values keep their raw whitespace instead of being silently trimmed
  - editing a command no longer forces retyping an existing variadic default

## 0.0.4

### Patch Changes

- Make the exports map resolvable from CJS contexts
- README: security-section updates and a demo gif

## 0.0.3

### Patch Changes

- Omit the end-of-options terminator when a command has no positionals; allow action-less commands

## 0.0.2 and earlier

Predate this changelog — see [the git history](https://github.com/jaydenfyi/commander-wizard/commits/main).
