---
name: fileDownloadCard
description: Карточка скачивания файла с Р7-Диска (кнопка data-URL).
schema:
  type: object
  additionalProperties: true
  required:
    - ok
  properties:
    ok:
      type: boolean
    action:
      type: string
    document_id:
      type: integer
    directory_id:
      type: integer
    file_name:
      type: string
    content_base64:
      type: string
    content_type:
      type: string
    size_bytes:
      type: integer
    deliverable:
      type: boolean
    show_download_widget:
      type: boolean
    download_fresh:
      type: boolean
    agent_message:
      type: string
    error:
      type: string
---

<% if (typeof action !== 'undefined' && action === 'download' && ok === true && typeof deliverable !== 'undefined' && deliverable === true && typeof content_base64 === 'string' && content_base64 && typeof content_type === 'string' && content_type && download_fresh === true && show_download_widget !== false) { %>
<div class="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" style="font-family: system-ui, sans-serif;">
  <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">Р7-Диск · файл</p>
  <h2 class="mt-1 text-lg font-bold text-slate-900"><%= file_name || 'Файл' %></h2>
  <p class="mt-1 text-sm text-slate-600">
    <% if (typeof size_bytes === 'number') { %><%= size_bytes %> байт<% } %>
    <% if (typeof document_id === 'number') { %> · ID <%= document_id %><% } %>
  </p>

  <a
    class="mt-4 inline-flex rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white no-underline"
    download="<%= file_name || 'download' %>"
    href="data:<%= content_type %>;base64,<%= content_base64 %>"
  >Скачать файл</a>
  <p class="mt-2 text-xs text-slate-500">Нажмите кнопку — файл сохранится на ваше устройство.</p>

  <% if (typeof feedback_prompt_ok === 'string' && feedback_prompt_ok && typeof feedback_prompt_retry === 'string' && feedback_prompt_retry) { %>
  <div class="mt-4 border-t border-slate-100 pt-4" id="r7-download-feedback">
    <p class="text-sm font-medium text-slate-700">Файл на компьютере сохранился?</p>
    <div class="mt-2 flex flex-wrap gap-2">
      <button type="button" class="r7-feedback-ok rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm font-medium text-green-900">Скачалось успешно</button>
      <button type="button" class="r7-feedback-retry rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">Нужно повторить</button>
    </div>
    <p class="r7-feedback-status mt-2 text-xs text-slate-500 hidden" role="status"></p>
    <p class="mt-1 text-xs text-slate-400">Текст скопируется — вставьте в чат (Ctrl+V).</p>
  </div>
  <script>
  (function () {
    var root = document.getElementById('r7-download-feedback');
    if (!root) return;
    var promptOk = <%- JSON.stringify(feedback_prompt_ok) %>;
    var promptRetry = <%- JSON.stringify(feedback_prompt_retry) %>;
    var statusEl = root.querySelector('.r7-feedback-status');
    function showStatus(text) {
      if (!statusEl) return;
      statusEl.textContent = text;
      statusEl.classList.remove('hidden');
      setTimeout(function () { statusEl.classList.add('hidden'); }, 4000);
    }
    function copyText(text) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text).then(function () {
          showStatus('Текст скопирован — вставьте в чат (Ctrl+V).');
        });
      }
      showStatus(text);
      return Promise.resolve();
    }
    var okBtn = root.querySelector('.r7-feedback-ok');
    var retryBtn = root.querySelector('.r7-feedback-retry');
    if (okBtn) okBtn.addEventListener('click', function () { copyText(promptOk); });
    if (retryBtn) retryBtn.addEventListener('click', function () { copyText(promptRetry); });
  })();
  </script>
  <% } %>
</div>
<% } %>