# commander-wizard

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
