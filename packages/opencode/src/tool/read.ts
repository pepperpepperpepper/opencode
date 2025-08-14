import { z } from "zod"
import * as fs from "fs"
import * as path from "path"
import { Tool } from "./tool"
import { LSP } from "../lsp"
import { FileTime } from "../file/time"
import DESCRIPTION from "./read.txt"
import { App } from "../app/app"
import { fileTypeFromFile } from "file-type"

const DEFAULT_READ_LIMIT = 2000
const MAX_LINE_LENGTH = 2000
const LARGE_FILE_THRESHOLD = 1024 * 1024 // 1MB
const MAX_PREVIEW_BYTES = 256 * 1024 // 256KB

// List of MIME types that are considered safe to read as text
const SAFE_MIME_TYPES = new Set([
  "text/plain",
  "text/html",
  "text/css",
  "text/javascript",
  "application/javascript",
  "application/json",
  "application/xml",
  "text/xml",
  "text/markdown",
  "text/x-markdown",
  "application/x-yaml",
  "text/yaml",
  "text/csv",
  "text/tab-separated-values",
  "application/x-sh",
  "application/x-bash",
  "text/x-python",
  "text/x-java-source",
  "text/x-csrc",
  "text/x-c++src",
  "text/x-rust",
  "text/x-go",
  "text/x-typescript",
  "text/x-tsx",
  "text/x-jsx",
  "text/x-sql",
  "text/x-diff",
  "text/x-patch",
  "text/x-log",
  "text/x-toml",
  "text/x-ini",
  "text/x-properties",
  "text/x-conf",
  "text/x-config",
  "text/x-makefile",
  "text/x-cmake",
  "text/x-dockerfile",
  "text/x-shellscript",
  "text/x-vcard",
  "text/x-calendar",
  "text/x-rtf",
  "text/x-sgml",
  "text/x-html",
  "text/x-xml",
  "text/x-yaml",
  "text/x-json",
  "text/x-csv",
  "text/x-tsv",
  "text/x-latex",
  "text/x-tex",
  "text/x-bibtex",
  "text/x-man",
  "text/x-nroff",
  "text/x-troff",
  "text/x-msdos-batch",
  "text/x-powershell",
  "text/x-vb",
  "text/x-vbscript",
  "text/x-php",
  "text/x-ruby",
  "text/x-perl",
  "text/x-lua",
  "text/x-tcl",
  "text/x-scheme",
  "text/x-lisp",
  "text/x-haskell",
  "text/x-ocaml",
  "text/x-fsharp",
  "text/x-scala",
  "text/x-kotlin",
  "text/x-swift",
  "text/x-objective-c",
  "text/x-objective-c++",
  "text/x-d",
  "text/x-nim",
  "text/x-julia",
  "text/x-matlab",
  "text/x-octave",
  "text/x-r",
  "text/x-mysql",
  "text/x-postgresql",
  "text/x-sqlite",
  "text/x-mongodb",
  "text/x-redis",
  "text/x-nginx",
  "text/x-apache",
  "text/x-systemd",
  "text/x-upstart",
  "text/x-sysv",
  "text/x-systemd-unit",
  "text/x-upstart-job",
  "text/x-sysv-init",
  "text/x-cron",
  "text/x-logrotate",
  "text/x-rsyslog",
  "text-x-nginx-conf",
  "text-x-apache-conf",
  "text-x-systemd-conf",
  "text-x-upstart-conf",
  "text-x-sysv-conf",
  "text-x-systemd-unit-conf",
  "text-x-upstart-job-conf",
  "text-x-sysv-init-conf",
  "text-x-cron-conf",
  "text-x-logrotate-conf",
  "text-x-rsyslog-conf",
])

// MIME types that indicate compressed/minified content
const COMPRESSED_MIME_TYPES = new Set([
  "application/gzip",
  "application/zip",
  "application/x-gzip",
  "application/x-zip-compressed",
  "application/x-tar",
  "application/x-rar-compressed",
  "application/x-7z-compressed",
  "application/x-bzip2",
  "application/x-lzma",
  "application/x-xz",
  "application/x-brotli",
  "application/br",
])

// File extensions that indicate compressed files
const COMPRESSED_EXTENSIONS = new Set([
  "gz",
  "zip",
  "tar",
  "rar",
  "7z",
  "bz2",
  "lzma",
  "xz",
  "z",
  "tgz",
  "tbz2",
  "txz",
  "br",
])

// List of file extensions that are considered safe to read as text
const SAFE_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "html",
  "htm",
  "css",
  "js",
  "jsx",
  "ts",
  "tsx",
  "json",
  "jsonc",
  "xml",
  "yaml",
  "yml",
  "toml",
  "ini",
  "conf",
  "config",
  "env",
  "py",
  "java",
  "c",
  "cpp",
  "cc",
  "cxx",
  "h",
  "hpp",
  "rs",
  "go",
  "rb",
  "php",
  "pl",
  "lua",
  "sh",
  "bash",
  "zsh",
  "fish",
  "ps1",
  "bat",
  "cmd",
  "sql",
  "diff",
  "patch",
  "log",
  "dockerfile",
  "makefile",
  "cmake",
  "gradle",
  "properties",
  "cfg",
  "gitattributes",
  "gitignore",
  "editorconfig",
])

async function isSafeToRead(
  filePath: string,
): Promise<{ safe: boolean; reason?: string; fileType?: { ext: string; mime: string } }> {
  try {
    // First check file extension for quick filtering
    const ext = path.extname(filePath).toLowerCase().slice(1)
    if (ext && !SAFE_EXTENSIONS.has(ext)) {
      // If extension is not in safe list, check with file-type
      const fileType = await fileTypeFromFile(filePath)
      if (fileType) {
        if (!SAFE_MIME_TYPES.has(fileType.mime)) {
          return {
            safe: false,
            reason: `File type '${fileType.mime}' (${fileType.ext}) is not safe to read as text. This appears to be a binary or compressed file.`,
            fileType,
          }
        }
      }
    }

    // If we get here, either the extension is safe or file-type didn't detect it as binary
    // Do a final check by reading a small sample and checking for binary content
    const file = Bun.file(filePath)
    const sample = await file.slice(0, 1024).arrayBuffer()
    const buffer = new Uint8Array(sample)

    // Check for null bytes and other binary indicators
    let nullByteCount = 0
    let highByteCount = 0

    for (let i = 0; i < buffer.length; i++) {
      if (buffer[i] === 0) {
        nullByteCount++
      } else if (buffer[i] > 127) {
        highByteCount++
      }
    }

    // If more than 1% of the sample contains null bytes, it's likely binary
    if (nullByteCount > buffer.length * 0.01) {
      return {
        safe: false,
        reason:
          "File contains binary data (detected by null byte analysis). This file appears to be binary or compressed.",
      }
    }

    // If more than 30% of bytes are high bytes (> 127), it's likely binary
    if (highByteCount > buffer.length * 0.3) {
      return {
        safe: false,
        reason:
          "File contains binary data (detected by high byte analysis). This file appears to be binary or compressed.",
      }
    }

    return { safe: true }
  } catch (error) {
    // If we can't determine the file type, err on the side of caution
    return {
      safe: false,
      reason: `Unable to determine file type: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

export const ReadTool = Tool.define("read", {
  description: DESCRIPTION,
  parameters: z.object({
    filePath: z.string().describe("File to read"),
    offset: z.number().describe("Line number to start from (optional)").optional(),
    limit: z.number().describe("Number of lines to read (optional)").optional(),
  }),
  async execute(params, ctx) {
    let filePath = params.filePath
    if (!path.isAbsolute(filePath)) {
      filePath = path.join(process.cwd(), filePath)
    }

    const file = Bun.file(filePath)
    if (!(await file.exists())) {
      const dir = path.dirname(filePath)
      const base = path.basename(filePath)

      const dirEntries = fs.readdirSync(dir)
      const suggestions = dirEntries
        .filter(
          (entry) =>
            entry.toLowerCase().includes(base.toLowerCase()) || base.toLowerCase().includes(entry.toLowerCase()),
        )
        .map((entry) => path.join(dir, entry))
        .slice(0, 3)

      if (suggestions.length > 0) {
        throw new Error(`File not found: ${filePath}\n\nDid you mean one of these?\n${suggestions.join("\n")}`)
      }

      throw new Error(`File not found: ${filePath}`)
    }

    // File metadata
    const stat = fs.statSync(filePath)
    const size = stat.size
    const basename = path.basename(filePath).toLowerCase()
    const ext = path.extname(filePath).toLowerCase().slice(1)
    const detectedType = await fileTypeFromFile(filePath)

    // Image handling: don't throw; return guidance and metadata
    const isImage = isImageFile(filePath) || (detectedType && detectedType.mime.startsWith("image/"))
    if (isImage) {
      const metaLines = [
        `NOTE: Detected image file.`,
        `Type: ${typeof isImage === "string" ? isImage : detectedType?.mime || "unknown"}`,
        `Size: ${size} bytes`,
        `Path: ${filePath}`,
        `This tool does not render images. Use an image-aware tool or a vision-capable model to process this file.`,
      ]

      let output = "<file>\n"
      output += metaLines.map((l, i) => `${(i + 1).toString().padStart(5, "0")}| ${l}`).join("\n")
      output += "\n</file>"

      LSP.touchFile(filePath, false)
      FileTime.read(ctx.sessionID, filePath)

      return {
        title: path.relative(App.info().path.root, filePath),
        output,
        metadata: {
          preview: metaLines.join("\n"),
        },
      }
    }

    // Compressed archive handling: provide safe guidance without reading
    const isCompressed =
      COMPRESSED_EXTENSIONS.has(ext) || (detectedType && COMPRESSED_MIME_TYPES.has(detectedType.mime))
    if (isCompressed) {
      const tips: string[] = []
      if (basename.endsWith(".gz") || (detectedType && detectedType.mime.includes("gzip"))) {
        tips.push(
          `Examples to preview safely (run in your shell):`,
          `- zcat "${filePath}" | head -n 200`,
          `- gunzip -c "${filePath}" | head -n 200`,
          `- gunzip -c "${filePath}" | jq '.' | head -n 200`,
        )
      } else if (basename.endsWith(".zip") || (detectedType && detectedType.mime.includes("zip"))) {
        tips.push(
          `Examples to preview safely (run in your shell):`,
          `- unzip -p "${filePath}" <FILE_INSIDE_ZIP> | head -n 200`,
          `- unzip -l "${filePath}"  # list files first`,
        )
      } else {
        tips.push(
          `Examples to preview safely (run in your shell):`,
          `- tar -xOf "${filePath}" <FILE_INSIDE_ARCHIVE> | head -n 200`,
        )
      }

      const metaLines = [
        `NOTE: Compressed/archived file detected.`,
        `MIME: ${detectedType?.mime || "unknown"}`,
        `Size: ${size} bytes`,
        `Path: ${filePath}`,
        `For safety, this tool won't load compressed content into context. Use shell to preview specific parts, then re-run read on the extracted file.`,
        ...tips,
      ]

      let output = "<file>\n"
      output += metaLines.map((l, i) => `${(i + 1).toString().padStart(5, "0")}| ${l}`).join("\n")
      output += "\n</file>"

      LSP.touchFile(filePath, false)
      FileTime.read(ctx.sessionID, filePath)

      return {
        title: path.relative(App.info().path.root, filePath),
        output,
        metadata: {
          preview: metaLines.slice(0, 10).join("\n"),
        },
      }
    }

    // Check if file is safe to read (not binary)
    const safetyCheck = await isSafeToRead(filePath)
    if (!safetyCheck.safe) {
      throw new Error(safetyCheck.reason || "File appears to be binary or compressed and cannot be read safely.")
    }

    const limit = params.limit ?? DEFAULT_READ_LIMIT
    const offset = params.offset || 0

    // Smart preview for large or minified files
    const nameIndicatesMinified = [
      ".min.js",
      ".min.css",
      ".min.json",
      ".min.html",
      ".min.xml",
      ".min.yaml",
      ".min.yml",
      ".min.ts",
      ".min.tsx",
      ".min.jsx",
    ].some((suf) => basename.endsWith(suf))

    const previewOnly = size > LARGE_FILE_THRESHOLD || nameIndicatesMinified

    if (previewOnly) {
      const bytesToRead = Math.min(size, MAX_PREVIEW_BYTES)
      const text = await file.slice(0, bytesToRead).text()

      // Heuristic: if very few newlines, treat as minified and chunk
      const newlineCount = (text.match(/\n/g) || []).length
      let raw: string[] = []
      if (newlineCount < 3) {
        for (let i = 0; i < text.length && raw.length < limit; i += MAX_LINE_LENGTH) {
          const chunk = text.slice(i, i + MAX_LINE_LENGTH)
          raw.push(chunk)
        }
      } else {
        const lines = text.split("\n")
        raw = lines
          .slice(offset, offset + limit)
          .map((line) => (line.length > MAX_LINE_LENGTH ? line.substring(0, MAX_LINE_LENGTH) + "..." : line))
      }

      const content = raw.map((line, index) => `${(index + offset + 1).toString().padStart(5, "0")}| ${line}`)
      const preview = raw.slice(0, 20).join("\n")

      let output = "<file>\n"
      output += content.join("\n")
      output +=
        "\n\n(Preview mode: large/minified file. Showing only the first part to avoid overwhelming context. Use shell tools like head/tail or jq to slice further, then re-run 'read' on a smaller segment.)"
      if (size > bytesToRead) {
        output += `\n(File size: ${size} bytes; previewed: ${bytesToRead} bytes)`
      }
      output += "\n</file>"

      LSP.touchFile(filePath, false)
      FileTime.read(ctx.sessionID, filePath)

      return {
        title: path.relative(App.info().path.root, filePath),
        output,
        metadata: {
          preview,
        },
      }
    }

    // Default behavior for normal text files
    const lines = await file.text().then((text) => text.split("\n"))
    const raw = lines
      .slice(offset, offset + limit)
      .map((line) => (line.length > MAX_LINE_LENGTH ? line.substring(0, MAX_LINE_LENGTH) + "..." : line))
    const content = raw.map((line, index) => `${(index + offset + 1).toString().padStart(5, "0")}| ${line}`)
    const preview = raw.slice(0, 20).join("\n")

    let output = "<file>\n"
    output += content.join("\n")

    if (lines.length > offset + content.length) {
      output += `\n\n(File has more lines. Use 'offset' parameter to read beyond line ${offset + content.length})`
    }
    output += "\n</file>"

    // just warms the lsp client
    LSP.touchFile(filePath, false)
    FileTime.read(ctx.sessionID, filePath)

    return {
      title: path.relative(App.info().path.root, filePath),
      output,
      metadata: {
        preview,
      },
    }
  },
})

function isImageFile(filePath: string): string | false {
  const ext = path.extname(filePath).toLowerCase()
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return "JPEG"
    case ".png":
      return "PNG"
    case ".gif":
      return "GIF"
    case ".bmp":
      return "BMP"
    case ".svg":
      return "SVG"
    case ".webp":
      return "WebP"
    default:
      return false
  }
}
