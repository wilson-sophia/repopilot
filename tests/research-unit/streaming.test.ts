import assert from "node:assert/strict";
import { test } from "node:test";
import { readResearchStream } from "../../components/research/api";
import type { ResearchEvent } from "../../lib/research/types";

function streamBytes(text: string, chunkSize: number) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let index = 0; index < bytes.length; index += chunkSize) {
        controller.enqueue(bytes.slice(index, index + chunkSize));
      }
      controller.close();
    },
  });
}

test("SSE decoder preserves Chinese and emoji across single-byte network chunks", async () => {
  const events: ResearchEvent[] = [];
  const body = streamBytes(
    'data: {"type":"text","delta":"文档证据🔎"}\n\ndata: {"type":"text","delta":"完整"}\n\n',
    1
  );
  await readResearchStream(body, (event) => events.push(event));
  assert.deepEqual(events, [
    { delta: "文档证据🔎", type: "text" },
    { delta: "完整", type: "text" },
  ]);
  assert.equal(body.locked, false);
});

test("SSE decoder accepts CRLF even when CR and LF arrive in separate chunks", async () => {
  const events: ResearchEvent[] = [];
  await readResearchStream(
    streamBytes(
      'data: {"type":"text","delta":"first"}\r\n\r\ndata: {"type":"text","delta":"second"}\r\n\r\n',
      1
    ),
    (event) => events.push(event)
  );
  assert.equal(events.length, 2);
  assert.deepEqual(events[1], { delta: "second", type: "text" });
});

test("SSE decoder ignores comments and DONE while accepting multiline data", async () => {
  const events: ResearchEvent[] = [];
  await readResearchStream(
    streamBytes(
      ': keepalive\n\ndata: {"type":"text",\ndata: "delta":"multiline"}\n\ndata: [DONE]\n\n',
      7
    ),
    (event) => events.push(event)
  );
  assert.deepEqual(events, [{ delta: "multiline", type: "text" }]);
});

test("SSE decoder flushes a final frame without a trailing blank line", async () => {
  const events: ResearchEvent[] = [];
  await readResearchStream(
    streamBytes('data: {"type":"text","delta":"final"}', 4),
    (event) => events.push(event)
  );
  assert.deepEqual(events, [{ delta: "final", type: "text" }]);
});

test("malformed SSE fails explicitly and releases its reader lock", async () => {
  const body = streamBytes("data: {invalid-json}\n\n", 3);
  await assert.rejects(
    readResearchStream(body, () => {
      /* Malformed data must fail before invoking this callback. */
    }),
    SyntaxError
  );
  assert.equal(body.locked, false);
});
