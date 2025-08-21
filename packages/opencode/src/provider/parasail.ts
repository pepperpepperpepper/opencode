import { Log } from "../util/log"

const log = Log.create({ service: "parasail" })

function transformStreamingData(text: string, availableTools: string[] | undefined): string {
  const toolList = availableTools ? availableTools.filter(Boolean).join(", ") : "unknown"
  
  log.debug("transformStreamingData called", { textLength: text.length, toolCount: availableTools?.length, toolList })
  // Process each line of streaming data
  const lines = text.split('\n')
  log.debug("Split text into lines", { lineCount: lines.length })
  const transformedLines: string[] = []
  
  for (const line of lines) {
    log.debug("Processing line in transformStreamingData", { linePreview: line.substring(0, 50), startsWithData: line.startsWith('data: ') })
    if (line.startsWith('data: ') && !line.includes('[DONE]')) {
      const dataStr = line.slice(6)
      try {
        const json = JSON.parse(dataStr)
        const transformed = responseTransformer(json, availableTools)
        transformedLines.push('data: ' + JSON.stringify(transformed))
      } catch (e) {
        log.warn("JSON parse failed in transformStreamingData", { error: e instanceof Error ? e.message : String(e), dataPreview: dataStr.substring(0, 100) })
        // If parsing fails, keep the original line
        transformedLines.push(line)
      }
    } else {
      transformedLines.push(line)
    }
  }
  
  return transformedLines.join('\n')
}

export async function handleStreamingResponse(response: Response, isGlmModel: boolean, availableTools: string[] | undefined): Promise<Response> {
  if (!response.body) return response

  let incompleteData = ""

  const transformer = new TransformStream({
    transform(chunk, controller) {
      const text = new TextDecoder().decode(chunk)
      const lines = text.split("\\n")

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]

        if (line.startsWith("data: ")) {
          const data = line.slice(6)

          if (data === "[DONE]") {
            incompleteData = ""
            controller.enqueue(new TextEncoder().encode("data: [DONE]\\n\\n"))
            continue
          }

          let jsonStr = incompleteData + data
          incompleteData = ""

          if (!jsonStr || jsonStr.trim() === "") {
            continue
          }

          let isComplete = true
          try {
            JSON.parse(jsonStr)
          } catch {
            isComplete = false
          }
          
          if (!isComplete) {
            incompleteData = jsonStr
            continue
          }

          try {
            const json = JSON.parse(jsonStr)
            const transformed = isGlmModel ? responseTransformer(json, availableTools) : json
            controller.enqueue(new TextEncoder().encode("data: " + JSON.stringify(transformed) + "\\n\\n"))
          } catch (e) {
            log.debug("JSON parse failed, buffering for next chunk", {
              error: e instanceof Error ? e.message : String(e),
              jsonLength: jsonStr.length,
            })
            incompleteData = jsonStr
          }
        } else if (line === "" && incompleteData) {
          let isDataComplete = true
          try {
            JSON.parse(incompleteData)
          } catch {
            isDataComplete = false
          }
          
          if (!isDataComplete) {
            continue
          }
          
          try {
            const json = JSON.parse(incompleteData)
            const transformed = isGlmModel ? responseTransformer(json, availableTools) : json
            controller.enqueue(new TextEncoder().encode("data: " + JSON.stringify(transformed) + "\\n\\n"))
            incompleteData = ""
          } catch (e) {
            log.debug("JSON parse failed on empty line, continuing to buffer", {
              error: e instanceof Error ? e.message : String(e),
              dataLength: incompleteData.length,
            })
          }
        } else if (incompleteData && line.trim()) {
          incompleteData += line
          
          let isAccumComplete = true
          try {
            JSON.parse(incompleteData)
          } catch {
            isAccumComplete = false
          }
          
          if (!isAccumComplete) {
            continue
          }
          
          try {
            const json = JSON.parse(incompleteData)
            const transformed = isGlmModel ? responseTransformer(json, availableTools) : json
            controller.enqueue(new TextEncoder().encode("data: " + JSON.stringify(transformed) + "\\n\\n"))
            incompleteData = ""
          } catch (e) {
            log.debug("JSON parse failed while accumulating, continuing to buffer", {
              error: e instanceof Error ? e.message : String(e),
              dataLength: incompleteData.length,
            })
          }
        } else if (line === "") {
          controller.enqueue(new TextEncoder().encode("\\n"))
        } else if (!line.startsWith("data: ")) {
          controller.enqueue(new TextEncoder().encode(line + "\\n"))
        }
      }
    },

    flush(controller) {
      if (incompleteData) {
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
          const errorDelta = {
            choices: [
              {
                delta: {
                  content: `\\n\\n[STREAM WARNING]: Incomplete data at stream end`,
                },
                index: 0,
                finish_reason: "error",
              },
            ],
          }
          controller.enqueue(new TextEncoder().encode("data: " + JSON.stringify(errorDelta) + "\\n\\n"))
          controller.enqueue(new TextEncoder().encode("data: [DONE]\\n\\n"))
          return
        }
        
        try {
          const json = JSON.parse(incompleteData)
          const transformed = isGlmModel ? responseTransformer(json, availableTools) : json
          controller.enqueue(new TextEncoder().encode("data: " + JSON.stringify(transformed) + "\\n\\n"))
        } catch (e) {
          log.error("Failed to parse final JSON in flush", {
            error: e instanceof Error ? e.message : String(e),
            dataLength: incompleteData.length,
          })
          const errorDelta = {
            choices: [
              {
                delta: {
                  content: `\\n\\n[STREAM ERROR]: Failed to parse final JSON`,
                },
                index: 0,
                finish_reason: "error",
              },
            ],
          }
          controller.enqueue(new TextEncoder().encode("data: " + JSON.stringify(errorDelta) + "\\n\\n"))
          controller.enqueue(new TextEncoder().encode("data: [DONE]\\n\\n"))
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
            
            // Handle GLM-4.5's malformed tool calls - missing function.name but has function.arguments
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
                log.warn("Failed to parse arguments, defaulting to bash", { error: e instanceof Error ? e.message : String(e) })
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
            // Convert numeric IDs to strings
            if (typeof tc.id === "number") {
              tc.id = String(tc.id)
              log.info("Converted numeric tool ID to string in message", { originalId: tc.id })
            }
            if (!tc.type) tc.type = "function"
            
            // Handle GLM-4.5's malformed tool calls - missing function.name but has function.arguments
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
                  log.info("Inferred tool name 'text_search' from message arguments", { arguments: tc.function.arguments })
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
                log.warn("Failed to parse message arguments, defaulting to bash", { error: e instanceof Error ? e.message : String(e) })
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
  log.debug("requestTransformer called", { bodyLength: body.length })
  if (!body || body.trim() === "") {
    throw new Error("Empty request body provided to requestTransformer")
  }

  try {
    log.debug("Parsing request body JSON")
    const bodyObj = JSON.parse(body)
    log.debug("JSON parse successful")
    // Parasail supports thinking but may handle it differently
    bodyObj.thinking = { type: "enabled" }
    
    // Add tool reminder to system prompt
    try {
      if (
        Array.isArray(bodyObj.messages) &&
        bodyObj.messages.length > 0 &&
        bodyObj.messages[0].role === "system" &&
        typeof bodyObj.messages[0].content === "string"
      ) {
        const toolList = bodyObj.tools
          ? bodyObj.tools
              .map((t: any) => t.function?.name)
              .filter(Boolean)
              .join(", ")
          : "various tools"
        bodyObj.messages[0].content += `\n\nAvailable tools: ${toolList}. When you need to use a tool, call it using the standard OpenAI tool call format. Always specify the exact tool name from the available tools list (case-sensitive). Examples:
- To read files: use "read"
- To list files: use "bash" with command "ls"  
- To search files: use "text_search"
- To find files: use "glob"
Use the exact lowercase tool names shown in the list.

IMPORTANT: If a tool fails, try alternative approaches. For example:
- If "read" fails because a file doesn't exist, try "bash" with "ls" to list directory contents
- If a path doesn't work, try different path formats or check if it's a directory vs file
- Always attempt at least 2-3 different approaches before asking the user for help
- Be resilient and creative when tools fail - don't give up immediately`
        log.info("Injected tool reminder into system prompt", { toolList })
      } else {
        log.debug("Skipped tool reminder injection - no valid system message found")
      }
    } catch (reminderError: any) {
      log.warn("Failed to inject tool reminder", { error: reminderError.message || String(reminderError) })
    }
    const result = JSON.stringify(bodyObj)
    log.debug("requestTransformer completing, about to return", { resultLength: result.length })
    if (result.length > 30000) {
      log.warn("Very large request body", { 
        length: result.length,
        preview: result.substring(0, 200) + "..." + result.substring(result.length - 200)
      })
    }
    return result
  } catch (error) {
    log.error("Failed to parse request body as JSON", {
      body: body.substring(0, 500), // Log first 500 chars to avoid huge logs
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

export const parasailGlmFetch = async (input: RequestInfo, init?: RequestInit): Promise<Response> => {
  log.info("parasailGlmFetch called", { input: input.toString().substring(0, 100) })
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
    log.debug("About to call fetch", { url: input.toString() })
    const response = await fetch(input, init)
    log.debug("Fetch completed", { status: response.status, ok: response.ok })

    if (!response.ok) {
      log.error("Parasail API returned error", { status: response.status, statusText: response.statusText })
      try {
        const errorText = await response.text()
        log.error("Error response body", { errorText: errorText.substring(0, 500) })
        
        // Handle specific GLM-4.5 500 errors with helpful message
        if (response.status === 500 && errorText.includes('"message":null')) {
          const errorResponse = {
            choices: [
              {
                message: {
                  role: "assistant",
                  content: `\n\n[API ERROR]: The parasail GLM-4.5 model is currently experiencing issues (HTTP 500). This might be due to:\n- Request size too large (${init && init.body ? (init.body as string).length : 'unknown'} bytes)\n- Model temporarily unavailable\n- Tool schema complexity\n\nPlease try:\n1. Using a simpler request\n2. A different model\n3. Retrying in a few minutes`,
                },
                finish_reason: "error",
              },
            ],
          }
          return new Response(JSON.stringify(errorResponse), {
            status: 200, // Return as successful response so it gets displayed
            statusText: "OK",
            headers: { "content-type": "application/json" }
          })
        }
        
      } catch (e) {
        log.error("Failed to read error response body", { error: e instanceof Error ? e.message : String(e) })
      }
      return response
    }

    const contentType = response.headers.get("content-type")
    log.info("Response content type", { contentType, status: response.status })

    if (contentType?.includes("application/json")) {
      let json
      let text: string | undefined
      try {
        text = await response.text()
        if (!text || text.trim() === "") {
          throw new Error("Empty response from API")
        }
        
        // Check if this is actually streaming data disguised as JSON
        if (text.startsWith("data: ")) {
          log.info("Detected streaming data with JSON content-type, applying GLM transformations")
          log.debug("Raw streaming text preview", { preview: text.substring(0, 200) })
          // Apply GLM-specific transformations to streaming data
          const fixedText = transformStreamingData(text, availableTools)
          log.debug("Transformed streaming text preview", { preview: fixedText.substring(0, 200) })
          log.debug("Full raw text length", { length: text.length })
          log.debug("Fixed text length", { length: fixedText.length })
          const headers: Record<string, string> = {}
response.headers.forEach((value, key) => {
  headers[key] = value
})
headers["content-type"] = "text/event-stream"

return new Response(fixedText, {
  status: response.status,
  statusText: response.statusText,
  headers: headers
})
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

      // Apply GLM transformations
      const transformed = responseTransformer(json, availableTools)
      
      return new Response(JSON.stringify(transformed), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      })
    } else if (contentType?.includes("text/event-stream")) {
      if (!response.body) return response

      let incompleteData = ""

      const transformer = new TransformStream({
        transform(chunk, controller) {
          const text = new TextDecoder().decode(chunk)
          log.debug("Processing streaming chunk", { chunkLength: chunk.length, textPreview: text.substring(0, 100) })
          const lines = text.split("\n")

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i]
            log.debug("Processing line", { lineIndex: i, linePreview: line.substring(0, 50), startsWithData: line.startsWith("data: ") })

            if (line.startsWith("data: ")) {
              const data = line.slice(6)

              if (data === "[DONE]") {
                log.debug("Received [DONE] signal, ending stream")
                incompleteData = ""
                controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"))
                continue
              }

              let jsonStr = incompleteData + data
              incompleteData = ""

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
                incompleteData = jsonStr
                continue
              }

              try {
                const json = JSON.parse(jsonStr)
                // Parasail uses standard OpenAI format - no custom reasoning handling needed
                const transformed = responseTransformer(json, availableTools)
                controller.enqueue(new TextEncoder().encode("data: " + JSON.stringify(transformed) + "\n\n"))
              } catch (e) {
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
                continue
              }
              
              try {
                const json = JSON.parse(incompleteData)
                const transformed = responseTransformer(json, availableTools)
                controller.enqueue(new TextEncoder().encode("data: " + JSON.stringify(transformed) + "\n\n"))
                incompleteData = ""
              } catch (e) {
                log.debug("JSON parse failed on empty line, continuing to buffer", {
                  error: e instanceof Error ? e.message : String(e),
                  dataLength: incompleteData.length,
                })
              }
            } else if (incompleteData && line.trim()) {
              incompleteData += line
              
              let isAccumComplete = true
              try {
                JSON.parse(incompleteData)
              } catch {
                isAccumComplete = false
              }
              
              if (!isAccumComplete) {
                continue
              }
              
              try {
                const json = JSON.parse(incompleteData)
                const transformed = responseTransformer(json, availableTools)
                controller.enqueue(new TextEncoder().encode("data: " + JSON.stringify(transformed) + "\n\n"))
                incompleteData = ""
              } catch (e) {
                log.debug("JSON parse failed while accumulating, continuing to buffer", {
                  error: e instanceof Error ? e.message : String(e),
                  dataLength: incompleteData.length,
                })
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
    log.error("Parasail GLM fetch error", {
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}