import { Log } from "../util/log"

const log = Log.create({ service: "zai" })

export function responseTransformer(response: any, availableTools?: string[]) {
  const toolList = availableTools ? availableTools.filter(Boolean).join(", ") : "unknown"

  if (response.choices) {
    response.choices.forEach((choice: any) => {
      if (choice.delta) {
        if (choice.delta.tool_calls) {
          const validCalls: any[] = []
          const invalidCalls: any[] = []

          choice.delta.tool_calls.forEach((tc: any) => {
            // Convert numeric IDs to strings
            if (typeof tc.id === "number") {
              tc.id = String(tc.id)
              log.info("Converted numeric tool ID to string", { originalId: tc.id })
            }
            if (!tc.type) tc.type = "function"

            // Handle GLM model's malformed tool calls - missing function.name but has function.arguments
            if (tc.function && !tc.function.name && tc.function.arguments) {
              // Try to infer tool name from arguments or context
              try {
                const args = JSON.parse(tc.function.arguments)
                // Look for common patterns in arguments that might indicate the tool
                if (args.command || args.cmd) {
                  tc.function.name = "bash"
                  log.info("Inferred tool name 'bash' from arguments", { arguments: tc.function.arguments })
                } else if (args.path || args.pattern || args.query) {
                  tc.function.name = "text_search"
                  log.info("Inferred tool name 'text_search' from arguments", { arguments: tc.function.arguments })
                } else if (args.content || args.file_path) {
                  tc.function.name = "write"
                  log.info("Inferred tool name 'write' from arguments", { arguments: tc.function.arguments })
                } else {
                  // Default to bash for empty args as it's the most common tool
                  tc.function.name = "bash"
                  tc.function.arguments = JSON.stringify({ command: "echo 'Please specify a valid command'" })
                  log.info("Set default tool name 'bash' for empty arguments")
                }
              } catch (e) {
                // If arguments aren't valid JSON, default to bash
                tc.function.name = "bash"
                tc.function.arguments = JSON.stringify({ command: "echo 'Please specify a valid command'" })
                log.warn("Failed to parse arguments, defaulting to bash", {
                  error: e instanceof Error ? e.message : String(e),
                })
              }
            }

            // Validate function name exists and is a string
            if (!tc.function || typeof tc.function.name !== "string" || tc.function.name.trim() === "") {
              invalidCalls.push(tc)
              log.warn("Invalid tool call - missing or invalid function name", { toolCall: tc })
            } else {
              validCalls.push(tc)
            }
          })

          choice.delta.tool_calls = validCalls

          // Add error message to content for invalid calls
          if (invalidCalls.length > 0) {
            const errorMsg = `\n\nError: Invalid tool calls detected (${invalidCalls.length}). Please use valid tool names from: ${toolList}. Try rephrasing your request without tool calls.`
            choice.delta.content = (choice.delta.content || "") + errorMsg
          }

          if (choice.delta.tool_calls.length > 0) {
            choice.delta.tool_calls.forEach((tc: any) => {
              if (!tc.id) {
                tc.id = `call_${Date.now()}_${Math.random().toString(36).slice(2)}`
              }
              if (!tc.type) tc.type = "function"
            })
          } else {
            delete choice.delta.tool_calls
          }
        }
      } else if (choice.message) {
        if (choice.message.tool_calls) {
          const validCalls: any[] = []
          const invalidCalls: any[] = []

          choice.message.tool_calls.forEach((tc: any) => {
            if (!tc.type) tc.type = "function"

            // Handle GLM model's malformed tool calls - missing function.name but has function.arguments
            if (tc.function && !tc.function.name && tc.function.arguments) {
              // Try to infer tool name from arguments or context
              try {
                const args = JSON.parse(tc.function.arguments)
                // Look for common patterns in arguments that might indicate the tool
                if (args.command || args.cmd) {
                  tc.function.name = "bash"
                  log.info("Inferred tool name 'bash' from message arguments", { arguments: tc.function.arguments })
                } else if (args.path || args.pattern || args.query) {
                  tc.function.name = "text_search"
                  log.info("Inferred tool name 'text_search' from message arguments", {
                    arguments: tc.function.arguments,
                  })
                } else if (args.content || args.file_path) {
                  tc.function.name = "write"
                  log.info("Inferred tool name 'write' from message arguments", { arguments: tc.function.arguments })
                } else {
                  // Default to bash for empty args as it's the most common tool
                  tc.function.name = "bash"
                  tc.function.arguments = JSON.stringify({ command: "echo 'Please specify a valid command'" })
                  log.info("Set default tool name 'bash' for empty message arguments")
                }
              } catch (e) {
                // If arguments aren't valid JSON, default to bash
                tc.function.name = "bash"
                tc.function.arguments = JSON.stringify({ command: "echo 'Please specify a valid command'" })
                log.warn("Failed to parse message arguments, defaulting to bash", {
                  error: e instanceof Error ? e.message : String(e),
                })
              }
            }

            // Validate function name exists and is a string
            if (!tc.function || typeof tc.function.name !== "string" || tc.function.name.trim() === "") {
              invalidCalls.push(tc)
              log.warn("Invalid tool call in message - missing or invalid function name", { toolCall: tc })
            } else {
              validCalls.push(tc)
            }
          })

          choice.message.tool_calls = validCalls

          // Add error message to content for invalid calls
          if (invalidCalls.length > 0) {
            const errorMsg = `\n\nError: Invalid tool calls detected (${invalidCalls.length}). Please use valid tool names from: ${toolList}. Try rephrasing your request without tool calls.`
            choice.message.content = (choice.message.content || "") + errorMsg
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
      const messagesArray = Array.isArray(bodyObj.messages) ? bodyObj.messages : []
      const systemCandidate = messagesArray.length > 0 ? messagesArray[0] : undefined
      const hasSystemMessage =
        systemCandidate && systemCandidate.role === "system" && typeof systemCandidate.content === "string"
      if (!hasSystemMessage) {
        log.debug("Skipped tool reminder injection - no valid system message found")
      }
      if (hasSystemMessage) {
        const toolNames = Array.isArray(bodyObj.tools)
          ? bodyObj.tools.map((t: any) => t.function?.name).filter(Boolean)
          : []
        const hasTools = toolNames.length > 0
        if (hasTools) {
          const toolList = toolNames.join(", ")
          systemCandidate.content += `\n\nAvailable tools: ${toolList}. When you need to use a tool, call it using the standard OpenAI tool call format. Always specify the exact tool name from the available tools list. Example: to list files, use the "bash" tool with command "ls".`
          log.info("Injected tool reminder into system prompt", { toolList })
        }
        if (!hasTools) {
          systemCandidate.content += "\n\nNo tools are available for this request. Respond directly without calling tools."
          bodyObj.tool_choice = "none"
          log.info("Injected no-tool reminder into system prompt")
        }
      }
    } catch (reminderError: any) {
      log.warn("Failed to inject tool reminder", { error: reminderError.message || String(reminderError) })
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
  let availableTools: string[] | undefined

  if (init && init.body) {
    const bodyStr = init.body as string
    try {
      const bodyObj = JSON.parse(bodyStr)
      availableTools = bodyObj.tools ? bodyObj.tools.map((t: any) => t.function?.name).filter(Boolean) : undefined
    } catch (parseError) {
      log.warn("Failed to parse request body for tool extraction", {
        error: parseError instanceof Error ? parseError.message : String(parseError),
      })
    }
    init.body = requestTransformer(bodyStr)
  }

  try {
    const response = await fetch(input, init)

    if (!response.ok) return response

    const contentType = response.headers.get("content-type")

    if (contentType?.includes("application/json")) {
      let json
      let text: string | undefined
      try {
        text = await response.text()
        if (!text || text.trim() === "") {
          throw new Error("Empty response from API")
        }
        json = JSON.parse(text)
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        log.error("Failed to parse non-streaming JSON", { error: errorMessage, text: text?.substring(0, 500) })
        const errorResponse = {
          choices: [
            {
              message: {
                role: "assistant",
                content: `\n\n[RESPONSE ERROR]: Failed to parse JSON: ${errorMessage}. Raw text: ${text?.substring(0, 200) || "empty"}`,
              },
              finish_reason: "error",
            },
          ],
        }
        return new Response(JSON.stringify(errorResponse), {
          status: response.status,
          statusText: response.statusText,
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

      const transformed = responseTransformer(json, availableTools)
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
        transform(chunk, controller) {
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

              // Only try to parse if we have what looks like a complete JSON object
              if (!jsonStr || jsonStr.trim() === "") {
                continue
              }

              // Try parsing directly - if it fails, it's incomplete
              let isComplete = true
              try {
                JSON.parse(jsonStr)
              } catch {
                isComplete = false
              }

              if (!isComplete) {
                // Incomplete JSON, save for next chunk
                incompleteData = jsonStr
                continue
              }

              try {
                const json = JSON.parse(jsonStr)

                // Format reasoning for streaming and scan for potential tool mentions
                if (json.choices) {
                  json.choices.forEach((choice: any) => {
                    if (choice.delta && choice.delta.reasoning_content) {
                      let contentAddition = choice.delta.reasoning_content
                      // Basic scan for tool-like patterns in reasoning (e.g., "use tool X")
                      const toolMentionMatch = contentAddition.match(/use tool (\w+)/i)
                      if (toolMentionMatch) {
                        const mentionedTool = toolMentionMatch[1]
                        const isValid = availableTools?.includes(mentionedTool) ?? false
                        const toolList = availableTools?.join(", ") ?? "unknown"
                        contentAddition += `\n[TOOL REMINDER]: Tool "${mentionedTool}" ${isValid ? "is" : "is NOT"} available. Full list: ${toolList}. Ensure exact name and format when calling.`
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

                const transformed = responseTransformer(json, availableTools)
                controller.enqueue(new TextEncoder().encode("data: " + JSON.stringify(transformed) + "\n\n"))
              } catch (e) {
                // If JSON parsing fails even though braces look balanced, save for next chunk
                // This handles cases where strings contain braces or other edge cases
                log.debug("JSON parse failed, buffering for next chunk", {
                  error: e instanceof Error ? e.message : String(e),
                  jsonLength: jsonStr.length,
                })
                incompleteData = jsonStr
              }
            } else if (line === "" && incompleteData) {
              // Try parsing incomplete data to see if it's now complete
              let isDataComplete = true
              try {
                JSON.parse(incompleteData)
              } catch {
                isDataComplete = false
              }

              if (!isDataComplete) {
                // Still incomplete, keep waiting
                continue
              }

              try {
                const json = JSON.parse(incompleteData)
                // Same formatting and scanning as above
                if (json.choices) {
                  json.choices.forEach((choice: any) => {
                    if (choice.delta && choice.delta.reasoning_content) {
                      let contentAddition = choice.delta.reasoning_content
                      const toolMentionMatch = contentAddition.match(/use tool (\w+)/i)
                      if (toolMentionMatch) {
                        const mentionedTool = toolMentionMatch[1]
                        const isValid = availableTools?.includes(mentionedTool) ?? false
                        const toolList = availableTools?.join(", ") ?? "unknown"
                        contentAddition += `\n[TOOL REMINDER]: Tool "${mentionedTool}" ${isValid ? "is" : "is NOT"} available. Full list: ${toolList}. Ensure exact name and format when calling.`
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
                const transformed = responseTransformer(json, availableTools)
                controller.enqueue(new TextEncoder().encode("data: " + JSON.stringify(transformed) + "\n\n"))
                incompleteData = ""
              } catch (e) {
                log.debug("JSON parse failed on empty line, continuing to buffer", {
                  error: e instanceof Error ? e.message : String(e),
                  dataLength: incompleteData.length,
                })
                // Keep the incomplete data for the next attempt
              }
            } else if (incompleteData && line.trim()) {
              incompleteData += line

              // Check if we now have complete JSON
              let isAccumComplete = true
              try {
                JSON.parse(incompleteData)
              } catch {
                isAccumComplete = false
              }

              if (!isAccumComplete) {
                // Still incomplete, continue accumulating
                continue
              }

              try {
                const json = JSON.parse(incompleteData)
                // Same formatting and scanning
                if (json.choices) {
                  json.choices.forEach((choice: any) => {
                    if (choice.delta && choice.delta.reasoning_content) {
                      let contentAddition = choice.delta.reasoning_content
                      const toolMentionMatch = contentAddition.match(/use tool (\w+)/i)
                      if (toolMentionMatch) {
                        const mentionedTool = toolMentionMatch[1]
                        const isValid = availableTools?.includes(mentionedTool) ?? false
                        const toolList = availableTools?.join(", ") ?? "unknown"
                        contentAddition += `\n[TOOL REMINDER]: Tool "${mentionedTool}" ${isValid ? "is" : "is NOT"} available. Full list: ${toolList}. Ensure exact name and format when calling.`
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
                const transformed = responseTransformer(json, availableTools)
                controller.enqueue(new TextEncoder().encode("data: " + JSON.stringify(transformed) + "\n\n"))
                incompleteData = ""
              } catch (e) {
                log.debug("JSON parse failed while accumulating, continuing to buffer", {
                  error: e instanceof Error ? e.message : String(e),
                  dataLength: incompleteData.length,
                })
                // Keep accumulating data for next attempt
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
            // Final attempt - try parsing any remaining incomplete data
            let isFinalComplete = true
            try {
              JSON.parse(incompleteData)
            } catch {
              isFinalComplete = false
            }

            if (!isFinalComplete) {
              log.warn("Incomplete JSON data at stream end", {
                dataLength: incompleteData.length,
                data: incompleteData.substring(0, 100),
              })
              // Send a final error message
              const errorDelta = {
                choices: [
                  {
                    delta: {
                      content: `\n\n[STREAM WARNING]: Incomplete data at stream end`,
                    },
                    index: 0,
                    finish_reason: "error",
                  },
                ],
              }
              controller.enqueue(new TextEncoder().encode("data: " + JSON.stringify(errorDelta) + "\n\n"))
              controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"))
              return
            }

            try {
              const json = JSON.parse(incompleteData)
              // Same formatting and scanning in flush
              if (json.choices) {
                json.choices.forEach((choice: any) => {
                  if (choice.delta && choice.delta.reasoning_content) {
                    let contentAddition = choice.delta.reasoning_content
                    const toolMentionMatch = contentAddition.match(/use tool (\w+)/i)
                    if (toolMentionMatch) {
                      const mentionedTool = toolMentionMatch[1]
                      const isValid = availableTools?.includes(mentionedTool) ?? false
                      const toolList = availableTools?.join(", ") ?? "unknown"
                      contentAddition += `\n[TOOL REMINDER]: Tool "${mentionedTool}" ${isValid ? "is" : "is NOT"} available. Full list: ${toolList}. Ensure exact name and format when calling.`
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
              const transformed = responseTransformer(json, availableTools)
              controller.enqueue(new TextEncoder().encode("data: " + JSON.stringify(transformed) + "\n\n"))
            } catch (e) {
              log.error("Failed to parse final JSON in flush", {
                error: e instanceof Error ? e.message : String(e),
                dataLength: incompleteData.length,
              })
              const errorDelta = {
                choices: [
                  {
                    delta: {
                      content: `\n\n[STREAM ERROR]: Failed to parse final JSON`,
                    },
                    index: 0,
                    finish_reason: "error",
                  },
                ],
              }
              controller.enqueue(new TextEncoder().encode("data: " + JSON.stringify(errorDelta) + "\n\n"))
              controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"))
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
    log.error("GLM45 fetch error", {
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}
