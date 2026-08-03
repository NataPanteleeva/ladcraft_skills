/**
 * Merge assistant chat text without wiping a richer streamed body.
 * Policy: never replace a substantial painted answer with a shorter/plain rewrite;
 * only append incoming bits that are not already present.
 */

function normSpace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function markdownScore(s: string): number {
  const bold = (s.match(/\*\*[^*\n]+?\*\*/g) || []).length;
  const heads = (s.match(/^#{1,3}\s/gm) || []).length;
  const lists = (s.match(/^\s*[-*•]\s/gm) || []).length;
  const fences = (s.match(/```/g) || []).length;
  const draft = /черновик/i.test(s) ? 3 : 0;
  const proposal = /r7\.proposal/i.test(s) ? 5 : 0;
  return bold * 2 + heads * 2 + lists + fences + draft + proposal;
}

/** Body under Черновик: (without trailing fences) for overlap checks. */
function draftCore(s: string): string {
  const m = String(s || "").match(/\*{0,2}черновик\*{0,2}\s*:\*{0,2}\s*([\s\S]*)/i);
  const core = m ? m[1] : s;
  return normSpace(core.replace(/```[\s\S]*$/g, ""));
}

/** Rough containment: shorter is mostly inside longer (avoids doubled Черновик). */
function mostlyContained(shorter: string, longer: string): boolean {
  if (!shorter || !longer) return false;
  if (longer.includes(shorter)) return true;
  if (shorter.length < 48) return false;
  const chunk = Math.min(120, Math.floor(shorter.length / 3));
  if (chunk < 24) return longer.includes(shorter);
  let hits = 0;
  let total = 0;
  for (let i = 0; i + chunk <= shorter.length; i += chunk) {
    total += 1;
    if (longer.includes(shorter.slice(i, i + chunk))) hits += 1;
  }
  return total > 0 && hits / total >= 0.7;
}

/**
 * Keep `prev` when it is already shown; grow with `incoming` only if it adds new content.
 * True growth (incoming extends prev) still takes incoming.
 * Never concatenate two full Черновик bodies (stream + history/text.replaced).
 */
export function preferRicherOrAppend(prev: string, incoming: string): string {
  const a = String(prev || "").trim();
  const b = String(incoming || "").trim();
  if (!a) return b;
  if (!b) return a;
  if (a === b) return a;

  const na = normSpace(a);
  const nb = normSpace(b);
  if (na === nb) return a.length >= b.length ? a : b;

  // Incoming is pure growth of what we already painted.
  if (b.startsWith(a) || nb.startsWith(na)) return b;
  if (a.startsWith(b) || na.startsWith(nb)) return a;

  // Incoming already fully contained → keep painted body.
  if (na.includes(nb) && nb.length <= na.length) return a;

  const hasDraftA = /черновик\s*:/i.test(a);
  const hasDraftB = /черновик\s*:/i.test(b);
  const coreA = draftCore(a);
  const coreB = draftCore(b);

  // Two drafts of the same text (SSE + projection / text.replaced) — never stack.
  if (hasDraftA && hasDraftB) {
    if (
      coreA === coreB ||
      mostlyContained(coreA, coreB) ||
      mostlyContained(coreB, coreA)
    ) {
      const scoreA = markdownScore(a);
      const scoreB = markdownScore(b);
      if (scoreB !== scoreA) return scoreB > scoreA ? b : a;
      return a.length >= b.length ? a : b;
    }
  } else if (
    coreA.length >= 80 &&
    coreB.length >= 80 &&
    (mostlyContained(coreA, coreB) || mostlyContained(coreB, coreA))
  ) {
    const scoreA = markdownScore(a);
    const scoreB = markdownScore(b);
    if (scoreB !== scoreA) return scoreB > scoreA ? b : a;
    return a.length >= b.length ? a : b;
  }

  const scoreA = markdownScore(a);
  const scoreB = markdownScore(b);
  const richerPrev =
    scoreA > scoreB ||
    (scoreA === scoreB && a.length > b.length * 1.1) ||
    (a.length >= 80 && b.length < a.length * 0.75);

  if (richerPrev) {
    // Append only missing chrome (proposal / Черновик label) — never a second draft body.
    const missingDraft = hasDraftB && !hasDraftA;
    const missingProposal = /r7\.proposal/i.test(b) && !/r7\.proposal/i.test(a);
    if (missingProposal && !na.includes(nb)) {
      const fence = b.match(/```r7\.proposal[\s\S]*?```/i);
      if (fence) return `${a.replace(/\s+$/, "")}\n\n${fence[0]}`;
    }
    if (missingDraft && !mostlyContained(coreB, coreA) && coreB.length < 200) {
      return `${a.replace(/\s+$/, "")}\n\n${b}`;
    }
    return a;
  }

  // Incoming richer/longer — prefer it, but if prev had unique draft/proposal keep that.
  if (scoreB > scoreA || b.length > a.length * 1.15) {
    if (/r7\.proposal|черновик\s*:/i.test(a) && !/r7\.proposal|черновик\s*:/i.test(b)) {
      return a;
    }
    return b;
  }

  // Last resort append only short chrome, not a second essay.
  if (!na.includes(nb) && b.length >= 24 && b.length < 280 && !hasDraftB) {
    return `${a.replace(/\s+$/, "")}\n\n${b}`;
  }
  return a;
}
