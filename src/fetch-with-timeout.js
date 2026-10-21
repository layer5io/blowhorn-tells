// AbortSignal.timeout keeps the deadline in force while the caller reads the body,
// so a provider that sends headers and then stalls cannot hang the request.
export function fetchWithTimeout(url, options = {}, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  return fetch(url, { ...options, signal });
}
