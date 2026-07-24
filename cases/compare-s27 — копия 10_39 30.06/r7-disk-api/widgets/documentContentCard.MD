---
name: documentContentCard
description: Карточка с текстом файла после read_content (без скачивания).
schema:
  type: object
  additionalProperties: true
  required:
    - ok
  properties:
    ok:
      type: boolean
    operation:
      type: string
    action:
      type: string
    document_id:
      type: integer
    directory_id:
      type: integer
    name:
      type: string
    file_name:
      type: string
    content_text:
      type: string
    content_text_verified:
      type: string
    content_truncated:
      type: boolean
    agent_message:
      type: string
    error:
      type: string
---

<% if (typeof action !== 'undefined' && action === 'read_content' && ok === true && typeof content_text === 'string' && content_text && show_content_widget !== false && already_completed !== true && already_inflight !== true && widget_already_shown !== true) { %>
<div class="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" style="font-family: system-ui, sans-serif;">
  <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">Р7-Диск · содержимое файла</p>
  <h2 class="mt-1 text-lg font-bold text-slate-900"><%= file_name || name || 'Документ' %></h2>
  <p class="mt-1 text-sm text-slate-600">
    <% if (typeof total_chars === 'number') { %><%= total_chars %> символов<% } %>
    <% if (typeof document_id === 'number') { %> · ID <%= document_id %><% } %>
    <% if (content_truncated === true) { %> · показана часть текста<% } %>
  </p>

  <pre class="mt-4 max-h-[28rem] overflow-auto whitespace-pre-wrap break-words rounded-xl border border-slate-100 bg-slate-50 p-4 text-sm leading-relaxed text-slate-900"><%= content_text %></pre>

  <div class="mt-4 flex flex-wrap gap-2">
    <button
      type="button"
      class="r7-content-copy rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white"
    >Скопировать текст</button>
  </div>
  <p class="r7-content-copy-status mt-2 text-xs text-slate-500 hidden" role="status"></p>
</div>
<script>
(function () {
  var btn = document.querySelector('.r7-content-copy');
  var statusEl = document.querySelector('.r7-content-copy-status');
  if (!btn) return;
  var text = <%- JSON.stringify(content_text) %>;
  btn.addEventListener('click', function () {
    function show(msg) {
      if (!statusEl) return;
      statusEl.textContent = msg;
      statusEl.classList.remove('hidden');
      setTimeout(function () { statusEl.classList.add('hidden'); }, 4000);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        show('Текст скопирован в буфер обмена.');
      });
    } else {
      show('Скопируйте текст из блока выше.');
    }
  });
})();
</script>
<% } %>