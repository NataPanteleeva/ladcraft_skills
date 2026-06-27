---
name: general-lib-shared-helper
description: Approved template для shared helper через SKILL.md -> general.lib[].
mcp_spec:
  tools:
    - name: normalizeLead
    - name: renderLead
general:
  lib:
    - runtime: nodejs@24
      code: |
        function cleanText(value) {
          return String(value || "").trim().replace(/\s+/g, " ");
        }

        function normalizeLeadName(value) {
          const normalized = cleanText(value);
          return normalized || "Unknown lead";
        }

        function normalizeEmail(value) {
          return String(value || "").trim().toLowerCase();
        }

        function formatLeadSummary(lead) {
          const name = normalizeLeadName(lead && lead.name);
          const email = normalizeEmail(lead && lead.email);
          return email ? `${name} <${email}>` : name;
        }
---

# General lib shared helper

Навык показывает, как использовать общий helper-код для нескольких tools через `SKILL.md -> general.lib[]`.

## Что делать агенту

1. Держать общий helper-код в одном объединённом `general.lib[]` block для `nodejs@24`.
2. В tool-скриптах вызывать `normalizeLeadName`, `normalizeEmail` и `formatLeadSummary` напрямую.
3. Не создавать финальную папку `lib/`, не добавлять `require("../lib")`, `module.exports` или `export`.
