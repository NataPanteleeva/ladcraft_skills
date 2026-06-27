/**
 * Reference only: publish-layer handler.
 * Не копируйте этот файл как стартовый шаблон в <skills-root>/<skill>/scripts/*.js.
 */

async function handler(state, params) {
  const appEnv = state?.environment?.app ?? {};
  const userEnv = state?.environment?.user ?? {};

  if (!params || typeof params !== 'object') {
    return { ok: false, error: 'INVALID_PARAMS' };
  }

  return {
    ok: true,
    message: typeof params.message === 'string' ? params.message : '',
    appBaseUrl: typeof appEnv.BASE_URL === 'string' ? appEnv.BASE_URL : '',
    prefix: typeof userEnv.GREETING_PREFIX === 'string' ? userEnv.GREETING_PREFIX : ''
  };
}
