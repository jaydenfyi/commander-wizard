import { Command } from 'commander';
import { addWizard } from 'commander-wizard';

const program = new Command('deploy-cli');
const deploy = program.command('deploy')
  .argument('<environment>')
  .requiredOption('--service <name>')
  .option('--region <name>', 'AWS region', 'us-east-1')
  .option('--force', 'skip safety checks')
  .action((environment, options) => console.log({ environment, ...options }));

addWizard(program, { invocation: ['node', 'cli.ts'] });

await program.parseAsync();
