---
"commander-wizard": minor
---

Offer Keep default or Enter a value for custom-parser and non-text defaults without requiring rawDefaults. Keeping a default omits the input and leaves its value to Commander. Preserve rawDefaults as an optional prefill and require input for required positional arguments.

Add opt-in validate for inline scalar text validation using existing pure, synchronous Commander parsers. InvalidArgumentError messages allow retrying in the prompt; final Commander validation remains unchanged.
