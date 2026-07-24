async function handler(state, params) {
  const userEnv = state?.environment?.user ?? {};
  const message =
    typeof params?.message === 'string' && params.message.trim()
      ? params.message.trim()
      : 'hello';

  return {
    ok: true,
    message,
    prefix: typeof userEnv.GREETING_PREFIX === 'string' ? userEnv.GREETING_PREFIX : ''
  };
}
