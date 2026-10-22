import assert from "node:assert/strict";
import test from "node:test";
import { decodeHandlerBody, getHandlerBodyBuffer, JSON_UTF8_CONTENT_TYPE, parseHandlerJson } from "../worker/runtime/functions/http-encoding.mjs";

const unicodePayload = {
  text: "años · campaña · corazón · 中文 · مرحبا · 😀",
};

test("decodes plain and base64 Netlify JSON bodies without mojibake", () => {
  const json = JSON.stringify(unicodePayload);
  const plain = { body: json, isBase64Encoded: false };
  const base64 = { body: Buffer.from(json, "utf8").toString("base64"), isBase64Encoded: true };

  assert.deepEqual(parseHandlerJson(plain), unicodePayload);
  assert.deepEqual(parseHandlerJson(base64), unicodePayload);
  assert.equal(decodeHandlerBody(base64), json);
  assert.equal(JSON_UTF8_CONTENT_TYPE, "application/json; charset=utf-8");
});

test("rebuilds the request body with the correct UTF-8 byte length", () => {
  const json = JSON.stringify(unicodePayload);
  const body = getHandlerBodyBuffer({
    body: Buffer.from(json, "utf8").toString("base64"),
    isBase64Encoded: true,
  });

  assert.equal(body.toString("utf8"), json);
  assert.equal(body.byteLength, Buffer.byteLength(json, "utf8"));
});

test("rejects invalid UTF-8 instead of persisting replacement characters", () => {
  const invalidUtf8 = Buffer.from([0xc3, 0x28]).toString("base64");
  assert.throws(
    () => decodeHandlerBody({ body: invalidUtf8, isBase64Encoded: true }),
    /encoded data was not valid/i,
  );
});
