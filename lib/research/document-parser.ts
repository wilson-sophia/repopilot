import mammoth from "mammoth";
import pdf from "pdf-parse/lib/pdf-parse.js";
import { ResearchError } from "./config";
export async function parseDocument(file: File): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer());
  try {
    let text: string;
    if (/\.pdf$/i.test(file.name)) {
      ({ text } = await pdf(buffer));
    } else if (/\.docx$/i.test(file.name)) {
      text = (await mammoth.extractRawText({ buffer })).value;
    } else {
      text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    }
    if (!text.trim()) {
      throw new Error("empty");
    }
    if (text.length > 500_000) {
      throw new Error("large");
    }
    return text;
  } catch (error) {
    // biome-ignore lint/style/useErrorCause: ResearchError takes options as its third argument.
    throw new ResearchError(
      "无法读取资料：请确认文件有效，PDF 包含可选中文字（不支持扫描件 OCR），且提取文本不超过 50 万字符",
      400,
      { cause: error }
    );
  }
}
