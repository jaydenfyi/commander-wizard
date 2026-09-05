import * as p from '@clack/prompts';
import { inspect } from 'node:util';
import type { Argument, Command, Option } from 'commander';

export class WizardCancelledError extends Error {
  constructor() { super('Wizard cancelled.'); this.name = 'WizardCancelledError'; }
}

export interface WizardOptions {
  /** Commander boolean flag declaration. Defaults to --wizard. */
  flags?: string;
  /** Executable and prefix arguments, e.g. ['nub', 'example.ts']. Never a shell fragment. */
  invocation?: readonly string[];
  /** Raw CLI spellings for defaults processed by custom parsers. Key by Option/Argument identity. */
  rawDefaults?: ReadonlyMap<Option | Argument, readonly string[]>;
}

const installed = new WeakSet<Command>();
const fail = (message: string): never => { throw new Error(`Wizard: ${message}`); };

/** Decorate an already-configured program. No global/prototype patching; use parseAsync for wizard mode. */
export function addWizard<T extends Command>(program: T, config: WizardOptions = {}): T {
  if (installed.has(program)) return program;
  if (config.invocation && (!config.invocation.length || !config.invocation.every(v => typeof v === 'string') || !config.invocation[0]))
    fail('invocation must contain an executable followed by string arguments.');
  const flags = config.flags ?? '--wizard';
  if (typeof flags !== 'string' || !/^(?:-[a-zA-Z0-9](?:[ ,|]+--[a-zA-Z0-9][a-zA-Z0-9-]*)?|--[a-zA-Z0-9][a-zA-Z0-9-]*)$/.test(flags))
    fail('flags must declare a boolean flag, e.g. --wizard or -i, --interactive.');
  const flagOption = program.createOption(flags);
  if (flagOption.negate) fail('flags must not use a negated --no- flag.');
  const markers = new Set([flagOption.short, flagOption.long].filter((flag): flag is string => flag !== undefined));
  const wizardKey = flagOption.attributeName();
  const commands: Command[] = [];
  const visit = (cmd: Command) => { commands.push(cmd); cmd.commands.forEach(visit); };
  visit(program);
  // Preflight the whole tree before changing any command.
  for (const cmd of commands) {
    const help = cmd.createHelp().visibleOptions(cmd);
    if ([...cmd.options, ...help].some(o => markers.has(o.short ?? '') || markers.has(o.long ?? '') || o.attributeName() === wizardKey))
      fail(`flag conflict on ${cmd.name() || 'program'}: ${flags} is reserved.`);
    if (installed.has(cmd)) fail('overlapping decorated command trees are unsupported.');
  }
  const parseAsync = program.parseAsync;
  for (const cmd of commands.filter(cmd => cmd.commands.length === 0)) {
    cmd.option(flags, 'collect command inputs interactively');
    // Never let a wizard flag that escaped our bounded scanner dispatch an action.
    cmd.on(`option:${flagOption.name()}`,  () => fail('use parseAsync() with an explicit command path and unbundled flags for wizard mode.'));
  }
  program.parseAsync = async function (argv, options) {
    const args = userArgs(argv, options?.from);
    if (!requested(args, markers)) return await parseAsync.call(this, argv, options) as T;
    if (options?.from === 'electron' || (!argv && process.versions.electron)) fail('Electron wizard invocations are unsupported; pass explicit user arguments.');
    let input: Input;
    try { input = scan(program, args, markers); }
    catch {
      // Commander can distinguish reserved text used as data in grammars we do not support.
      // An actual wizard option is stopped by the option listener above.
      return await parseAsync.call(this, argv, options) as T;
    }
    // A marker consumed as an option value is data, not a wizard request.
    if (!input.wizard) return await parseAsync.call(this, argv, options) as T;
    checkLayout(input.chain, wizardKey);
    if (!process.stdin.isTTY || !process.stdout.isTTY) fail('interactive input requires a TTY.');
    const completed = await collect(input, config, wizardKey);
    // Commander alone owns coercion, validation, hooks, and action dispatch.
    return await parseAsync.call(this, completed, { from: 'user' }) as T;
  };
  installed.add(program);
  return program;
}

function userArgs(argv: readonly string[] | undefined, from: string | undefined): string[] {
  if (from === 'user') return [...(argv ?? process.argv)];
  return (argv ?? process.argv).slice(!argv && Reflect.get(process, '_eval') !== undefined ? 1 : 2);
}

function requested(args: readonly string[], markers: ReadonlySet<string>): boolean {
  const end = args.indexOf('--');
  return args.slice(0, end < 0 ? args.length : end).some(a => markers.has(a));
}

type Input = {
  chain: Command[];
  options: Map<Option, string[]>;
  positionals: string[];
  supplied: { option: Option; tokens: string[] }[];
  wizard: boolean;
};

/** Deliberately bounded wizard grammar: explicit command path first, unbundled options. */
function scan(root: Command, args: readonly string[], markers: ReadonlySet<string>): Input {
  const chain = [root];
  let index = 0;
  let cmd = root;
  while (index < args.length) {
    const child = cmd.commands.find(c => c.name() === args[index] || c.aliases().includes(args[index]!));
    if (!child) break;
    chain.push(child); cmd = child; index++;
  }
  const result: Input = { chain, options: new Map(), positionals: [], supplied: [], wizard: false };
  const options = chain.flatMap(c => c.options);
  while (index < args.length) {
    const token = args[index++]!;
    if (token === '--') { result.positionals.push(...args.slice(index)); break; }
    if (markers.has(token)) { result.wizard = true; continue; }
    if (!token.startsWith('-') || token === '-') { result.positionals.push(token); continue; }
    const equal = token.startsWith('--') ? token.indexOf('=') : -1;
    const flag = equal < 0 ? token : token.slice(0, equal);
    const opt = options.find(o => o.long === flag || o.short === flag);
    if (!opt) return fail(`unknown or bundled option ${flag}. Put the full command path first; use separate flags.`);
    const raw: string[] = [];
    raw.push(token);
    if (opt.required || opt.optional) {
      if (equal < 0) {
        if (index >= args.length || (opt.optional && args[index]!.startsWith('-')))
          fail(`supply a value for ${flag} in wizard mode.`);
        raw.push(args[index++]!);
      }
      if (opt.variadic && equal < 0) while (index < args.length && !args[index]!.startsWith('-')) raw.push(args[index++]!);
    } else if (equal >= 0) fail(`${flag} does not take a value.`);
    result.options.set(opt, [...(result.options.get(opt) ?? []), ...raw]);
    result.supplied.push({ option: opt, tokens: raw });
  }
  return result;
}

function checkLayout(chain: readonly Command[], wizardKey: string): void {
  const keys = new Map<string, number>();
  for (const [index, cmd] of chain.entries()) {
    // Commander 15 has no public capability getters. Keep these checks in one place.
    for (const field of ['_executableHandler', '_passThroughOptions', '_enablePositionalOptions', '_defaultCommandName', '_storeOptionsAsProperties'])
      if (Reflect.get(cmd, field)) fail(`${field} is unsupported in wizard mode.`);
    if (index < chain.length - 1 && cmd.registeredArguments.length) fail('ancestor positional arguments are unsupported in wizard mode.');
    for (const opt of cmd.options) {
      if (opt.attributeName() === wizardKey) continue;
      for (const key of [opt.attributeName(), opt.long, opt.short].filter((v): v is string => v !== undefined)) {
        if (keys.has(key) && keys.get(key) !== index) fail(`shadowed global option ${key}.`);
        keys.set(key, index);
      }
      const siblings = cmd.options.filter(o => o.attributeName() === opt.attributeName());
      if (siblings.length > 1 && !(siblings.length === 2 && siblings.some(o => o.negate) && siblings.some(o => o.isBoolean())))
        fail(`ambiguous option attribute ${opt.attributeName()}.`);
      if (index < chain.length - 1 && opt.variadic) fail('ancestor variadic options are unsupported in wizard mode.');
      if (opt.isBoolean() && opt.parseArg) fail('boolean custom parsers are unsupported in wizard mode.');
      if (opt.optional || opt.envVar || opt.presetArg !== undefined)
        fail(`${opt.flags}: optional values, env bindings, and presets are unsupported in wizard mode.`);
    }
  }
  const leaf = chain.at(-1)!;
  if (leaf.commands.length || !Reflect.get(leaf, '_actionHandler')) fail('select an explicit in-process action command. Legacy listeners are unsupported.');
}

function defaults(owner: Option | Argument, config: WizardOptions): string[] {
  if (owner.defaultValue === undefined) return [];
  const supplied = config.rawDefaults?.get(owner);
  if (supplied) {
    if (!supplied.every(v => typeof v === 'string') || (!owner.variadic && supplied.length !== 1)) fail('rawDefaults must contain raw strings (one for a scalar input).');
    return [...supplied];
  }
  // choices() installs a parser, but its default strings remain CLI spellings.
  if (owner.parseArg && !owner.argChoices) fail(`provide rawDefaults for ${'flags' in owner ? owner.flags : owner.name()}; custom parsers are not reversible.`);
  const values: unknown[] = Array.isArray(owner.defaultValue) ? owner.defaultValue : [owner.defaultValue];
  if (!values.every(v => typeof v === 'string' || typeof v === 'number')) fail('non-text defaults require rawDefaults.');
  return values.map(String);
}

async function ask(owner: Option | Argument, required: boolean, def: string[], editing = false): Promise<string[]> {
  const label = 'flags' in owner ? owner.flags : owner.name();
  const hasDefault = owner.defaultValue !== undefined &&
    (Array.isArray(owner.defaultValue) ? owner.defaultValue.length > 0 : owner.defaultValue !== '');
  // Omitting tokens would restore Commander's default, not clear it.
  required ||= hasDefault;
  const emptyError = hasDefault ? 'Enter a value; omission restores the default.' : 'Required';
  const message = `${label}${owner.description ? ` — ${owner.description}` : ''}`;
  if (owner.argChoices?.length) {
    const options = owner.argChoices.map(value => ({ value }));
    if (owner.variadic) return unwrap(await p.multiselect({
      message: hasDefault ? `${message} (select at least one; omission restores the default)` : message,
      options, required, initialValues: def,
    }));
    // Optional choices must be skippable rather than silently selecting the first entry.
    if (!required && !def.length && !unwrap(await p.confirm({ message: `Set ${label}?`, initialValue: false }))) return [];
    return [unwrap(await p.select({ message, options, ...(def[0] === undefined ? {} : { initialValue: def[0] }) }))];
  }
  if (owner.variadic) {
    // ponytail: one value per line; empty value as a list item is not expressible, fine for CLI inputs.
    const values: string[] = [];
    const note = def.length ? `${editing ? ' (current' : ' (default'}: ${def.join(', ')})` : '';
    while (true) {
      const soFar = values.length ? ` — added: ${values.join(', ')}` : '';
      const value = unwrap(await p.text({
        message: `${message}${note}${soFar} (empty line to finish)`,
        validate: v => !v?.trim() && required && !values.length ? 'Enter at least one value' : undefined,
      }));
      if (!value.trim()) break;
      values.push(value.trim());
    }
    return values;
  }
  const value = unwrap(await p.text({
    message,
    // Prefill the default so Enter accepts it visibly; clearing is refused below.
    ...(def.length ? { initialValue: def[0]! } : {}),
    validate(value) {
      if (!value) return required ? emptyError : undefined;
      return undefined;
    },
  }));
  return value === '' ? [] : [value];
}

function optionTokens(opt: Option, values: readonly string[]): string[] {
  const flag = opt.long ?? opt.short!;
  // Repeated long assignments protect leading '-' values and terminate each variadic occurrence.
  if (opt.long) return values.map(value => `${flag}=${value}`);
  return values.flatMap(value => [flag, value]);
}

async function collect(input: Input, config: WizardOptions, wizardKey: string): Promise<string[]> {
  const leaf = input.chain.at(-1)!;
  const answers = new Map<Option | Argument, string[]>();
  const booleans = new Map<Option, boolean>();
  p.intro(`${leaf.name()} · wizard`);
  while (true) {
    const argv: string[] = [];
    const summary: string[] = [];
    const editable: { label: string; edit: () => Promise<void> }[] = [];
    const collectValue = async (owner: Option | Argument, required: boolean) => {
      const values = answers.get(owner) ?? await ask(owner, required, defaults(owner, config));
      answers.set(owner, values);
      editable.push({
        label: 'flags' in owner ? owner.flags : owner.name(),
        edit: async () => { answers.set(owner, await ask(owner, required, values, true)); },
      });
      return values;
    };
    for (const [index, cmd] of input.chain.entries()) {
      if (index) argv.push(cmd.name());
      for (const entry of input.supplied) if (cmd.options.includes(entry.option)) argv.push(...entry.tokens);
      const seen = new Set<string>();
      for (const opt of cmd.options) {
        const key = opt.attributeName();
        if ([wizardKey, 'help', 'version'].includes(key) || seen.has(key)) continue;
        seen.add(key);
        const group = cmd.options.filter(o => o.attributeName() === key);
        const provided = group.flatMap(o => input.options.get(o) ?? []);
        if (provided.length) { summary.push(`${key}: ${inspect(provided)}`); continue; }
        const positive = group.find(o => !o.negate);
        const negative = group.find(o => o.negate);
        if (opt.isBoolean() || opt.negate) {
          const def = group.reduce((value, option) => option.defaultValue === undefined ? value : Boolean(option.defaultValue), !positive);
          // No invented --no-x: restrict answers to states the CLI can actually express.
          const fixed = (positive && def && !negative) || (!positive && !def);
          const message = `${key} — ${opt.description}`;
          const value = booleans.get(opt) ?? (fixed ? def : unwrap(await p.confirm({ message, initialValue: def })));
          booleans.set(opt, value);
          if (!fixed) editable.push({
            label: opt.flags,
            edit: async () => { booleans.set(opt, unwrap(await p.confirm({ message, initialValue: value }))); },
          });
          if (value && positive) argv.push(positive.long ?? positive.short!);
          else if (!value && negative) argv.push(negative.long ?? negative.short!);
          summary.push(`${key}: ${value}`);
        } else {
          const values = await collectValue(opt, opt.mandatory);
          argv.push(...optionTokens(opt, values));
          summary.push(`${key}: ${inspect(values.length ? values : undefined)}`);
        }
      }
    }
    const positional: string[] = [];
    let cursor = 0;
    let omitted = false;
    for (const arg of leaf.registeredArguments) {
      let values = arg.variadic ? input.positionals.slice(cursor) : input.positionals.slice(cursor, cursor + 1);
      cursor += values.length;
      if (!values.length) values = await collectValue(arg, arg.required);
      if (omitted && values.length) fail('cannot supply a positional argument after an omitted argument.');
      if (!values.length && !arg.variadic) omitted = true;
      positional.push(...values);
      summary.push(`${arg.name()}: ${inspect(arg.variadic ? values : values[0])}`);
    }
    positional.push(...input.positionals.slice(cursor)); // let Commander report excess arguments
    argv.push('--', ...positional);
    const invocation = config.invocation ?? [process.execPath, ...process.execArgv, process.argv[1] ?? fail('provide invocation.')];
    const tokens = [...invocation, ...argv];
    if (tokens.some(token => token.includes('\0'))) fail('NUL bytes cannot be represented in shell arguments.');
    const command = tokens.map(shellQuote).join(' ');
    p.note(`${summary.join('\n')}\n\nrerun non-interactively:\n${command}`, 'Review CLI inputs (Commander validates after confirmation)');
    if (editable.length) {
      const selected = unwrap(await p.select({
        message: 'Continue or edit an input?',
        options: [
          { value: -1, label: 'Continue to confirmation' },
          ...editable.map((field, value) => ({ value, label: `Edit ${field.label}` })),
        ],
        initialValue: -1,
      }));
      if (selected !== -1) { await editable[selected]!.edit(); continue; }
    }
    if (!unwrap(await p.confirm({ message: 'Run with these settings?', initialValue: false }))) {
      p.cancel('Cancelled — nothing ran.');
      throw new WizardCancelledError();
    }
    p.outro(`Running ${leaf.name()}…`);
    return argv;
  }
}

function unwrap<T>(value: T | symbol): T {
  if (p.isCancel(value)) { p.cancel('Wizard cancelled.'); throw new WizardCancelledError(); }
  return value as T;
}

/** POSIX shell quoting. Windows shells are not supported. */
function shellQuote(value: string): string {
  return /^[\w.,:/@%+=-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}
