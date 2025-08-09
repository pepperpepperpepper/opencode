import { Storage } from "../storage/storage"
import { Log } from "../util/log"

const log = Log.create({ service: "session-recovery" })

export namespace SessionRecovery {
  export async function validateAndRepairSession(sessionID: string): Promise<boolean> {
    try {
      // Check if session info exists and is valid
      const sessionInfo = await Storage.readJSON<any>(`session/info/${sessionID}`)
      if (!sessionInfo || !sessionInfo.id) {
        log.warn(`Invalid session info for ${sessionID}, removing`)
        await Storage.remove(`session/info/${sessionID}`)
        return false
      }

      // Check if messages directory exists and has valid content
      try {
        const messages = await Storage.list(`session/message/${sessionID}`)
        for (const messagePath of messages) {
          const message = await Storage.readJSON<any>(messagePath)
          if (!message || !message.id) {
            log.warn(`Invalid message ${messagePath}, removing`)
            // Remove the .json extension for the remove function
            const cleanPath = messagePath.replace(/\.json$/, "")
            await Storage.remove(cleanPath)
          }
        }
      } catch (error) {
        log.warn(`Failed to validate messages for session ${sessionID}:`, { error })
      }

      return true
    } catch (error) {
      log.error(`Failed to validate session ${sessionID}:`, { error })
      return false
    }
  }

  export async function cleanupCorruptedSessions(): Promise<number> {
    const sessions = await Storage.list("session/info")
    let repairedCount = 0

    for (const sessionPath of sessions) {
      const sessionID = sessionPath.split("/").pop()?.replace(".json", "")
      if (sessionID) {
        const isValid = await validateAndRepairSession(sessionID)
        if (!isValid) {
          repairedCount++
        }
      }
    }

    log.info(`Session recovery completed, repaired ${repairedCount} sessions`)
    return repairedCount
  }

  export async function getProblematicSessions(): Promise<string[]> {
    const sessions = await Storage.list("session/info")
    const problematic: string[] = []

    for (const sessionPath of sessions) {
      const sessionID = sessionPath.split("/").pop()?.replace(".json", "")
      if (sessionID) {
        const isValid = await validateAndRepairSession(sessionID)
        if (!isValid) {
          problematic.push(sessionID)
        }
      }
    }

    return problematic
  }
}
