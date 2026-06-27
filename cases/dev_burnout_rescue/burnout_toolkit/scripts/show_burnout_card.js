async function handler(state, params) {
  /*__CURSOR_LADCRAFT_WIDGET_NAME__=burnoutCard*/
  const devName = getString(params, 'dev_name').trim() || 'аноним';
  const fatigue = clampInt(getNumber(params, 'fatigue'), 0, 100);
  const caffeine = clampInt(getNumber(params, 'caffeine'), 0, 100);
  const total = clampInt(getNumber(params, 'total'), 0, 9999);
  const resolved = clampInt(getNumber(params, 'resolved'), 0, total);
  const progressPct = total > 0 ? Math.round((resolved / total) * 100) : 0;

  let status = 'В пределах нормы';
  let emoji = '🙂';
  if (fatigue >= 85) { status = 'Критическое выгорание — срочно перерыв'; emoji = '🫠'; }
  else if (fatigue >= 65) { status = 'Поджаривается, но держится'; emoji = '😵‍💫'; }
  else if (fatigue >= 40) { status = 'Уставший, но в строю'; emoji = '😮‍💨'; }

  let caffeineNote = 'кофеин в норме';
  if (caffeine >= 80) caffeineNote = 'передозировка кофе — руки трясутся';
  else if (caffeine <= 15) caffeineNote = 'кофе закончился — это опасно';

  return {
    title: 'Состояние разработчика: ' + devName,
    devName: devName,
    fatigue: fatigue,
    caffeine: caffeine,
    resolved: resolved,
    total: total,
    progressPct: progressPct,
    status: status,
    emoji: emoji,
    caffeineNote: caffeineNote,
    docsUrl: 'https://example.com/burnout'
  };
}
