# commander-wizard

Add a [Clack](https://github.com/bombshell-dev/clack) wizard to your
[Commander](https://github.com/tj/commander.js) CLI. Users can fill in missing
inputs, review their choices, and copy a command to run without prompts.

**Requires:** Commander 14 or 15, Node >=22.12.0, and ESM. Wizard mode needs a terminal
for both stdin and stdout. Rerun commands use POSIX shell syntax.

## Quick start

```sh
nub add commander commander-wizard
```

Save as `cli.mjs`:

```js
import { Command } from 'commander';
import { addWizard } from 'commander-wizard';

const program = new Command('deploy-cli');
const deploy = program.command('deploy')
  .argument('<environment>')
  .requiredOption('--service <name>')
  .option('--region <name>', 'AWS region', 'us-east-1')
  .option('--force', 'skip safety checks')
  .action((environment, options) => console.log({ environment, ...options }));

// Add your commands and options before calling addWizard.
addWizard(program, { invocation: ['node', 'cli.mjs'] });

await program.parseAsync();
```

```sh
node cli.mjs deploy --wizard                           # prompt for inputs
node cli.mjs deploy dev --service api --wizard   # keep supplied inputs
node cli.mjs deploy dev --service api            # ordinary Commander invocation
```

Use `parseAsync()` for wizard invocations, or
`parseAsync(args, { from: 'user' })` with an argument array.

`addWizard()` decorates the root and every leaf subcommand, including nested
ones. Only the selected leaf command and supported ancestor options are
prompted.

## Using the wizard

You keep values supplied on the command line and answer prompts for the rest:

- Boolean flags: Yes/No, with No as the default for a plain flag such as `--force`.
- Choices: select one, or use multiselect for variadic choices.
- Text inputs: the default is prefilled; press Enter to accept it or edit it.
  Variadics without choices collect one value per line; an empty line finishes the
  list.

You review **raw CLI inputs** and a rerun command. Select **Edit …** to revisit a
prompt with your previous answer prefilled; other answers stay intact. Repeat as
needed, then choose **Continue to confirmation** (final confirmation defaults to
No). CLI-supplied inputs remain unchanged and are not offered for editing.
After confirmation, Commander applies parsers, requirements, conflicts, and
implications before running your action. Restart the wizard to correct invalid
inputs; custom parsers do not run during prompting.

Declining or pressing Ctrl-C exits cleanly with code 0 without running your
hooks or action. Wizard failures print like Commander errors and exit 1. For
tests and embedding, configure `exitOverride()` to catch everything instead
of exiting — the cancellation code is `commander-wizard.cancelled`.

You keep Commander's parsing and validation for ordinary invocations. Your
action receives no wizard-trigger option after a wizard run.

**Do not use the wizard for secrets. You expose inputs in review and rerun output.**

## Custom flags

The default is `--wizard`, with no short alias. Set `flags` to a Commander boolean
flag declaration to replace it:

```js
addWizard(program, { flags: '-i, --interactive' });
```

You can use a short flag alone, a long flag alone, or both. Flags that take values
and negated flags (`--no-…`) are not supported. The configured flags and their
Commander option attribute must not collide with existing options, including help.

## Rerun commands and defaults

Set `invocation` to executable tokens, such as `['node', 'cli.mjs']` or
`['your-installed-cli']`. Without it, you get the current Node executable,
execution flags, and script path. Specify it for custom launchers. Rerun from
the same directory with the same application configuration. Use a POSIX shell;
PowerShell and cmd.exe use different quoting.

You can accept string, numeric, and choice defaults. You get those values in the
rerun command, except for empty variadics and false booleans without a negative
flag. Declare a negative form such as `--no-color` to express false by name.
Inputs with defaults are prefilled — press Enter to accept. Clearing the input
is refused, because omitting the flag would restore the default.

For a custom parser's default, provide the raw CLI spelling with `rawDefaults`.
For example, add this to the quick start **before parsing**, replacing its
`addWizard()` call:

```js
import { Option } from 'commander';

const replicas = new Option('--replicas <count>')
  .argParser(Number)
  .default(3);
deploy.addOption(replicas);

addWizard(program, {
  invocation: ['node', 'cli.mjs'],
  rawDefaults: new Map([[replicas, ['3']]]),
});
```

Key `rawDefaults` by the `Option` or `Argument` object. Supply raw strings, one
for a scalar input, that produce the intended value with your parser's
previous/default argument. Define a parser to convert CLI strings to numbers;
a numeric default alone does not perform that conversion.

## Compatibility limits

Use root-only or nested leaf actions with global scalar options, short flags,
positive/negative boolean pairs, positional arguments, choices, and leaf variadics.

In wizard mode, put the full command path before flags:
`cli group command --wizard --flag=value`. Keep short flags separate; avoid `-abc` and
`-n3`. Put option-like positional values after `--`, including a literal `--wizard`.

You cannot use these Commander features in wizard mode:

- Executable subcommands, legacy command listeners, actions on commands with
  children, or implicit/default subcommands.
- Ancestor positional arguments or variadic options, positional/pass-through
  option modes, or shadowed global option names/flags.
- Environment-bound options, optional option values (`--color [value]`), presets,
  custom boolean parsers, or options stored as command properties.
- Electron argv or piped input/output.

Configure your tree before calling `addWizard()` on its root. Reserve the
configured flags and option attribute (`--wizard` and `wizard` by default). Repeat calls keep the first configuration. Do not add commands afterward
or decorate overlapping trees.

## Development

```sh
nub install
nub run typecheck
nub run test          # regression tests and built-package import check
nub run test:smoke    # terminal test; requires expect and stty
nub example.ts deploy --wizard
nub pack --dry-run
```

Build with `nub run build`; pack the library and declarations from `dist/`.
MIT licensed. See `LICENSE`.
