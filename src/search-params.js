export function parseFiniteSearchParam(searchParams, name) {
  const value = searchParams.get(name);
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
