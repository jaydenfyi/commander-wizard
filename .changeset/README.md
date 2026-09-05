# Changesets

## Adding a changeset

A changeset describes one release-worthy change: a bump type (`patch` / `minor` / `major`) plus a summary line that becomes the changelog entry.

```sh
npx changeset
```

Answer the prompts (package → `commander-wizard`, bump type, summary) and commit the generated file in the same PR as your change. Merging a PR that contains changeset files is all it takes — the release workflow picks them up.

Not every PR needs one (docs/tests don't). To merge a code change without releasing, add an empty changeset: `npx changeset --empty`.
