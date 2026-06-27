async function handler(state, params) {
  const userEnv = asObject(state) && asObject(state.environment) ? asObject(state.environment.user) : null;
  const toxicity = (userEnv && typeof userEnv.TOXICITY_LEVEL === 'string' && userEnv.TOXICITY_LEVEL.trim()
    ? userEnv.TOXICITY_LEVEL.trim().toLowerCase()
    : 'normal');
  const envName = userEnv && typeof userEnv.DEV_NAME === 'string' ? userEnv.DEV_NAME.trim() : '';

  const name = getString(params, 'dev_name').trim() || envName || 'друг';
  const topic = getString(params, 'topic').trim() || 'general';

  const tips = {
    general: 'Закрой 20 вкладок, выпей воды, разбей задачу на одну маленькую.',
    bug: 'Воспроизведи баг минимально, потом читай stack trace снизу вверх.',
    legacy: 'Не переписывай всё сразу — обложи кусок тестами и режь по краям.',
    deadline: 'Сократи скоуп, а не сон. Скажи о риске сегодня, а не в день дедлайна.',
    impostor_syndrome: 'Все вокруг гуглят то же самое. Ты не самозванец, ты — практик.',
    meeting_overload: 'Половину встреч можно заменить тредом. Защити 2 часа фокуса в день.',
    merge_hell: 'Мерж чаще и мельче. Большой PR — это будущий конфликт с самим собой.'
  };
  const base = typeof tips[topic] === 'string' ? tips[topic] : tips.general;

  let tone = '';
  let tip = base;
  if (toxicity === 'gentle') {
    tone = 'gentle';
    tip = name + ', ты молодец, что держишься. Мягкий совет: ' + base + ' Один шаг за раз.';
  } else if (toxicity === 'roast') {
    tone = 'roast';
    tip = name + ', хватит страдать в чате — ' + base.toLowerCase() + ' И коммить уже, наконец.';
  } else {
    tone = 'normal';
    tip = name + ', держи совет: ' + base;
  }

  return { ok: true, topic: topic, tone: tone, tip: tip };
}
