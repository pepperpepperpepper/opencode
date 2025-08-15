import { Global } from "../global"
import { Installation } from "../installation"
import path from "path"
import fs from "fs"

export namespace Trace {
  let logStream: fs.WriteStream | null = null

  export function init() {
    if (!Installation.isDev()) return
    const logPath = path.join(Global.Path.data, "log", "fetch.log")

    // Ensure log directory exists synchronously
    try {
      fs.mkdirSync(path.dirname(logPath), { recursive: true })
    } catch (e) {
      // Directory might already exist
    }

    // Create a write stream for appending plain text with proper encoding
    logStream = fs.createWriteStream(logPath, {
      flags: "a",
      encoding: "utf8",
    })

    const originalFetch = globalThis.fetch
    // @ts-expect-error
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
      const method = init?.method || "GET"

      const urlObj = new URL(url)

      // Write request with actual newlines
      if (logStream) {
        logStream.write("\n" + method + " " + urlObj.pathname + urlObj.search + " HTTP/1.1\n")
        logStream.write("Host: " + urlObj.host + "\n")

        if (init?.headers) {
          if (init.headers instanceof Headers) {
            init.headers.forEach((value, key) => {
              logStream!.write(key + ": " + value + "\n")
            })
          } else {
            for (const [key, value] of Object.entries(init.headers)) {
              logStream!.write(key + ": " + value + "\n")
            }
          }
        }

        if (init?.body) {
          logStream.write("\n")

          let bodyText = ""
          if (typeof init.body === "string") {
            bodyText = init.body
          } else {
            try {
              bodyText = JSON.stringify(init.body, null, 2)
            } catch {
              bodyText = String(init.body)
            }
          }

          // Process the body text to handle escaped newlines
          bodyText = bodyText.replace(/\\n/g, "\n")

          logStream.write(bodyText)
          logStream.write("\n")
        }
      }

      const response = await originalFetch(input, init)
      const clonedResponse = response.clone()

      // Write response with actual newlines
      if (logStream) {
        logStream.write("\nHTTP/1.1 " + response.status + " " + response.statusText + "\n")

        response.headers.forEach((value, key) => {
          logStream!.write(key + ": " + value + "\n")
        })
      }

      if (clonedResponse.body && logStream) {
        clonedResponse
          .text()
          .then((responseText) => {
            if (logStream) {
              logStream.write("\n")

              // Handle escaped newlines
              let processedText = responseText

              // If it's JSON, try to pretty print it
              try {
                const parsed = JSON.parse(responseText)
                processedText = JSON.stringify(parsed, null, 2)
              } catch {
                // Not JSON, but still process the text
                // Replace literal \n with actual newlines
                processedText = responseText.replace(/\\n/g, "\n")
              }

              logStream.write(processedText)
              logStream.write("\n")
            }
          })
          .catch(() => {})
      }

      return response
    }
  }
}
