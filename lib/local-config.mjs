export function localPorts(env = process.env) {
  function port(name, fallback) {
    const value = env[name] ?? String(fallback);
    if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535)
      throw new Error(`${name} must be an integer between 1 and 65535`);
    return Number(value);
  }
  const web = port('PIPELINE_WEB_PORT', 3000);
  const runner = port('PIPELINE_PORT', 4317);
  if (web === runner) throw new Error('Web and runner ports must differ');
  return { web, runner };
}
