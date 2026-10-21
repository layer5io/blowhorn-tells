export function isJsonSafeValue(value) {
  const type = typeof value;
  return value == null || type === "string" || type === "number" || type === "boolean" || Array.isArray(value) || type === "object";
}
