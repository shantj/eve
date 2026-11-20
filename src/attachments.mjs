import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import { SaxesParser } from "saxes";
import { save } from "./files.mjs";

const MiB = 1024 * 1024;
export const uploadLimit = 10 * MiB;
const textLimit = 60_000;
const utf8 = (bytes) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);

function wordText(bytes) {
  let seen = false;
  const entry = "word/document.xml";
  const parts = unzipSync(bytes, {
    filter: (part) => {
      if (part.name !== entry) return false;
      if (seen || part.originalSize > 8 * MiB) throw Error();
      seen = true;
      return true;
    },
  });
  if (!parts[entry]) throw Error();
  const xml = new SaxesParser({ xmlns: true }),
    out = [];
  let inText = false;
  const word = (t) =>
    [
      "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
      "http://purl.oclc.org/ooxml/wordprocessingml/main",
    ].includes(t.uri);
  xml.on("doctype", () => {
    throw Error();
  });
  xml.on("opentag", (t) => {
    if (!word(t)) return;
    if (t.local === "t") inText = true;
    else if (t.local === "br" || t.local === "cr") out.push("\n");
    else if (t.local === "tab") out.push("\t");
  });
  xml.on("text", (t) => {
    if (inText) out.push(t);
  });
  xml.on("closetag", (t) => {
    if (!word(t)) return;
    if (t.local === "t") inText = false;
    if (t.local === "p") out.push("\n");
  });
  xml.write(utf8(parts[entry])).close();
  return out.join("");
}

async function pdfText(bytes) {
  if (!bytes.subarray(0, 1024).includes("%PDF-")) throw Error();
  const mac = process.platform === "darwin";
  const tool = mac ? "/usr/bin/swift" : "pdftotext";
  const args = mac
    ? [fileURLToPath(new URL("./pdf-text.swift", import.meta.url))]
    : ["-enc", "UTF-8", "-nopgbrk", "-", "-"];
  return new Promise((resolve, reject) => {
    const child = execFile(
      tool,
      args,
      { timeout: 30_000, maxBuffer: 512 * 1024 },
      (err, out) => (err ? reject(err) : resolve(out)),
    );
    child.stdin.on("error", () => {}); // The extractor may reject input before consuming it.
    child.stdin.end(bytes);
  });
}

export async function prepareAttachments(files) {
  if (!Array.isArray(files) || files.length > 5)
    throw Error("最多可添加 5 份附件");
  let total = 0,
    characters = 0;
  const result = [];
  for (const file of files) {
    const name = file.name?.normalize("NFC");
    if (!name || name.length > 180 || /[\/\\\u0000-\u001f\u007f]/u.test(name))
      throw Error("附件文件名无效");
    const ext = extname(name).toLowerCase();
    if (![".txt", ".md", ".docx", ".pdf"].includes(ext))
      throw Error(name + "：支持 TXT、Markdown、Word (.docx) 和 PDF");
    total += file.size;
    if (file.size > 5 * MiB || total > uploadLimit)
      throw Error("附件每份不能超过 5 MB，合计不能超过 10 MB");
    if (!file.size) throw Error(name + "：文件为空");
    const bytes = Buffer.from(await file.arrayBuffer());
    let text;
    try {
      text =
        ext === ".pdf"
          ? await pdfText(bytes)
          : ext === ".docx"
            ? wordText(bytes)
            : utf8(bytes);
    } catch (e) {
      if (ext === ".pdf" && e.code === "ENOENT")
        throw Error("未找到 PDF 读取工具；可改用 Word 或 Markdown");
      throw Error(
        name + "：无法读取正文，请确认文档有效且未加密，或另存为 UTF-8 文本",
      );
    }
    text = text.replace(/\r\n?/g, "\n").replace(/\f/g, "\n").trim();
    if (!text || /[\u0000-\u0008\u000e-\u001f]/u.test(text))
      throw Error(name + "：没有可读正文；扫描件请先做文字识别（OCR）");
    characters += text.length;
    if (characters > textLimit)
      throw Error("附件正文合计超过 6 万字符，请精简后重试");
    result.push({
      meta: { id: randomUUID(), name, size: bytes.length },
      bytes,
      text,
    });
  }
  return result;
}

export async function storeAttachments(dir, prepared) {
  for (const { meta, bytes } of prepared)
    await save(join(dir, "attachments", meta.id), bytes);
  if (prepared.length)
    await save(
      join(dir, "attachments", "context.json"),
      prepared.map(({ meta, text }) => ({ name: meta.name, text })),
    );
}
