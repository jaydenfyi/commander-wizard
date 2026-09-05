import { Argument, Command } from "commander";
import { addWizard } from "../src/index.js";

const program = new Command("deploy-cli");
const deploy = program.command("deploy")
  .addArgument(new Argument("<environment>", "target environment")
    .choices(["dev", "staging", "prod"]))
  .requiredOption("--service <name>")
  .option("--region <name>", "AWS region", "us-east-1")
  .option("--force", "skip safety checks")
  .action((environment, options) => console.log({ environment, ...options }));

// Add your commands and options before calling addWizard.
addWizard(program, { invocation: ["nub", "examples/deploy.ts"] });

await program.parseAsync();
