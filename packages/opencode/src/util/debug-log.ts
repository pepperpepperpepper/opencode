import fs from "fs"
import path from "path"
import { Global } from "../global"

/**
 * Debug logger for session errors and AI SDK issues
 * Writes detailed logs to a dedicated file for troubleshooting
 *
 * Environment variables:
 * - OPENCODE_DEBUG_SESSION: Enable session error logging
 * - OPENCODE_DEBUG_STREAM: Enable stream event logging
 * - OPENCODE_DEBUG_TOOLS: Enable tool call logging
 * - OPENCODE_DEBUG: Enable all debug logging
 */
export namespace DebugLog {
  let debugFile: fs.WriteStream | null = null
  let debugPath: string = ""
  let isEnabled: boolean = false
  let streamEnabled: boolean = false
  let toolsEnabled: boolean = false
  let sessionEnabled: boolean = false

  export function init(options?: { force?: boolean }) {
    // Check if debug logging should be enabled
    const debugAll = process.env["OPENCODE_DEBUG"]
    const debugSession = process.env["OPENCODE_DEBUG_SESSION"]
    const debugStream = process.env["OPENCODE_DEBUG_STREAM"]
    const debugTools = process.env["OPENCODE_DEBUG_TOOLS"]

    // Set individual flags
    sessionEnabled =
      options?.force || debugAll === "true" || debugAll === "1" || debugSession === "true" || debugSession === "1"
    streamEnabled =
      options?.force || debugAll === "true" || debugAll === "1" || debugStream === "true" || debugStream === "1"
    toolsEnabled =
      options?.force || debugAll === "true" || debugAll === "1" || debugTools === "true" || debugTools === "1"

    // Enable if any debug flag is set
    isEnabled = sessionEnabled || streamEnabled || toolsEnabled

    if (!isEnabled) {
      return null
    }

    try {
      const dir = path.join(Global.Path.data, "log")
      fs.mkdirSync(dir, { recursive: true })

      debugPath = path.join(dir, "session-debug.log")

      // Create or append to the debug log file
      debugFile = fs.createWriteStream(debugPath, { flags: "a" })

      // Write header
      debugFile.write(`\n${"=".repeat(80)}\n`)
      debugFile.write(`Session Debug Log Started: ${new Date().toISOString()}\n`)
      debugFile.write(`Debug Flags:\n`)
      debugFile.write(`  Session Errors: ${sessionEnabled}\n`)
      debugFile.write(`  Stream Events: ${streamEnabled}\n`)
      debugFile.write(`  Tool Calls: ${toolsEnabled}\n`)
      debugFile.write(`${"=".repeat(80)}\n\n`)

      console.log(`📝 Debug logging enabled: ${debugPath}`)
      if (sessionEnabled) console.log(`   ✓ Session error logging enabled`)
      if (streamEnabled) console.log(`   ✓ Stream event logging enabled`)
      if (toolsEnabled) console.log(`   ✓ Tool call logging enabled`)

      return debugPath
    } catch (error) {
      console.error("Failed to initialize debug log:", error)
      return null
    }
  }

  export function getPath(): string {
    return debugPath
  }

  export function isDebugEnabled(): boolean {
    return isEnabled
  }

  function writeLog(level: string, category: string, message: string, data?: any) {
    if (!debugFile || !isEnabled) return

    const timestamp = new Date().toISOString()

    debugFile.write(`[${timestamp}] [${level}] [${category}] ${message}\n`)
    if (data) {
      debugFile.write(`DATA: ${JSON.stringify(data, null, 2)}\n`)
    }
    debugFile.write("\n")
  }

  export function info(category: string, message: string, data?: any) {
    if (!sessionEnabled) return
    writeLog("INFO", category, message, data)
  }

  export function warn(category: string, message: string, data?: any) {
    if (!sessionEnabled) return
    writeLog("WARN", category, message, data)
  }

  export function error(category: string, message: string, data?: any) {
    if (!sessionEnabled) return
    writeLog("ERROR", category, message, data)
  }

  export function debug(category: string, message: string, data?: any) {
    if (!sessionEnabled) return
    writeLog("DEBUG", category, message, data)
  }

  export function streamEvent(event: any, providerID: string, modelID: string) {
    if (!streamEnabled) return
    writeLog("STREAM", "stream-event", `Stream event from ${providerID}/${modelID}`, {
      eventType: event?.type,
      event: event,
      provider: providerID,
      model: modelID,
    })
  }

  export function toolCall(toolData: any, providerID: string, modelID: string) {
    if (!toolsEnabled) return
    writeLog("TOOL", "tool-call", `Tool call from ${providerID}/${modelID}`, {
      toolData,
      provider: providerID,
      model: modelID,
    })
  }

  export function sessionError(error: any, providerID: string, modelID: string, context?: any) {
    if (!sessionEnabled) return
    writeLog("ERROR", "session-error", `Session error from ${providerID}/${modelID}`, {
      error:
        error instanceof Error
          ? {
              message: error.message,
              stack: error.stack,
              name: error.name,
            }
          : error,
      provider: providerID,
      model: modelID,
      context,
    })
  }

  export function close() {
    if (debugFile) {
      debugFile.write(`\nSession Debug Log Ended: ${new Date().toISOString()}\n`)
      debugFile.write(`${"=".repeat(80)}\n`)
      debugFile.end()
      debugFile = null
    }
  }
}
