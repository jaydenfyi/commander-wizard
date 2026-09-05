import { Argument, Command, Option, InvalidArgumentError } from "commander";
import { addWizard } from "../src/index.js";

const program = new Command().name("deploy-cli").description(
  "Demo of the commander-wizard wizard. Try: nub examples/deploy.ts deploy --wizard",
);

const ENVIRONMENTS = ["dev", "staging", "prod"] as const;

program
  .command("deploy")
  .description("Deploy a service to one or more environments")
  .addArgument(new Argument("<envs...>", "target environments").choices([...ENVIRONMENTS]))
  .requiredOption("-s, --service <name>", "service to deploy")
  .option("--tag <tag>", "git tag to deploy")
  .addOption(
    new Option("--regions <regions...>", "AWS regions")
      .choices(["us-east-1", "eu-west-1", "ap-south-1"])
      .default(["us-east-1"]),
  )
  .option("-f, --force", "skip safety checks")
  .option("--replicas <n>", "instance count", (v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1) throw new InvalidArgumentError('must be a positive integer');
    return n;
  }, 3)
  .option("-t, --tags <tags...>", "deploy tags")
  .addOption(
    new Option("--log-level <level>", "verbosity")
      .choices(["debug", "info", "warn"])
      .default("info"),
  )
  .action(async (envs: string[], opts: Record<string, unknown>) => {
    console.log("deploying:", JSON.stringify({ envs, ...opts }));
  });

program
  .command("rollback")
  .description("Roll back the latest deployment")
  .addArgument(new Argument("<env>", "target environment").choices(["prod", "staging"]))
  .option("--dry-run", "show what would happen")
  .action((env: string, opts: Record<string, unknown>) => {
    console.log("rollback:", JSON.stringify({ env, ...opts }));
  });

const replicas = program.commands[0]!.options.find(o => o.long === '--replicas')!;
addWizard(program, {
  invocation: ['nub', 'examples/deploy.ts'],
  rawDefaults: new Map([[replicas, ['3']]]),
});
await program.parseAsync();
