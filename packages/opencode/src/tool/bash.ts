import { z } from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./bash.txt"
import { App } from "../app/app"

const MAX_OUTPUT_LENGTH = 30000
const DEFAULT_TIMEOUT = 1 * 60 * 1000
const MAX_TIMEOUT = 10 * 60 * 1000

export const BashTool = Tool.define("bash", {
  description: DESCRIPTION,
  parameters: z.object({
    command: z.string().describe("Command to run"),
    timeout: z.number().describe("Timeout in milliseconds (optional)").optional(),
  }),
  async execute(params, ctx) {
    const timeout = Math.min(params.timeout ?? DEFAULT_TIMEOUT, MAX_TIMEOUT)

    // Use OPENCODE_WORKING_DIR if available (when running from TUI), otherwise use app context
    const workingDir = process.env["OPENCODE_WORKING_DIR"] || App.info().path.cwd

    const bashProcess = Bun.spawn({
      cmd: ["bash", "-c", params.command],
      cwd: workingDir,
      maxBuffer: MAX_OUTPUT_LENGTH,
      signal: ctx.abort,
      timeout: timeout,
      stdout: "pipe",
      stderr: "pipe",
    })
    await bashProcess.exited
    const stdout = await new Response(bashProcess.stdout).text()
    const stderr = await new Response(bashProcess.stderr).text()

    return {
      title: params.command,
      metadata: {
        stderr,
        stdout,
        exit: bashProcess.exitCode,
      },
      output: [`<stdout>`, stdout ?? "", `</stdout>`, `<stderr>`, stderr ?? "", `</stderr>`].join("\n"),
    }
  },
})
