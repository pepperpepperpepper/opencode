import "zod-openapi/extend"
import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { RunCommand } from "./cli/cmd/run"
import { GenerateCommand } from "./cli/cmd/generate"
import { Log } from "./util/log"
import { AuthCommand } from "./cli/cmd/auth"
import { AgentCommand } from "./cli/cmd/agent"
import { UpgradeCommand } from "./cli/cmd/upgrade"
import { ModelsCommand } from "./cli/cmd/models"
import { UI } from "./cli/ui"
import { Installation } from "./installation"
import { NamedError } from "./util/error"
import { FormatError } from "./cli/error"
import { ServeCommand } from "./cli/cmd/serve"
import { TuiCommand } from "./cli/cmd/tui"
import { DebugCommand } from "./cli/cmd/debug"
import { StatsCommand } from "./cli/cmd/stats"
import { McpCommand } from "./cli/cmd/mcp"
import { GithubCommand } from "./cli/cmd/github"
import { Trace } from "./trace"

Trace.init()

const cancel = new AbortController()

process.on("unhandledRejection", (e) => {
  Log.Default.error("rejection", {
    e: e instanceof Error ? e.message : e,
  })
})

process.on("uncaughtException", (e) => {
  Log.Default.error("exception", {
    e: e instanceof Error ? e.message : e,
  })
})

const cli = yargs(hideBin(process.argv))
  .scriptName("opencode")
  .help("help", "show help")
  .version("version", "show version number", Installation.VERSION)
  .alias("version", "v")
  .option("print-logs", {
    describe: "print logs to stderr",
    type: "boolean",
  })
  .option("log-level", {
    describe: "log level",
    type: "string",
    choices: ["DEBUG", "INFO", "WARN", "ERROR"],
  })
  .option("debug-session", {
    describe: "enable debug logging for session errors",
    type: "boolean",
    hidden: true,
  })
  .option("debug-stream", {
    describe: "enable debug logging for stream events",
    type: "boolean",
    hidden: true,
  })
  .option("debug-tools", {
    describe: "enable debug logging for tool calls",
    type: "boolean",
    hidden: true,
  })
  .option("debug", {
    describe: "enable all debug logging (session, stream, tools)",
    type: "boolean",
    hidden: true,
  })
  .middleware(async (opts) => {
    // Set environment variables based on command-line flags
    if (opts.debug) process.env["OPENCODE_DEBUG"] = "true"
    if (opts.debugSession) process.env["OPENCODE_DEBUG_SESSION"] = "true"
    if (opts.debugStream) process.env["OPENCODE_DEBUG_STREAM"] = "true"
    if (opts.debugTools) process.env["OPENCODE_DEBUG_TOOLS"] = "true"

    await Log.init({
      print: process.argv.includes("--print-logs"),
      dev: Installation.isDev(),
      level: (() => {
        if (opts.logLevel) return opts.logLevel as Log.Level
        if (Installation.isDev()) return "DEBUG"
        return "INFO"
      })(),
    })

    Log.Default.info("opencode", {
      version: Installation.VERSION,
      args: process.argv.slice(2),
    })

    // Initialize debug logging for session errors
    const { DebugLog } = await import("./util/debug-log")
    const debugLogPath = DebugLog.init()
    if (debugLogPath) {
      Log.Default.info("debug-log-initialized", { path: debugLogPath })
    }
  })
  .usage("\n" + UI.logo())
  .command(McpCommand)
  .command(TuiCommand)
  .command(RunCommand)
  .command(GenerateCommand)
  .command(DebugCommand)
  .command(AuthCommand)
  .command(AgentCommand)
  .command(UpgradeCommand)
  .command(ServeCommand)
  .command(ModelsCommand)
  .command(StatsCommand)
  .command(GithubCommand)
  .fail((msg) => {
    if (msg.startsWith("Unknown argument") || msg.startsWith("Not enough non-option arguments")) {
      cli.showHelp("log")
    }
  })
  .strict()

try {
  await cli.parse()
} catch (e) {
  let data: Record<string, any> = {}
  if (e instanceof NamedError) {
    const obj = e.toObject()
    Object.assign(data, {
      ...obj.data,
    })
  }

  if (e instanceof Error) {
    Object.assign(data, {
      name: e.name,
      message: e.message,
      cause: e.cause?.toString(),
    })
  }

  if (e instanceof ResolveMessage) {
    Object.assign(data, {
      name: e.name,
      message: e.message,
      code: e.code,
      specifier: e.specifier,
      referrer: e.referrer,
      position: e.position,
      importKind: e.importKind,
    })
  }
  Log.Default.error("fatal", data)
  const formatted = FormatError(e)
  if (formatted) UI.error(formatted)
  if (formatted === undefined) UI.error("Unexpected error, check log file at " + Log.file() + " for more details")
  process.exitCode = 1
}

cancel.abort()
