---
name: statusCard
description: Approved EJS widget для показа статуса.
schema:
  type: object
  required:
    - title
    - message
    - docsUrl
  properties:
    title:
      type: string
    message:
      type: string
    docsUrl:
      type: string
---

<script src="https://cdn.tailwindcss.com"></script>

<div class="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
  <p class="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Status</p>
  <h2 class="mt-2 text-2xl font-bold text-slate-900"><%= title %></h2>
  <p class="mt-3 text-sm leading-6 text-slate-700"><%= message %></p>
  <a class="mt-5 inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white" href="<%= docsUrl %>" target="_blank" rel="noreferrer">
    Open docs
  </a>
</div>
