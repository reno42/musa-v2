/**
 * Link handling for images the Content Machine sheet points at.
 *
 * Only the pure parts: URL rewriting and the links that cannot work at all.
 * The fetch itself needs the network and the SSRF guard, so it is exercised
 * against a real server rather than asserted here.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeImageUrl, unsupportedLinkReason, requestSmallerVariant,
} from "../api/src/services/imageLinks.ts";

test("a Drive view link becomes the one that returns bytes", () => {
  assert.equal(
    normalizeImageUrl("https://drive.google.com/file/d/1A2B3C/view?usp=sharing"),
    "https://drive.google.com/uc?export=download&id=1A2B3C",
  );
  assert.equal(
    normalizeImageUrl("https://drive.google.com/open?id=9Z8Y7X"),
    "https://drive.google.com/uc?export=download&id=9Z8Y7X",
  );
});

test("a Dropbox preview link is asked for the raw file", () => {
  assert.match(normalizeImageUrl("https://www.dropbox.com/s/abc/foto.jpg?dl=0"), /raw=1/);
  assert.match(normalizeImageUrl("https://www.dropbox.com/s/abc/foto.jpg"), /\?raw=1$/);
});

test("a direct image URL is left exactly as it is", () => {
  const direct = "https://images.unsplash.com/photo-1234?w=1200";
  assert.equal(normalizeImageUrl(direct), direct);
});

test("surrounding whitespace does not defeat the rewrite", () => {
  assert.equal(
    normalizeImageUrl("  https://drive.google.com/file/d/XYZ/view  "),
    "https://drive.google.com/uc?export=download&id=XYZ",
  );
});

test("auth-walled hosts are refused with the reason, not attempted", () => {
  for (const url of [
    "https://futuraria.sharepoint.com/sites/x/foto.jpg",
    "https://teams.microsoft.com/l/file/abc",
    "https://1drv.ms/i/s!abc",
  ]) {
    const reason = unsupportedLinkReason(url);
    assert.ok(reason, `${url} should be refused up front`);
    assert.match(reason, /iniciar sesión/);
  }
});

test("a gallery page is called out as not being the image", () => {
  assert.match(unsupportedLinkReason("https://unsplash.com/photos/abc123"), /images\.unsplash\.com/);
  assert.match(unsupportedLinkReason("https://www.pexels.com/photo/gato-123/"), /images\.pexels\.com/);
});

test("the CDN URLs those pages point at are fine", () => {
  assert.equal(unsupportedLinkReason("https://images.unsplash.com/photo-1"), null);
  assert.equal(unsupportedLinkReason("https://images.pexels.com/photos/1/gato.jpg"), null);
});

// Cheapest compression there is: never receive the big file.
test("Unsplash is asked for a resized copy instead of the original", () => {
  const smaller = new URL(requestSmallerVariant("https://images.unsplash.com/photo-1?ixid=abc", 2000, 75));
  assert.equal(smaller.searchParams.get("w"), "2000");
  assert.equal(smaller.searchParams.get("q"), "75");
  assert.equal(smaller.searchParams.get("fit"), "max", "fit=max must not upscale or crop");
  assert.equal(smaller.searchParams.get("ixid"), "abc", "the source's own params survive");
});

test("Pexels gets its own compression parameters", () => {
  const smaller = new URL(requestSmallerVariant("https://images.pexels.com/photos/1/gato.jpg"));
  assert.equal(smaller.searchParams.get("auto"), "compress");
  assert.equal(smaller.searchParams.get("w"), "2000");
});

test("an existing size parameter is replaced, not duplicated", () => {
  const smaller = requestSmallerVariant("https://images.unsplash.com/photo-1?w=6000&q=100");
  assert.equal((smaller.match(/[?&]w=/g) || []).length, 1);
  assert.match(smaller, /w=2000/);
});

test("a host we do not know is left completely alone", () => {
  const own = "https://mi-servidor.com/foto.jpg?token=abc";
  assert.equal(requestSmallerVariant(own), own);
  assert.equal(requestSmallerVariant("https://cdn.pixabay.com/photo/1/x.jpg"),
    "https://cdn.pixabay.com/photo/1/x.jpg");
});

test("something that is not a URL comes back untouched rather than throwing", () => {
  assert.equal(requestSmallerVariant("no soy una url"), "no soy una url");
});
