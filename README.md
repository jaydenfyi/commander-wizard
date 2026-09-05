# commander-wizard

[![npm](https://img.shields.io/npm/v/commander-wizard)](https://www.npmjs.com/package/commander-wizard)
[![CI](https://github.com/jaydenfyi/commander-wizard/actions/workflows/publish.yaml/badge.svg)](https://github.com/jaydenfyi/commander-wizard/actions/workflows/publish.yaml)

Adds an interactive wizard (powered by
[@clack/prompts](https://www.npmjs.com/package/@clack/prompts)) to
[Commander](https://github.com/tj/commander.js) CLIs. A `--wizard` flag lets
users fill in missing inputs, review and edit them, and copy a rerun command
for future non-interactive use.

![wizard session demo](examples/wizard-demo.gif)

**Requires:** Commander 14 or 15, Node >=22.12.0, ESM only.

## Install

```sh
npm install commander-wizard
```

## Quick start

```js
import { Argument, Command } from 'commander';
import { addWizard } from 'commander-wizard';

const program = new Command('deploy-cli');
const deploy = program.command('deploy')
  .addArgument(new Argument('<environment>', 'target environment')
    .choices(['dev', 'staging', 'prod']))
  .requiredOption('--service <name>')
  .option('--region <name>', 'AWS region', 'us-east-1')
  .option('--force', 'skip safety checks')
  .action((environment, options) => console.log({ environment, ...options }));

// Add your commands and options before calling addWizard.
addWizard(program, { invocation: ['node', 'cli.ts'] });

await program.parseAsync();
```

```sh
node cli.ts deploy --wizard                     # prompt for inputs
node cli.ts deploy dev --service api --wizard   # keep supplied inputs
node cli.ts deploy dev --service api            # ordinary invocation
```

Wizard mode requires `parseAsync()`; pass an argument array with
`parseAsync(args, { from: 'user' })`.

`addWizard()` decorates the root and every nested leaf. Only the selected
leaf and supported ancestor options are prompted. Actions are optional:
commands that read `.opts()` after parsing work unchanged.

## The wizard session

### Prompts

Values you supply on the command line are kept. The wizard prompts for the rest:

- **Boolean flags** ask Yes/No. A plain flag like `--force` defaults to No.
- **Choices** offer a select, or a multiselect for variadic choices.
- **Text inputs** come prefilled with the default; clearing it is refused,
  because omitting the flag would restore the default. Variadics without
  choices collect one value per line; an empty line ends the list.

### Review and edit

You review the raw CLI inputs and a rerun command. Select **Edit …** to
revisit a prompt; your previous answer stays prefilled and other answers are
kept. Inputs supplied on the command line are not offered for editing.
Final confirmation defaults to No.

### Validation and dispatch

After confirmation, Commander itself parses the assembled command line.
Parsers, requirements, conflicts, and implications all apply. Invalid inputs
surface at this point; restart the wizard to correct them. Your action
receives no wizard-trigger option after a wizard run.

### Cancellation and errors

Declining or pressing Ctrl-C exits with code 0 without running your hooks or
action. See [Exit behavior](#exit-behavior) for codes and `exitOverride()`
handling.

## Reference

### `addWizard(program, options?)`

Decorates a configured Commander root. Every leaf command gains the wizard
flag; parsing, validation, hooks, and action dispatch stay with Commander.

```ts
addWizard<T extends Command>(program: T, options?: WizardOptions): T
```

Returns the same program instance. Repeat calls keep the first configuration.

**Parameters**

| Name | Type | Required | Description |
|---|---|---|---|
| `program` | `Command` | Yes | The configured root command |
| `options.flags` | `string` | No | Commander boolean flag declaration. Default `--wizard` |
| `options.invocation` | `readonly string[]` | No | Executable and prefix arguments for rerun commands |
| `options.rawDefaults` | `ReadonlyMap<Option \| Argument, readonly string[]>` | No | Raw CLI spellings for custom-parser defaults |

#### `flags`

A short flag, a long flag, or both:

```js
addWizard(program, { flags: '-i, --interactive' });
```

Flags that take values and negated flags (`--no-…`) are unsupported. The
configured flags and their Commander option attribute must not collide with
existing options, including help.

#### `invocation`

Executable tokens, joined without a shell. Default: the current Node
executable, its execution flags, and the entry script path. Set it for custom
launchers, such as `['node', 'cli.ts']` or `['your-installed-cli']`. For
`npm run` launchers, include the pass-through separator:

```js
addWizard(program, { invocation: ['npm', 'run', 'start', '--'] });
```

Defaults appear in the rerun command, except empty variadics and false
booleans without a negative form; declare `--no-color` to express false by
name. Rerun commands assume a POSIX shell, run from the same directory with
the same application configuration. PowerShell and cmd.exe quote differently.

#### `rawDefaults`

Custom parsers do not run during prompting, so their defaults need a raw CLI
spelling. Key the map by the `Option` or `Argument` object; supply raw
strings, one per scalar input, that produce the intended value with your
parser's default argument. Replace the quick start's `addWizard()` call with:

```js
import { Option } from 'commander';

const replicas = new Option('--replicas <count>')
  .argParser(Number)
  .default(3);
deploy.addOption(replicas);

addWizard(program, {
  invocation: ['node', 'cli.ts'],
  rawDefaults: new Map([[replicas, ['3']]]),
});
```

### Exit behavior

| Event | Exit | Under `exitOverride()` |
|---|---|---|
| Wizard declined or Ctrl-C | 0 | Code `commander-wizard.cancelled`; hooks and action do not run |
| Wizard failure | 1 | Printed like a Commander error |
| No terminal on stdin/stdout | 1 | Fails before prompting |
| Invalid inputs at rerun | 1 | Commander's own validation errors pass through unchanged |

## Compatibility limits

Supported: global scalar options, short flags, positive/negative boolean
pairs, positional arguments, choices, and leaf variadics.

In wizard mode, put the full command path before flags:
`cli group command --wizard --flag=value`. Keep short flags separate; avoid
`-abc` and `-n3`. Put option-like positional values after `--`, including a
literal `--wizard`.

Unsupported in wizard mode:

- Executable subcommands, implicit/default subcommands, and targeting
  commands with children.
- Ancestor positional arguments, variadic options, positional/pass-through
  option modes, and shadowed global option names or flags.
- Environment-bound options, optional option values (`--color [value]`),
  presets, custom boolean parsers, and options stored as command properties.
- Electron argv and piped input/output.

Reserve the configured flags and option attribute (`--wizard` and `wizard`
by default). Do not add commands afterward or decorate overlapping trees.

## Security

The wizard writes nothing to disk and has no network access. Inputs appear
on screen and in the rerun command, like any command you type. Do not paste
a rerun command containing secrets into shared places.

## Development

```sh
nub install
nub run typecheck
nub run test          # regression tests and built-package import check
nub run test:smoke    # terminal test; requires expect and stty
nub examples/deploy.ts deploy --wizard
nub pack --dry-run
```

Build with `nub run build`. MIT licensed; see `LICENSE`.
