export function redactUrlSecrets(rawUrl) {
  const url = new URL(rawUrl);
  for (const key of [...url.searchParams.keys()]) {
    if (/token|key|secret|pass|auth/i.test(key)) url.searchParams.set(key, "[redacted]");
  }
  return url.toString();
}
