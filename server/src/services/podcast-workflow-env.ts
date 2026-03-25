type EnvLike = NodeJS.ProcessEnv;

function readEnvValue(env: EnvLike, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) {
      return value;
    }
  }
  return null;
}

export function resolvePodcastWorkflowPythonBin(env: EnvLike = process.env): string {
  // Keep legacy podcast aliases readable in one place while generic Paperclip
  // names remain the primary interface going forward.
  return readEnvValue(env, "PAPERCLIP_PYTHON_BIN", "RU_PYTHON_BIN", "PYTHON_BIN") ?? "python3";
}

export function resolvePodcastWorkflowDefaultChannelUrl(
  env: EnvLike = process.env,
): string | null {
  return readEnvValue(
    env,
    "PAPERCLIP_PODCAST_DEFAULT_CHANNEL_URL",
    "RU_YOUTUBE_CHANNEL_URL",
  );
}
