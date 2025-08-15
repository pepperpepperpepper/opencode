// Monkey patch for @ai-sdk/openai-compatible to handle numeric tool call IDs
const path = require("path")
const fs = require("fs")

const targetFile = path.join(__dirname, "node_modules/@ai-sdk/openai-compatible/dist/index.js")

if (fs.existsSync(targetFile)) {
  let content = fs.readFileSync(targetFile, "utf8")

  // Replace the strict validation with more flexible handling
  const oldValidation = `                  if (toolCallDelta.id == null) {
                    throw new import_provider3.InvalidResponseDataError({
                      data: toolCallDelta,
                      message: \`Expected 'id' to be a string.\`
                    });
                  }`

  const newValidation = `                  // Enhanced logging for debugging tool call ID issues
                  if (toolCallDelta.id == null || toolCallDelta.id === undefined) {
                    console.error('[AI-SDK-PATCH] Tool call delta missing ID:', {
                      toolCallDelta: JSON.stringify(toolCallDelta),
                      type: typeof toolCallDelta,
                      keys: Object.keys(toolCallDelta || {}),
                      timestamp: new Date().toISOString()
                    });
                    throw new import_provider3.InvalidResponseDataError({
                      data: toolCallDelta,
                      message: \`Expected 'id' to be defined. Received: \${JSON.stringify(toolCallDelta)}\`
                    });
                  }
                  // Convert numeric IDs to strings to handle providers that return numbers
                  if (typeof toolCallDelta.id === 'number') {
                    console.warn('[AI-SDK-PATCH] Converting numeric tool call ID to string:', {
                      originalId: toolCallDelta.id,
                      originalType: typeof toolCallDelta.id,
                      convertedId: String(toolCallDelta.id)
                    });
                    toolCallDelta.id = String(toolCallDelta.id);
                  }
                  // Log successful ID validation
                  if (typeof toolCallDelta.id === 'string') {
                    console.debug('[AI-SDK-PATCH] Tool call ID validated:', {
                      id: toolCallDelta.id,
                      toolName: toolCallDelta.toolName || 'unknown'
                    });
                  }`

  content = content.replace(oldValidation, newValidation)

  fs.writeFileSync(targetFile, content)
  console.log("✅ Patched @ai-sdk/openai-compatible to handle numeric tool call IDs")
} else {
  console.log("❌ Could not find target file to patch")
}
