---
"commander-wizard": patch
---

Review and input fidelity fixes:

- omitted boolean flags now review as `not supplied` instead of showing a value that was never set
- the rerun command line is printed as plain output outside the note, so it is copyable
- variadic option values keep their raw whitespace instead of being silently trimmed
- editing a command no longer forces retyping an existing variadic default
