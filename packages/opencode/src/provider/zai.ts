import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { Log } from "../util/log"

const log = Log.create({ service: "zai" })

export function responseTransformer(response: any) {
  if (response.choices) {
    response.choices.forEach((choice: any) => {
      if (choice.delta) {
        if (choice.delta.reasoning_content) {
          // Simply remove reasoning content from delta to avoid display issues
          // The reasoning is already logged internally
          delete choice.delta.reasoning_content
        }
        if (choice.delta.tool_calls) {
          choice.delta.tool_calls = choice.delta.tool_calls.filter((tc: any) => {
            if (tc.function && typeof tc.function.name === "string" && tc.function.name.length > 0) {
              return true
            } else {
              log.warn("Filtering out invalid tool call without name", { toolCall: tc })
              return false
            }
          })
          choice.delta.tool_calls.forEach((tc: any) => {
            if (!tc.id) {
              tc.id = `call_${Date.now()}_${Math.random().toString(36).slice(2)}`
            }
            if (!tc.type) tc.type = "function"
          })
          if (choice.delta.tool_calls.length === 0) {
            delete choice.delta.tool_calls
          }
        }
      } else if (choice.message) {
        if (choice.message.reasoning_content) {
          // For non-streaming responses, also just remove reasoning content
          // to avoid display issues - it's logged internally
          delete choice.message.reasoning_content
        }
        if (choice.message.tool_calls) {
          choice.message.tool_calls = choice.message.tool_calls.filter((tc: any) => {
            if (tc.function && typeof tc.function.name === "string" && tc.function.name.length > 0) {
              return true
            } else {
              log.warn("Filtering out invalid tool call without name", { toolCall: tc })
              return false
            }
          })

          if (choice.message.tool_calls.length === 0) {
            delete choice.message.tool_calls
          }
        }
      }
    })
  }
  return response
}

export function requestTransformer(body: string): string {
  if (!body || body.trim() === "") {
    throw new Error("Empty request body provided to requestTransformer")
  }

  try {
    const bodyObj = JSON.parse(body)
    bodyObj.thinking = { type: "enabled" }
    return JSON.stringify(bodyObj)
  } catch (error) {
    log.error("Failed to parse request body as JSON", {
      body: body.substring(0, 500), // Log first 500 chars to avoid huge logs
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

export const glm45Fetch = async (input: RequestInfo, init?: RequestInit): Promise<Response> => {
  if (init && init.body) {
    init.body = requestTransformer(init.body as string)
  }

  const response = await fetch(input, init)

  if (!response.ok) return response

  const contentType = response.headers.get("content-type")

  if (contentType?.includes("application/json")) {
    let json
    try {
      const text = await response.text()
      if (!text || text.trim() === "") {
        throw new Error("Empty response from API")
      }
      json = JSON.parse(text)
    } catch (error) {
      // Create a proper error response that the AI SDK can handle
      const errorMessage = error instanceof Error ? error.message : String(error)
      const errorResponse = {
        error: {
          message: `Failed to parse JSON response: ${errorMessage}`,
          type: "invalid_json_response",
          param: null,
          code: null,
        },
      }
      return new Response(JSON.stringify(errorResponse), {
        status: 400,
        statusText: "Bad Request",
        headers: response.headers,
      })
    }

    const transformed = responseTransformer(json)
    return new Response(JSON.stringify(transformed), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  } else if (contentType?.includes("text/event-stream")) {
    if (!response.body) return response

    // Buffer for incomplete JSON objects that span multiple chunks
    let incompleteData = ""

    const transformer = new TransformStream({
      async transform(chunk, controller) {
        const text = new TextDecoder().decode(chunk)
        const lines = text.split("\n")

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]

          // Handle SSE data lines
          if (line.startsWith("data: ")) {
            const data = line.slice(6)

            // Handle [DONE] signal
            if (data === "[DONE]") {
              // Clear any incomplete data buffer
              incompleteData = ""
              controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"))
              continue
            }

            // Try to parse the JSON, handling multi-line objects
            let jsonStr = incompleteData + data
            incompleteData = "" // Reset buffer

            try {
              if (!jsonStr || jsonStr.trim() === "") {
                continue
              }

              const json = JSON.parse(jsonStr)
              const transformed = responseTransformer(json)
              controller.enqueue(new TextEncoder().encode("data: " + JSON.stringify(transformed) + "\n\n"))
            } catch (e) {
              // Check if this might be a complete but invalid JSON rather than incomplete
              if (jsonStr && jsonStr.trim().length > 0 && jsonStr.includes("{")) {
                // Create error response for invalid JSON
                const errorResponse = {
                  error: {
                    message: `Failed to parse streaming JSON response`,
                    type: "invalid_json_response",
                    param: null,
                    code: null,
                  },
                }
                controller.enqueue(new TextEncoder().encode("data: " + JSON.stringify(errorResponse) + "\n\n"))
              } else {
                // JSON is incomplete, buffer it for the next chunk
                incompleteData = jsonStr
              }
            }
          } else if (line === "" && incompleteData) {
            // Empty line after incomplete data might mean we should try parsing again
            try {
              const json = JSON.parse(incompleteData)
              const transformed = responseTransformer(json)
              controller.enqueue(new TextEncoder().encode("data: " + JSON.stringify(transformed) + "\n\n"))
              incompleteData = ""
            } catch (e) {
              // Still incomplete, keep buffering
            }
          } else if (incompleteData && line.trim()) {
            // If we have incomplete data and this line doesn't start with "data:",
            // it might be a continuation of the JSON
            incompleteData += line

            // Try to parse the accumulated data
            try {
              const json = JSON.parse(incompleteData)
              const transformed = responseTransformer(json)
              controller.enqueue(new TextEncoder().encode("data: " + JSON.stringify(transformed) + "\n\n"))
              incompleteData = ""
            } catch (e) {
              // Still incomplete, keep buffering
            }
          } else if (line === "") {
            // Pass through empty lines when not buffering
            controller.enqueue(new TextEncoder().encode("\n"))
          } else if (!line.startsWith("data: ")) {
            // Pass through non-data lines (like event: lines)
            controller.enqueue(new TextEncoder().encode(line + "\n"))
          }
        }
      },

      flush(controller) {
        // Handle any remaining incomplete data at the end of the stream
        if (incompleteData) {
          try {
            const json = JSON.parse(incompleteData)
            const transformed = responseTransformer(json)
            controller.enqueue(new TextEncoder().encode("data: " + JSON.stringify(transformed) + "\n\n"))
          } catch (e) {
            // Create error response for incomplete JSON at end of stream
            const errorResponse = {
              error: {
                message: "Incomplete JSON response received",
                type: "incomplete_json_response",
                param: null,
                code: null,
              },
            }
            controller.enqueue(new TextEncoder().encode("data: " + JSON.stringify(errorResponse) + "\n\n"))
          }
        }
      },
    })

    const transformedBody = response.body.pipeThrough(transformer)
    return new Response(transformedBody, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  }
  return response
}

export function createZaiProvider(options: { apiKey: string; baseURL?: string } = { apiKey: "" }) {
  const baseURL = options.baseURL || "https://api.z.ai/api/paas/v4"

  return createOpenAICompatible({
    name: "zai",
    baseURL,
    apiKey: options.apiKey,
    fetch: glm45Fetch as any, // Suppress type error for Bun if needed
  })
}
