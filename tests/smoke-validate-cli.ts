import { Command, InvalidArgumentError } from "commander";
import { addWizard } from "../src/index.js";

const parseDate = (raw: string) => {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw new InvalidArgumentError("must be a valid date");
  return date;
};
const parseMode = (raw: string) => {
  if (raw !== "eco" && raw !== "warp") throw new InvalidArgumentError("mode must be eco or warp");
  return raw;
};
const parseUrl = (raw: string) => {
  try { return new URL(raw).toString(); } catch { throw new InvalidArgumentError("must be an absolute URL"); }
};

const program = new Command().name("schedule-cli").description(
  "Fixture for the pty smoke test; non-numeric inline validation (date, enum, URL).",
);

program
  .command("schedule")
  .description("Schedule a maintenance window")
  .requiredOption("--start <date>", "window start", parseDate)
  .option("--mode <mode>", "travel mode", parseMode, "eco")
  .option("--url <endpoint>", "status endpoint", parseUrl)
  .action((opts: { start: Date; mode: string; url?: string }) => {
    console.log("scheduled:", JSON.stringify({ start: opts.start.toISOString(), mode: opts.mode, url: opts.url }));
  });

addWizard(program, { invocation: ["nub", "tests/smoke-validate-cli.ts"], validate: true });
await program.parseAsync();
