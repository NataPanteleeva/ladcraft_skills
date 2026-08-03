"use strict";

/**
 * Quick sanity check for disk id parsing (no DOM).
 * Run: node cases/plugin/ladcraft-r7/scripts/test-disk-id-parse.js
 */

function parsePositiveInt(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === "string" && value.trim()) {
    const n = Number(value.trim());
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return null;
}

function parseIdFromUrl(url) {
  if (!url) return null;
  const patterns = [
    /[?&#](?:id|fileid|file_id|docid|doc_id|documentid|document_id)=(\d+)/i,
    /doc\.html[^#?]*[?&#][^#]*\bid=(\d+)/i,
    /Documents\/Download[^?#]*[?&]id=(\d+)/i,
  ];
  for (let i = 0; i < patterns.length; i += 1) {
    const match = url.match(patterns[i]);
    if (match) {
      const n = parsePositiveInt(match[1]);
      if (n != null) return n;
    }
  }
  return null;
}

function parseDiskIdFromEditorKey(value) {
  const s = String(value || "").trim();
  if (!s) return null;
  const suffix = s.match(/_(\d{1,12})$/);
  if (!suffix) return null;
  return parsePositiveInt(suffix[1]);
}

function isHighPriorityDiskUrl(url) {
  return /doc\.html/i.test(url) || /Documents\/Download/i.test(url);
}

function isLikelyDiskDocumentId(value) {
  const s = String(value || "").trim();
  if (!s) return null;
  if (/^[0-9a-f]{12,}$/i.test(s.replace(/-/g, ""))) return null;
  const n = parsePositiveInt(value);
  if (n == null || n > 999999999) return null;
  return n;
}

function collectCandidates(input) {
  const list = [];
  const bestTierById = new Map();

  const add = (id, source, tier) => {
    if (id == null) return;
    const prev = bestTierById.get(id);
    if (prev != null && prev <= tier) return;
    bestTierById.set(id, tier);
    const idx = list.findIndex((c) => c.id === id);
    if (idx >= 0) list.splice(idx, 1);
    list.push({ id, source, tier });
  };

  for (const url of input.browserUrls || []) {
    const id = parseIdFromUrl(url);
    if (id == null) continue;
    add(id, "url:" + url, isHighPriorityDiskUrl(url) ? 1 : 2);
  }

  for (const url of input.pluginUrls || []) {
    const id = parseIdFromUrl(url);
    if (id != null) add(id, "pluginUrl:" + url, 2);
  }

  const numericDocId = isLikelyDiskDocumentId(input.documentId);
  if (numericDocId != null) add(numericDocId, "info.documentId", 3);

  const suffixFromDocId = parseDiskIdFromEditorKey(input.documentId);
  if (suffixFromDocId != null) {
    add(suffixFromDocId, "info.documentId.diskSuffix", 5);
  }
  const suffixFromKey = parseDiskIdFromEditorKey(input.key);
  if (suffixFromKey != null) add(suffixFromKey, "info.key.diskSuffix", 5);

  return list;
}

function resolveDiskId(input) {
  const candidates = collectCandidates(input);
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.tier - b.tier);
  return candidates[0].id;
}

const urlSamples = [
  ["https://cddisk.gptz.lad-soft.ru/doc.html?id=101", 101],
  ["https://cddisk.example/doc.html?id=101&mode=edit", 101],
  ["/doc.html?id=101", 101],
];

const keySamples = [
  ["39E05B3163D093AA92087496F2CA17C74CC4FCCF_113", 113],
];

const conflictSamples = [
  {
    label: "doc.html id wins over diskSuffix",
    input: {
      browserUrls: ["https://cddisk.gptz.lad-soft.ru/doc.html?id=100"],
      documentId: "7D0D6ED6AD3CEAA93810CA4242AC605F9E5C8388_114",
    },
    expected: 100,
  },
  {
    label: "diskSuffix fallback when no URL",
    input: {
      browserUrls: [],
      documentId: "7D0D6ED6AD3CEAA93810CA4242AC605F9E5C8388_114",
    },
    expected: 114,
  },
  {
    label: "pure numeric documentId",
    input: {
      browserUrls: [],
      documentId: 100,
    },
    expected: 100,
  },
];

let failed = 0;
for (const [url, expected] of urlSamples) {
  const got = parseIdFromUrl(url);
  if (got !== expected) {
    console.error("FAIL url", url, "expected", expected, "got", got);
    failed += 1;
  }
}
for (const [key, expected] of keySamples) {
  const got = parseDiskIdFromEditorKey(key);
  if (got !== expected) {
    console.error("FAIL key", key, "expected", expected, "got", got);
    failed += 1;
  }
}
for (const sample of conflictSamples) {
  const got = resolveDiskId(sample.input);
  if (got !== sample.expected) {
    console.error(
      "FAIL conflict",
      sample.label,
      "expected",
      sample.expected,
      "got",
      got,
    );
    failed += 1;
  }
}

if (failed) process.exit(1);
console.log("OK: disk id parse samples");
