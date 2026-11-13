/** biome-ignore-all lint/performance/noAwaitInLoops: Exercise each malformed format independently. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDocument } from "../../lib/research/document-parser";

test("UTF-8 documents retain Chinese evidence", async () => {
  assert.equal(
    await parseDocument(new File(["中文需求：支持 React"], "需求.md")),
    "中文需求：支持 React"
  );
});
test("invalid PDF and DOCX produce readable errors", async () => {
  for (const name of ["broken.pdf", "broken.docx"]) {
    await assert.rejects(
      parseDocument(new File(["invalid"], name)),
      /无法读取资料/
    );
  }
});
test("empty and malformed UTF-8 documents are rejected", async () => {
  await assert.rejects(parseDocument(new File(["  "], "empty.txt")));
  await assert.rejects(
    parseDocument(new File([new Uint8Array([255])], "bad.txt"))
  );
});
