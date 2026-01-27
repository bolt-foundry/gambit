export function shouldRunLiveTests(): boolean {
  return Deno.env.get("GAMBIT_RUN_LIVE_TESTS") === "1";
}

export function getEnvValue(...keys: Array<string>): string | undefined {
  for (const key of keys) {
    const value = Deno.env.get(key);
    if (value && value.trim()) return value.trim();
  }
  return undefined;
}
