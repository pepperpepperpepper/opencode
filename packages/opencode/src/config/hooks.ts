import { App } from "../app/app"
import { Bus } from "../bus"
import { File } from "../file"
import { Session } from "../session"
import { Log } from "../util/log"
import { Config } from "./config"
import path from "path"

export namespace ConfigHooks {
  const log = Log.create({ service: "config.hooks" })

  export function init() {
    log.info("init")
    const app = App.info()

    Bus.subscribe(File.Event.Edited, async (payload) => {
      const cfg = await Config.get()
      const ext = path.extname(payload.properties.file)
      for (const item of cfg.experimental?.hook?.file_edited?.[ext] ?? []) {
        log.info("file_edited", {
          file: payload.properties.file,
          command: item.command,
        })
        const workingDir = process.env["OPENCODE_WORKING_DIR"] || app.path.cwd
        Bun.spawn({
          cmd: item.command.map((x) => x.replace("$FILE", payload.properties.file)),
          env: item.environment,
          cwd: workingDir,
          stdout: "ignore",
          stderr: "ignore",
        })
      }
    })

    Bus.subscribe(Session.Event.Idle, async (payload) => {
      const cfg = await Config.get()
      if (cfg.experimental?.hook?.session_completed) {
        const session = await Session.get(payload.properties.sessionID)
        // Only fire hook for top-level sessions (not subagent sessions)
        if (session.parentID) return

        for (const item of cfg.experimental.hook.session_completed) {
          log.info("session_completed", {
            command: item.command,
          })
          const workingDir = process.env["OPENCODE_WORKING_DIR"] || App.info().path.cwd
          Bun.spawn({
            cmd: item.command,
            cwd: workingDir,
            env: item.environment,
            stdout: "ignore",
            stderr: "ignore",
          })
        }
      }
    })
  }
}
