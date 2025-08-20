import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { Log } from "../util/log"

const log = Log.create({ service: "zai" })

export function responseTransformer(response: any) {
  if (response.choices) {
    response.choices.forEach((choice: any) => {
      if (choice.delta) {
        if (choice.delta.tool_calls) {
          choice.delta.tool_calls = (choice.delta.tool_calls || []).map((tc: any) => {
            // Lenient fixes: Convert numeric IDs to strings, assign default name if missing
            if (typeof tc.id === "number") {
              tc.id = String(tc.id);
              log.info("Converted numeric tool ID to string", { originalId: tc.id });
            }
            if (!tc.function || typeof tc.function.name !== "string" || tc.function.name.length === 0) {
              tc.function = tc.function || {};
              tc.function.name = tc.function.name || "unknown_tool"; // Default name to preserve call
              log.warn("Assigned default name to invalid tool call", { toolCall: tc });
              choice.delta.content = (choice.delta.content || "") + "\n\n[TOOL WARNING]: Fixed invalid tool call (used default name 'unknown_tool').";
            }
            if (!tc.type) tc.type = "function";
            return tc;
          }).filter((tc: any) => tc.function.name.length > 0); // Only drop if still invalid after fixes

          if (choice.delta.tool_calls.length > 0) {
            choice.delta.tool_calls.forEach((tc: any) => {
              if (!tc.id) {
                tc.id = `call_${Date.now()}_${Math.random().toString(36).slice(2)}`
              }
              if (!tc.type) tc.type = "function"
            })
          } else {
            delete choice.delta.tool_calls;
          }
        }
      } else if (choice.message) {
        if (choice.message.tool_calls) {
          choice.message.tool_calls = choice.message.tool_calls.filter((tc: any) => {
            if (tc.function && typeof tc.function.name === "string" && tc.function.name.length > 0) {
              return true
            } else {
              log.warn("Filtering out invalid tool call without name", { toolCall: tc })
              // Propagate as error content instead of silent drop
              choice.message.content =
                (choice.message.content || "") + "\n\n[TOOL ERROR]: Invalid tool call detected (missing name)."
              return false
            }
          })

          if (choice.message.tool_calls.length === 0 && !choice.message.content.includes("[TOOL ERROR]")) {
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
    // Safely add detailed tool reminder to system prompt with list of available tools
    try {
      if (Array.isArray(bodyObj.messages) && bodyObj.messages.length > 0 && bodyObj.messages[0].role === "system" && typeof bodyObj.messages[0].content === "string") {
        const toolList = bodyObj.tools ? Object.keys(bodyObj.tools).join(", ") : "various tools";
        bodyObj.messages[0].content += `\n\nAvailable tools: ${toolList}. Remember to use them in your reasoning chain if relevant, specifying name and parameters clearly.`;
        log.info("Injected tool reminder into system prompt", { toolList });
      } else {
        log.debug("Skipped tool reminder injection - no valid system message found");
      }
    } catch (reminderError: any) {
      log.warn("Failed to inject tool reminder", { error: reminderError.message || String(reminderError) });
    }
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

  try {
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

      // Format for non-streaming
      if (json.choices) {
        json.choices.forEach((choice: any) => {
          if (choice.message && choice.message.reasoning_content) {
            choice.message.content =
              "\n\n### Thinking Process\n" +
              choice.message.reasoning_content +
              "\n\n### Response\n" +
              (choice.message.content || "")
            delete choice.message.reasoning_content
          }
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

      let incompleteData = ""
      let reasoningHeaderAdded = false
      let responseHeaderAdded = false

      const transformer = new TransformStream({
        async transform(chunk, controller) {
          const text = new TextDecoder().decode(chunk)
          const lines = text.split("\n")

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i]

            if (line.startsWith("data: ")) {
              const data = line.slice(6)

              if (data === "[DONE]") {
                incompleteData = ""
                controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"))
                continue
              }

              let jsonStr = incompleteData + data
              incompleteData = ""

              try {
                if (!jsonStr || jsonStr.trim() === "") {
                  continue
                }

                const json = JSON.parse(jsonStr)

                // Format reasoning for streaming and scan for potential tool mentions
                if (json.choices) {
                  json.choices.forEach((choice: any) => {
                    if (choice.delta && choice.delta.reasoning_content) {
                      let contentAddition = choice.delta.reasoning_content
                      // Basic scan for tool-like patterns in reasoning (e.g., "use tool X")
                      const toolMentionMatch = contentAddition.match(/use tool (\w+)/i)
                      if (toolMentionMatch) {
                        contentAddition += `\n[TOOL REMINDER]: Tool "${toolMentionMatch[1]}" is available - ensure valid call format.`
                      }
                      if (!reasoningHeaderAdded) {
                        contentAddition = "\n\n### Thinking Process\n" + contentAddition
                        reasoningHeaderAdded = true
                      }
                      choice.delta.content = (choice.delta.content || "") + contentAddition
                      delete choice.delta.reasoning_content
                    } else if (reasoningHeaderAdded && choice.delta && choice.delta.content && !responseHeaderAdded) {
                      choice.delta.content = "\n\n### Response\n" + (choice.delta.content || "")
                      responseHeaderAdded = true
                    }
                  })
                }

                const transformed = responseTransformer(json)
                controller.enqueue(new TextEncoder().encode("data: " + JSON.stringify(transformed) + "\n\n"))
              } catch (e) {
                log.error("Error in streaming transform", {
                  error: e instanceof Error ? e.message : String(e),
                  jsonStr,
                })
                if (jsonStr && jsonStr.trim().length > 0 && jsonStr.includes("{")) {
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
                  incompleteData = jsonStr
                }
              }
            } else if (line === "" && incompleteData) {
              try {
                const json = JSON.parse(incompleteData)
                // Same formatting as above
                if (json.choices) {
                  json.choices.forEach((choice: any) => {
                    if (choice.delta && choice.delta.reasoning_content) {
                      let contentAddition = choice.delta.reasoning_content
                      if (!reasoningHeaderAdded) {
                        contentAddition = "\n\n### Thinking Process\n" + contentAddition
                        reasoningHeaderAdded = true
                      }
                      choice.delta.content = (choice.delta.content || "") + contentAddition
                      delete choice.delta.reasoning_content
                    } else if (reasoningHeaderAdded && choice.delta && choice.delta.content && !responseHeaderAdded) {
                      choice.delta.content = "\n\n### Response\n" + (choice.delta.content || "")
                      responseHeaderAdded = true
                    }
                  })
                }
                const transformed = responseTransformer(json)
                controller.enqueue(new TextEncoder().encode("data: " + JSON.stringify(transformed) + "\n\n"))
                incompleteData = ""
              } catch (e) {
                log.error("Error in streaming empty line handler", {
                  error: e instanceof Error ? e.message : String(e),
                  incompleteData,
                })
                // Still incomplete
              }
            } else if (incompleteData && line.trim()) {
              incompleteData += line
              try {
                const json = JSON.parse(incompleteData)
                // Same formatting
                if (json.choices) {
                  json.choices.forEach((choice: any) => {
                    if (choice.delta && choice.delta.reasoning_content) {
                      let contentAddition = choice.delta.reasoning_content
                      if (!reasoningHeaderAdded) {
                        contentAddition = "\n\n### Thinking Process\n" + contentAddition
                        reasoningHeaderAdded = true
                      }
                      choice.delta.content = (choice.delta.content || "") + contentAddition
                      delete choice.delta.reasoning_content
                    } else if (reasoningHeaderAdded && choice.delta && choice.delta.content && !responseHeaderAdded) {
                      choice.delta.content = "\n\n### Response\n" + (choice.delta.content || "")
                      responseHeaderAdded = true
                    }
                  })
                }
                const transformed = responseTransformer(json)
                controller.enqueue(new TextEncoder().encode("data: " + JSON.stringify(transformed) + "\n\n"))
                incompleteData = ""
              } catch (e) {
                log.error("Error in streaming incomplete data handler", {
                  error: e instanceof Error ? e.message : String(e),
                  incompleteData,
                })
                // Still incomplete
              }
            } else if (line === "") {
              controller.enqueue(new TextEncoder().encode("\n"))
            } else if (!line.startsWith("data: ")) {
              controller.enqueue(new TextEncoder().encode(line + "\n"))
            }
          }
        },

        flush(controller) {
          if (incompleteData) {
            try {
              const json = JSON.parse(incompleteData)
              // Same formatting in flush
              if (json.choices) {
                json.choices.forEach((choice: any) => {
                  if (choice.delta && choice.delta.reasoning_content) {
                    let contentAddition = choice.delta.reasoning_content
                    if (!reasoningHeaderAdded) {
                      contentAddition = "\n\n### Thinking Process\n" + contentAddition
                      reasoningHeaderAdded = true
                    }
                    choice.delta.content = (choice.delta.content || "") + contentAddition
                    delete choice.delta.reasoning_content
                  } else if (reasoningHeaderAdded && choice.delta && choice.delta.content && !responseHeaderAdded) {
                    choice.delta.content = "\n\n### Response\n" + (choice.delta.content || "")
                    responseHeaderAdded = true
                  }
                })
              }
              const transformed = responseTransformer(json)
              controller.enqueue(new TextEncoder().encode("data: " + JSON.stringify(transformed) + "\n\n"))
            } catch (e) {
              log.error("Error in streaming flush", {
                error: e instanceof Error ? e.message : String(e),
                incompleteData,
              })
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
  } catch (error) {
    log.error("Error in glm45Fetch", { error: error instanceof Error ? error.message : String(error) })
    return new Response(JSON.stringify({ error: "Internal error" }), { status: 500 })
  }
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
