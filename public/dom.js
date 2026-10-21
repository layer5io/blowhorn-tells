export function $(selector, root = document) {
  return root.querySelector(selector);
}
