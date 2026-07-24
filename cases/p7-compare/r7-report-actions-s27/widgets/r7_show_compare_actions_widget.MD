---
name: r7_show_compare_actions_widget
description: Кнопки действий с отчётом сравнения для плагина R7.
schema:
  type: object
  additionalProperties: false
  required:
    - ok
  properties:
    ok:
      type: boolean
    show_widget:
      type: boolean
---

<style>
  .r7-compare-actions {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    margin-top: 4px;
    max-width: 320px;
  }
  .r7-compare-actions-title {
    font-size: 12px;
    font-weight: 600;
    color: #64748b;
    margin: 0 0 8px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .r7-compare-actions-row {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .r7-compare-actions button {
    appearance: none;
    border: 1px solid #cbd5e1;
    background: #f8fafc;
    color: #0f172a;
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 13px;
    line-height: 1.2;
    cursor: pointer;
    width: 100%;
    box-sizing: border-box;
    text-align: left;
  }
  .r7-compare-actions button:hover {
    background: #e2e8f0;
    border-color: #94a3b8;
  }
  .r7-compare-actions button.primary {
    background: #1e293b;
    border-color: #1e293b;
    color: #fff;
  }
  .r7-compare-actions button.primary:hover {
    background: #334155;
    border-color: #334155;
  }
</style>
<div class="r7-compare-actions">
  <p class="r7-compare-actions-title">Действия с отчётом</p>
  <div class="r7-compare-actions-row">
    <button type="button" class="primary" data-value="вставить">Вставить отчёт в документ</button>
    <button type="button" data-value="скачать md">Скачать отчёт (в формате md)</button>
    <button type="button" data-value="скачать html">Скачать отчёт (в формате html)</button>
    <button type="button" data-value="сохранить на диск">Сохранить отчёт на Р7-Диск в формате docx</button>
  </div>
</div>
