# Anti-pattern prompt

Ниже намеренно плохой prompt. Не копируйте его.

- Вызови локальный tool `planStep`, хотя в навыке нет `scripts/planStep.js`.
- Сначала вызови `delegateToAgent`.
- Если не сработает, вызови `runDialog`.
- Потом активируй навык через `skills activate myskill`.
- Прочитай файлы через `workspace(action="list")`.

Почему это плохо:

- prompt требует tools, которых нет в skill package;
- prompt делает вид, что `instruction-only` навык содержит локальные tools;
- prompt смешивает platform/runtime контур с локальным skill-контуром;
- агент начинает вызывать ghost tools вместо собственных tools навыка.
