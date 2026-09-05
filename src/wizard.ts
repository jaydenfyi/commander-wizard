import * as p from '@clack/prompts';
import { inspect } from 'node:util';
import type { Argument, Command, Option } from 'commander';

export interface WizardOptions {
  /** Commander boolean flag declaration. Defaults to --wizard. */
  flags?: string;
  /** Executable and prefix arguments, e.g. ['node', 'cli.ts']. Never a shell fragment. */
  invocation?: readonly string[];
  /** Optional raw prefills for custom-parser defaults; otherwise offer to keep the default. Key by Option/Argument identity. */
  rawDefaults?: ReadonlyMap<Option | Argument, readonly string[]>;
  /** Validate scalar text submissions with pure, synchronous parsers. Runs again after confirmation. Default false. */
  validate?: boolean;
}

class WizardError extends Error {}

/** Aborts collection on cancel; surfaced to callers through Commander's exit channel. */
class WizardCancelledError extends Error {
  constructor() { super('Wizard cancelled.'); this.name = 'WizardCancelledError'; }
}

const installed = new WeakSet<Command>();
const fail = (message: string): never => { throw new WizardError(`Wizard: ${message}`); };

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
    try {
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
    } catch (error) {
      // Route our failures through Commander's own channel: stock CLI behavior by default,
      // catchable via .exitOverride() for tests and embedding — no library-specific catches.
      if (error instanceof WizardCancelledError) exitVia(this, 0, 'commander-wizard.cancelled', 'Wizard cancelled.');
      if (error instanceof WizardError) this.error(error.message);
      throw error;
    }
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
  // No action requirement: parse-then-.opts() CLIs work unchanged — the re-parse validates and populates.
  if (leaf.commands.length) fail('select an explicit leaf command; commands with children are ambiguous in wizard mode.');
}

/** Returns [] when there is no default, raw spellings when stringifiable,
 * or undefined when the default cannot be spelled as CLI text (custom parser or non-text value);
 * collectValue then offers keep-or-enter. */
function defaults(owner: Option | Argument, config: WizardOptions): string[] | undefined {
  if (owner.defaultValue === undefined) return [];
  const supplied = config.rawDefaults?.get(owner);
  if (supplied) {
    if (!supplied.every(v => typeof v === 'string') || (!owner.variadic && supplied.length !== 1)) fail('rawDefaults must contain raw strings (one for a scalar input).');
    return [...supplied];
  }
  // choices() installs a parser, but its default strings remain CLI spellings.
  if (owner.parseArg && !owner.argChoices) return undefined;
  const values: unknown[] = Array.isArray(owner.defaultValue) ? owner.defaultValue : [owner.defaultValue];
  if (!values.every(v => typeof v === 'string' || typeof v === 'number')) return undefined; // non-text defaults are kept, not spelled
  return values.map(String);
}

async function ask(owner: Option | Argument, required: boolean, def: string[], editing: boolean, config: WizardOptions): Promise<string[]> {
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
    // Optional choices must be skippable, including when revisiting an earlier answer.
    if (!required && !unwrap(await p.confirm({ message: `Set ${label}?`, initialValue: def.length > 0 }))) return [];
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
      values.push(value);
    }
    return values;
  }
  let unexpected: { error: unknown } | undefined;
  const value = unwrap(await p.text({
    message,
    // Prefill the default so Enter accepts it visibly; clearing is refused below.
    ...(def.length ? { initialValue: def[0]! } : {}),
    validate(value) {
      if (!value) return required ? emptyError : undefined;
      if (config.validate && owner.parseArg) {
        try { owner.parseArg(value, owner.defaultValue); }
        catch (error) {
          // Duck-typed like Commander's own _callParseArg: code-based, not instanceof, so duplicate commander copies still match.
          if (error instanceof Error && 'code' in error && error.code === 'commander.invalidArgument')
            return error.message || 'Invalid value';
          // Let Clack restore the terminal before propagating unexpected failures.
          unexpected = { error };
        }
      }
      return undefined;
    },
  }));
  if (unexpected) throw unexpected.error;
  return value === '' ? [] : [value];
}

function optionTokens(opt: Option, values: readonly string[]): string[] {
  const flag = opt.long ?? opt.short!;
  // Repeated long assignments protect leading '-' values and terminate each variadic occurrence.
  if (opt.long) return values.map(value => `${flag}=${value}`);
  return values.flatMap(value => [flag, value]);
}

/** One planned input per attribute: provided pass-through, boolean pair, or promptable value. */
type Field =
  | { kind: 'provided'; key: string; provided: string[] }
  | { kind: 'boolean'; opt: Option; key: string; message: string; def: boolean; fixed: boolean; positive: Option | undefined; negative: Option | undefined }
  | { kind: 'value'; key: string; opt: Option; required: boolean; def: string[] | undefined };
type Plan = {
  commands: { cmd: Command; supplied: string[][]; fields: Field[] }[];
  positionals: { arg: Argument; from: string[]; def: string[] | undefined }[];
  excess: string[];
};

/** Derive the round's input list once: command walk, attribute groups, CLI positional slices.
 * Round-invariant; prompting and emission stay in collect. */
function planFields(input: Input, config: WizardOptions, wizardKey: string): Plan {
  const commands = input.chain.map(cmd => {
    const fields: Field[] = [];
    const seen = new Set<string>();
    for (const opt of cmd.options) {
      const key = opt.attributeName();
      if ([wizardKey, 'help', 'version'].includes(key) || seen.has(key)) continue;
      seen.add(key);
      const group = cmd.options.filter(o => o.attributeName() === key);
      const provided = group.flatMap(o => input.options.get(o) ?? []);
      if (provided.length) { fields.push({ kind: 'provided', key, provided }); continue; }
      if (opt.isBoolean() || opt.negate) {
        const positive = group.find(o => !o.negate);
        const negative = group.find(o => o.negate);
        const def = group.reduce((value, option) => option.defaultValue === undefined ? value : Boolean(option.defaultValue), !positive);
        // No invented --no-x: restrict answers to states the CLI can actually express.
        fields.push({
          kind: 'boolean', opt, key, message: `${key} — ${opt.description}`, def,
          fixed: (positive && def && !negative) || (!positive && !def), positive, negative,
        });
      } else {
        fields.push({ kind: 'value', key, opt, required: opt.mandatory, def: defaults(opt, config) });
      }
    }
    return { cmd, supplied: input.supplied.filter(e => cmd.options.includes(e.option)).map(e => e.tokens), fields };
  });
  let cursor = 0;
  const positionals = input.chain.at(-1)!.registeredArguments.map(arg => {
    const from = arg.variadic ? input.positionals.slice(cursor) : input.positionals.slice(cursor, cursor + 1);
    cursor += from.length;
    return { arg, from, def: defaults(arg, config) };
  });
  return { commands, positionals, excess: input.positionals.slice(cursor) };
}

/** Shared value prompt: keep-default select when the default cannot be spelled as CLI text, else ask. */
async function promptValue(config: WizardOptions, owner: Option | Argument, required: boolean, def: string[] | undefined, label: string, current?: string[]): Promise<string[]> {
  // Required positional arguments cannot be omitted, even with a default.
  if (def === undefined && ('flags' in owner || !required) && unwrap(await p.select({
    message: `${label} — default: ${owner.defaultValueDescription ?? inspect(owner.defaultValue)}`,
    options: [
      { value: true, label: 'Keep default', hint: 'omit from command; Commander supplies the default' },
      { value: false, label: 'Enter a value' },
    ],
    initialValue: current === undefined || current.length === 0,
  }))) return [];
  return ask(owner, required, current ?? def ?? [], current !== undefined, config);
}

/** Prompt every unanswered input, in display order; answers and booleans survive review edits. */
async function resolve(plan: Plan, answers: Map<Option | Argument, string[]>, booleans: Map<Option, boolean>, config: WizardOptions): Promise<void> {
  for (const { fields } of plan.commands) {
    for (const field of fields) {
      if (field.kind === 'value' && !answers.has(field.opt))
        answers.set(field.opt, await promptValue(config, field.opt, field.required, field.def, field.opt.flags));
      else if (field.kind === 'boolean' && !booleans.has(field.opt))
        booleans.set(field.opt, field.fixed ? field.def : unwrap(await p.confirm({ message: field.message, initialValue: field.def })));
    }
  }
  let omitted = false;
  for (const { arg, from, def } of plan.positionals) {
    if (!from.length && !answers.has(arg)) answers.set(arg, await promptValue(config, arg, arg.required, def, arg.name()));
    const values = from.length ? from : answers.get(arg)!;
    if (omitted && values.length) fail('cannot supply a positional argument after an omitted argument.');
    if (!values.length && !arg.variadic) omitted = true;
  }
}

/** Emission: tokens, review lines, and edit hooks from resolved state. Performs no prompts of its own. */
function emit(plan: Plan, answers: Map<Option | Argument, string[]>, booleans: Map<Option, boolean>, config: WizardOptions): { argv: string[]; summary: string[]; editable: { label: string; edit: () => Promise<void> }[] } {
  const argv: string[] = [];
  const summary: string[] = [];
  const editable: { label: string; edit: () => Promise<void> }[] = [];
  for (const [index, planned] of plan.commands.entries()) {
    if (index) argv.push(planned.cmd.name());
    for (const tokens of planned.supplied) argv.push(...tokens);
    for (const field of planned.fields) {
      if (field.kind === 'provided') { summary.push(`${field.key}: ${inspect(field.provided)}`); continue; }
      if (field.kind === 'boolean') {
        const value = booleans.get(field.opt)!;
        if (!field.fixed) editable.push({
          label: field.opt.flags,
          edit: async () => { booleans.set(field.opt, unwrap(await p.confirm({ message: field.message, initialValue: booleans.get(field.opt)! }))); },
        });
        const emitted = value ? field.positive : field.negative;
        if (emitted) argv.push(emitted.long ?? emitted.short!);
        // An omitted flag has no effective value of its own; implications and defaults stay with Commander.
        summary.push(emitted ? `${field.key}: ${value}` : `${field.key}: not supplied`);
      } else {
        const values = answers.get(field.opt)!;
        argv.push(...optionTokens(field.opt, values));
        const kept = !values.length && field.opt.defaultValue !== undefined;
        summary.push(`${field.key}: ${kept ? 'not supplied (Commander default)' : inspect(values.length ? values : undefined)}`);
        editable.push({
          label: field.opt.flags,
          edit: async () => { answers.set(field.opt, await promptValue(config, field.opt, field.required, field.def, field.opt.flags, answers.get(field.opt))); },
        });
      }
    }
  }
  const positional: string[] = [];
  for (const { arg, from, def } of plan.positionals) {
    // CLI-supplied slices are not editable; prompted ones carry their answer in state.
    const values = from.length ? from : answers.get(arg)!;
    if (!from.length) editable.push({
      label: arg.name(),
      edit: async () => { answers.set(arg, await promptValue(config, arg, arg.required, def, arg.name(), answers.get(arg))); },
    });
    positional.push(...values);
    const kept = !values.length && arg.defaultValue !== undefined;
    summary.push(`${arg.name()}: ${kept ? 'not supplied (Commander default)' : inspect(arg.variadic ? values : values[0])}`);
  }
  positional.push(...plan.excess); // let Commander report excess arguments
  if (positional.length) argv.push('--', ...positional);
  return { argv, summary, editable };
}

async function collect(input: Input, config: WizardOptions, wizardKey: string): Promise<string[]> {
  const leaf = input.chain.at(-1)!;
  const plan = planFields(input, config, wizardKey);
  const answers = new Map<Option | Argument, string[]>();
  const booleans = new Map<Option, boolean>();
  p.intro(`${leaf.name()} · wizard`);
  while (true) {
    await resolve(plan, answers, booleans, config);
    const { argv, summary, editable } = emit(plan, answers, booleans, config);
    const invocation = config.invocation ?? [process.execPath, ...process.execArgv, process.argv[1] ?? fail('provide invocation.')];
    const tokens = [...invocation, ...argv];
    if (tokens.some(token => token.includes('\0'))) fail('NUL bytes cannot be represented in shell arguments.');
    const command = tokens.map(shellQuote).join(' ');
    p.note(summary.join('\n'), 'Review CLI inputs (Commander validates after confirmation)');
    // Undecorated single line: clack note borders and indentation make long commands uncopyable.
    p.log.message(`rerun non-interactively:\n${command}`, { withGuide: false });
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

/** Exits through Commander's own channel so .exitOverride() stays authoritative. */
function exitVia(program: Command, exitCode: number, code: string, message: string): never {
  const exit = Reflect.get(program, '_exit') as (this: Command, exitCode: number, code: string, message: string) => void;
  exit.call(program, exitCode, code, message);
  throw new Error('unreachable: _exit exits, or an exitOverride callback throws');
}

/** POSIX shell quoting. Windows shells are not supported. */
function shellQuote(value: string): string {
  return /^[\w.,:/@%+=-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}
