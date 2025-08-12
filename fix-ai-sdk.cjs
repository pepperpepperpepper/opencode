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

  const newValidation = `                  if (toolCallDelta.id == null) {
                    throw new import_provider3.InvalidResponseDataError({
                      data: toolCallDelta,
                      message: \`Expected 'id' to be defined.\`
                    });
                  }
                  // Convert numeric IDs to strings to handle providers that return numbers
                  if (typeof toolCallDelta.id === 'number') {
                    toolCallDelta.id = String(toolCallDelta.id);
                  }`

  content = content.replace(oldValidation, newValidation)

  fs.writeFileSync(targetFile, content)
  console.log("✅ Patched @ai-sdk/openai-compatible to handle numeric tool call IDs")
} else {
  console.log("❌ Could not find target file to patch")
}
