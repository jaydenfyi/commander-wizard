import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, rmSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command, Option } from 'commander';
const answers: unknown[] = [];
const notes: string[] = [];
const prompts: { initialValue?: unknown; initialValues?: unknown; required?: boolean; validate?: (value: string) => unknown }[] = [];
async function answer(options: { validate?: (value: string) => unknown; initialValue?: unknown; initialValues?: unknown; required?: boolean }) {
  prompts.push(options);
  assert.ok(answers.length, 'unexpected prompt');
  const value = answers.shift();
  if (typeof value === 'string' && options.validate) assert.equal(options.validate(value), undefined);
  return value;
}
mock.module('@clack/prompts', { namedExports: {
  intro() {}, outro() {}, cancel() {}, note(message: string) { notes.push(message); },
  text: answer, confirm: answer, select: answer, multiselect: answer,
  isCancel: (value: unknown) => typeof value === 'symbol',
}});
const { addWizard } = await import('../src/wizard.js');
Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });


function fixture(wrapped: boolean) {
  const events: string[] = [];
  const root = new Command('test').exitOverride().configureOutput({ writeErr() {} });
  const child = root.command('run').argument('<target>').requiredOption('--name <value>');
  child.hook('preAction', () => { events.push('pre'); });
  child.action(() => { events.push('action'); });
  if (wrapped) addWizard(root);
  return { root, child, events };
}

test('ordinary invocations retain native errors and hook ordering', async () => {
  for (const argv of [['run'], ['run', '--unknown'], ['run', '--name', 'x'], ['run', 'target', '--name', 'x']]) {
    const results: unknown[] = [];
    for (const wrapped of [false, true]) {
      const { root, child, events } = fixture(wrapped);
      let error;
      try { await root.parseAsync(argv, { from: 'user' }); }
      catch (e) { error = { code: (e as { code: string }).code, message: (e as Error).message }; }
      results.push({ error, events, options: child.opts(), args: child.processedArgs });
    }
    assert.deepEqual(results[1], results[0]);
  }
});

test('decoration preserves requirements and is idempotent', () => {
  const { root, child } = fixture(true);
  assert.equal(child.registeredArguments[0]!.required, true);
  assert.equal(child.options[0]!.mandatory, true);
  assert.equal(addWizard(root), root);
});

test('collision preflight leaves all commands unchanged', () => {
  const root = new Command();
  const first = root.command('first').argument('<x>');
  root.command('second').addOption(new Option('--wizard <value>'));
  assert.throws(() => addWizard(root), /conflict/i);
  assert.equal(first.options.length, 0);
  assert.equal(first.registeredArguments[0]!.required, true);
});

function interactive(root: Command, values: unknown[]) {
  answers.splice(0, answers.length, ...values);
  notes.length = 0;
  prompts.length = 0;
  root.exitOverride().configureOutput({ writeErr() {} });
  return root;
}

test('root wizard passes raw input through parser once, then hooks', async () => {
  const events: string[] = [];
  const root = new Command('single').argument('<target>')
    .option('--date <value>', '', (raw: string) => { events.push(raw); return new Date(raw); });
  root.hook('preAction', () => { events.push('hook'); });
  root.action((target, opts) => {
    assert.equal(target, 'hello world');
    assert.ok(opts.date instanceof Date);
    events.push('action');
  });
  interactive(root, ['2026-01-01', 'hello world', -1, true]);
  addWizard(root, { invocation: ['real-cli'] });
  await root.parseAsync(['--wizard'], { from: 'user' });
  assert.deepEqual(events, ['2026-01-01', 'hook', 'action']);
  assert.equal(root.opts().wizard, undefined);
  assert.equal(answers.length, 0);
});

test('rerun shell tokens round-trip globals, negations, defaults, short flags and variadics', async () => {
  const root = new Command('unused').requiredOption('--account <name>');
  const leaf = root.command('run').option('-s <name>').option('--region <value>', '', 'east')
    .option('--no-color').option('--tags <values...>').argument('<files...>');
  let result: unknown;
  leaf.action((files, opts) => { result = { files, opts, account: root.opts().account }; });
  const tricky = ['a b', "x'y", '$(echo BAD)', '*', '--literal'];
  interactive(root, ['team one', 'short value', 'east', false, ...tricky, '', ...tricky, '', -1, true]);
  addWizard(root, { invocation: ['runner'] });
  await root.parseAsync(['run', '--wizard'], { from: 'user' });
  const line = notes[0]!.split('rerun non-interactively:\n')[1]!;
  // Harmless shell function returns its argv as JSON. No external user data is executed.
  const output = execFileSync('sh', ['-c', `runner() { node -e 'console.log(JSON.stringify(process.argv.slice(1)))' -- "$@"; }; ${line}`], { encoding: 'utf8' });
  const tokens: string[] = JSON.parse(output);
  assert.ok(tokens.includes('--region=east'));
  assert.ok(tokens.includes('--no-color'));
  assert.ok(!tokens.includes('<name>'));
  const expected = result;
  await root.parseAsync(tokens, { from: 'user' });
  assert.deepEqual(result, expected);
});

test('required variadic choices use arrays and native requirements stay enforced', async () => {
  const root = new Command('single').addOption(new Option('--colors <items...>').choices(['red', 'blue']).makeOptionMandatory())
    .addArgument(new (await import('commander')).Argument('<targets...>').choices(['one', 'two']));
  let result: unknown;
  root.action((targets, opts) => { result = { targets, colors: opts.colors }; });
  interactive(root, [['red'], ['one', 'two'], -1, true]);
  addWizard(root);
  await root.parseAsync(['--wizard'], { from: 'user' });
  assert.deepEqual(result, { targets: ['one', 'two'], colors: ['red'] });
});

test('cancel and decline never run host hooks or actions', async () => {
  for (const response of [false, Symbol('cancel')]) {
    let calls = 0;
    const root = new Command().option('--force').exitOverride().configureOutput({ writeErr() {} });
    root.hook('preAction', () => { calls++; });
    root.action(() => { calls++; });
    interactive(root, [false, -1, response]);
    addWizard(root);
    await assert.rejects(root.parseAsync(['--wizard'], { from: 'user' }), { code: 'commander-wizard.cancelled' });
    assert.equal(calls, 0);
    assert.equal(root.getOptionValue('force'), undefined);
  }
});

test('Commander rejects prompted conflicts before any host hooks', async () => {
  let calls = 0;
  const root = new Command().addOption(new Option('--one').conflicts('two')).option('--two');
  root.hook('preAction', () => { calls++; });
  root.action(() => { calls++; });
  interactive(root, [true, true, -1, true]);
  addWizard(root);
  await assert.rejects(root.parseAsync(['--wizard'], { from: 'user' }), { code: 'commander.conflictingOption' });
  assert.equal(calls, 0);
});

test('unsupported layouts fail before prompting and ordinary invocations still work', async () => {
  const root = new Command().addOption(new Option('--token <value>').env('TOKEN')).exitOverride().configureOutput({ writeErr() {} });
  root.action(() => {});
  addWizard(root);
  await assert.rejects(root.parseAsync(['--wizard'], { from: 'user' }), /env bindings/);
  await root.parseAsync(['--token', 'value'], { from: 'user' });
  assert.equal(root.opts().token, 'value');
});

test('sync wizard is rejected; marker positional and option values remain ordinary data', async () => {
  const root = new Command().option('--name <value>').argument('[value]').action(() => {});
  addWizard(root);
  assert.throws(() => root.parse(['--wizard'], { from: 'user' }), /parseAsync/);
  root.parse(['--name', '--wizard'], { from: 'user' });
  assert.equal(root.opts().name, '--wizard');
  await root.parseAsync(['--', '--wizard'], { from: 'user' });
  assert.deepEqual(root.processedArgs, ['--wizard']);
});

test('custom parser defaults require explicit raw spellings, never String(object)', async () => {
  const opt = new Option('--date <value>').argParser(raw => new Date(raw)).default(new Date('2026-01-01'));
  const root = new Command().addOption(opt).action(() => {}).exitOverride().configureOutput({ writeErr() {} });
  interactive(root, []);
  addWizard(root);
  await assert.rejects(root.parseAsync(['--wizard'], { from: 'user' }), /rawDefaults/);
});

test('built package imports from a clean consumer package boundary', () => {
  const dir = mkdtempSync(join(tmpdir(), 'commander-wizard-consumer-'));
  try {
    const pkg = join(dir, 'node_modules', 'commander-wizard');
    mkdirSync(pkg, { recursive: true });
    cpSync('dist', join(pkg, 'dist'), { recursive: true });
    cpSync('package.json', join(pkg, 'package.json'));
    // Runtime dependencies are linked exactly as an installation would resolve them.
    mkdirSync(join(dir, 'node_modules', '@clack'), { recursive: true });
    for (const name of ['commander', '@clack/prompts'])
      symlinkSync(realpathSync(join(process.cwd(), 'node_modules', name)), join(dir, 'node_modules', name), 'dir');
    writeFileSync(join(dir, 'check.mjs'), "import { addWizard } from 'commander-wizard'; import { Command } from 'commander'; addWizard(new Command()); console.log('IMPORT-OK');");
    const env = { ...process.env };
    delete env.NODE_OPTIONS; // consumer must work without nub's TypeScript loader
    assert.match(execFileSync(process.execPath, ['check.mjs'], { cwd: dir, env, encoding: 'utf8' }), /IMPORT-OK/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rawDefaults preserve parser seed semantics without speculative calls', async () => {
  let calls = 0;
  const option = new Option('--sum <n>').default(10).argParser((raw, previous: number) => {
    calls++; return previous + Number(raw);
  });
  const root = new Command().addOption(option).action(() => {});
  interactive(root, ['0', -1, true]);
  addWizard(root, { rawDefaults: new Map([[option, ['0']]]) });
  await root.parseAsync(['--wizard'], { from: 'user' });
  assert.equal(root.opts().sum, 10);
  assert.equal(calls, 1);
});

test('mixed positive/negative occurrences preserve user order', async () => {
  const root = new Command().option('--color').option('--no-color').action(() => {});
  interactive(root, [true]);
  addWizard(root);
  await root.parseAsync(['--wizard', '--color', '--no-color', '--color'], { from: 'user' });
  assert.equal(root.opts().color, true);
});

test('legacy listeners and no-action commands keep native validation; no-action leafs enter wizard mode', async () => {
  const root = new Command().exitOverride().configureOutput({ writeErr() {} });
  root.command('run').argument('<target>').requiredOption('--name <value>');
  let ran = false;
  root.on('command:run', () => { ran = true; });
  addWizard(root);
  await assert.rejects(root.parseAsync(['run'], { from: 'user' }), { code: 'commander.missingMandatoryOptionValue' });
  Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
  try {
    // No-action leaf with a legacy listener passes layout and reaches the TTY gate;
    // the re-parse would fire the listener once with validated values.
    await assert.rejects(root.parseAsync(['run', '--wizard'], { from: 'user' }), /TTY/);
  } finally { Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true }); }
  assert.equal(ran, false);
});

test('TTY-less requests fail rather than hanging', async () => {
  const root = new Command().action(() => {}).exitOverride().configureOutput({ writeErr() {} });
  addWizard(root);
  Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
  try { await assert.rejects(root.parseAsync(['--wizard'], { from: 'user' }), /TTY/); }
  finally { Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true }); }
});

test('ordinary option data survives command layouts outside the wizard grammar', async () => {
  const root = new Command().option('--global <value>');
  const leaf = root.command('run').option('--name <value>').action(() => {});
  addWizard(root);
  await root.parseAsync(['--global', 'x', 'run', '--name', '--wizard'], { from: 'user' });
  assert.equal(leaf.opts().name, '--wizard');
  assert.equal(root.opts().global, 'x');
});

test('bundled wizard flags cannot bypass prompting and run the action', async () => {
  let ran = false;
  const root = new Command().option('-v, --verbose').action(() => { ran = true; }).exitOverride().configureOutput({ writeErr() {} });
  addWizard(root, { flags: '-i, --interactive' });
  await assert.rejects(root.parseAsync(['-vi'], { from: 'user' }), /unbundled/);
  assert.equal(ran, false);
});


test('review edits retain other answers, replace tokens, and defer parsers and hooks', async () => {
  const events: string[] = [];
  const root = new Command('edit').option('--supplied <value>')
    .option('--count <n>', '', raw => { events.push(raw); return Number(raw); })
    .option('--force')
    .addOption(new Option('--regions <names...>').choices(['east', 'west']))
    .argument('<target>');
  root.hook('preAction', () => { events.push('hook'); });
  root.action(() => { events.push('action'); });
  interactive(root, [
    '1', false, ['east'], 'old target',
    0, '2', // edit count
    1, true, // edit boolean
    2, ['west'], // edit multiselect
    3, "new 'target'", // edit positional
    -1, true,
  ]);
  addWizard(root, { invocation: ['runner'] });
  await root.parseAsync(['--wizard', '--supplied', 'keep'], { from: 'user' });
  assert.deepEqual(root.opts(), { supplied: 'keep', count: 2, force: true, regions: ['west'] });
  assert.deepEqual(root.processedArgs, ["new 'target'"]);
  assert.deepEqual(events, ['2', 'hook', 'action']);
  assert.equal(notes.length, 5);
  assert.equal(prompts[5]!.initialValue, '1');
  assert.equal(prompts[7]!.initialValue, false);
  assert.deepEqual(prompts[9]!.initialValues, ['east']);
  assert.equal(prompts[11]!.initialValue, 'old target');
  assert.match(notes.at(-1)!, /--count=2 --force --regions=west/);
  assert.doesNotMatch(notes.at(-1)!, /--count=1|--regions=east|old target/);
  assert.equal(answers.length, 0);
});

test('cancel at review or while editing runs nothing', async () => {
  for (const tail of [[Symbol('cancel')], [0, Symbol('cancel')], [0, 'changed', -1, false]]) {
    let calls = 0;
    const root = new Command().option('--name <value>', '', raw => { calls++; return raw; }).exitOverride().configureOutput({ writeErr() {} });
    root.hook('preAction', () => { calls++; });
    root.action(() => { calls++; });
    interactive(root, ['first', ...tail]);
    addWizard(root);
    await assert.rejects(root.parseAsync(['--wizard'], { from: 'user' }), { code: 'commander-wizard.cancelled' });
    assert.equal(calls, 0);
    assert.equal(root.opts().name, undefined);
    assert.equal(answers.length, 0);
  }
});

test('default flag is --wizard and leaves short flags available', async () => {
  const root = new Command().option('-i, --input <value>').option('-w, --watch').action(() => {});
  addWizard(root);
  assert.equal(root.options.at(-1)!.flags, '--wizard');
  await root.parseAsync(['-i', 'file', '-w'], { from: 'user' });
  assert.deepEqual(root.opts(), { input: 'file', watch: true });
});

test('custom flags control help, interception, and stripping independently per root', async () => {
  for (const [flags, marker] of [['-i, --interactive', '-i'], ['-i, --interactive', '--interactive'], ['-w', '-w'], ['--guided-mode', '--guided-mode']] as const) {
    const root = new Command('custom').option('--wizard').action(() => {});
    interactive(root, [true]);
    addWizard(root, { flags });
    assert.match(root.helpInformation(), new RegExp(marker));
    await root.parseAsync([marker, '--wizard'], { from: 'user' });
    // --wizard belongs to the host here, and must survive.
    assert.deepEqual(root.opts(), { wizard: true });
    assert.equal(answers.length, 0);
    assert.throws(() => root.parse([marker], { from: 'user' }), /parseAsync/);
  }
});

test('custom markers used as values or after -- remain data', async () => {
  const root = new Command().option('--name <value>').argument('[value]').action(() => {});
  addWizard(root, { flags: '-i, --interactive' });
  await root.parseAsync(['--name', '--interactive'], { from: 'user' });
  assert.equal(root.opts().name, '--interactive');
  await root.parseAsync(['--', '-i'], { from: 'user' });
  assert.deepEqual(root.processedArgs, ['-i']);
});

test('invalid custom flags and collisions fail before decoration', () => {
  for (const flags of ['', 'interactive', '--interactive <value>', '--interactive [value]', '--no-interactive', '-i, -w', '--one --two']) {
    const root = new Command().command('run').action(() => {});
    assert.throws(() => addWizard(root, { flags }), /flags/);
    assert.equal(root.options.length, 0);
  }
  for (const existing of ['-i, --input <value>', '--interactive', '--no-interactive']) {
    const root = new Command();
    const first = root.command('first');
    root.command('second').option(existing);
    assert.throws(() => addWizard(root, { flags: '-i, --interactive' }), /conflict/);
    assert.equal(first.options.length, 0);
  }
  assert.throws(() => addWizard(new Command(), { flags: '-h, --help' }), /conflict/);
});

test('scan matches Commander: = terminated variadic leaves positionals', async () => {
  let result: unknown;
  const root = new Command('scan')
    .option('--tags <tags...>')
    .argument('<target>')
    .action((target, opts) => { result = { target, opts }; });
  await root.parseAsync(['--tags=a', 'prod', '--tags=b'], { from: 'user' });
  const ordinary = result;
  interactive(root, [true]);
  addWizard(root, { invocation: ['scan'] });
  await root.parseAsync(['--wizard', '--tags=a', 'prod', '--tags=b'], { from: 'user' });
  assert.deepEqual(result, ordinary);
  assert.match(notes[0]!, /--tags=a --tags=b/);
});

test('defaulted inputs cannot be emptied, so review cannot mislead', async () => {
  const root = new Command().option('--region <area>', '', 'east').action(() => {});
  interactive(root, ['west', -1, true]);
  addWizard(root);
  await root.parseAsync(['--wizard'], { from: 'user' });
  assert.equal(root.opts().region, 'west');
  const textPrompt = prompts.find(pr => typeof pr.validate === 'function')!;
  assert.ok(typeof textPrompt.validate!('') === 'string'); // empty refused at the prompt
  assert.equal(textPrompt.initialValue, 'east'); // default prefilled, Enter accepts it

  const zones = new Command('zones').addOption(new Option('--zones <names...>').choices(['a', 'b']).default(['a'])).action(() => {});
  interactive(zones, [['b'], -1, true]);
  addWizard(zones);
  await zones.parseAsync(['--wizard'], { from: 'user' });
  assert.deepEqual(zones.opts().zones, ['b']);
  const multiPrompt = prompts.find(pr => Array.isArray(pr.initialValues))!;
  assert.equal(multiPrompt.required, true); // clearing the multiselect is refused
  assert.equal(answers.length, 0);
});
