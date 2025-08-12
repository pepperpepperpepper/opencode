// Monkey patch for @ai-sdk/openai-compatible ESM version
import { readFileSync, writeFileSync, existsSync } from "fs"
import { join } from "path"

const targetFile = join(process.cwd(), "node_modules/@ai-sdk/openai-compatible/dist/index.mjs")

if (existsSync(targetFile)) {
  let content = readFileSync(targetFile, "utf8")

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

  writeFileSync(targetFile, content)
  console.log("✅ Patched @ai-sdk/openai-compatible ESM version")
} else {
  console.log("❌ Could not find ESM target file to patch")
}
