---
"commander-wizard": patch
---

Internal refactor: split the wizard collection loop into pure planning (`planFields`), prompting (`resolve`), and emission (`emit`). No behavior change.
