import { $ } from "./dom.js";

export function setupButtons(state, runChecks, setStatus) {
  const panels = [...document.querySelectorAll(".masonry > details.panel")];
  const expandAllBtn = $("#expandAllBtn");
  const collapseAllBtn = $("#collapseAllBtn");
  function updatePanelButtons() {
    const allExpanded = panels.every((panel) => panel.open);
    const allCollapsed = panels.every((panel) => !panel.open);

    if (expandAllBtn) expandAllBtn.disabled = allExpanded;
    if (collapseAllBtn) collapseAllBtn.disabled = allCollapsed;
  }

  expandAllBtn?.addEventListener("click", () => {
    panels.forEach((panel) => { panel.open = true; });
    updatePanelButtons();
  });

  collapseAllBtn?.addEventListener("click", () => {
    panels.forEach((panel) => { panel.open = false; });
    updatePanelButtons();
  });

  panels.forEach((panel) => {
    panel.addEventListener("toggle", updatePanelButtons);
  });

  // A link that names a closed section (an explainer page sending the reader
  // back to one panel) opens that section instead of landing on a shut panel.
  const named = window.location.hash && document.querySelector(window.location.hash);
  if (named?.tagName === "DETAILS") named.open = true;

  updatePanelButtons();

  $("#runBtn").addEventListener("click", () => runChecks(state));
  $("#copyBtn").addEventListener("click", async () => {
    if (!state.report) return;
    await navigator.clipboard.writeText(JSON.stringify(state.report, null, 2));
    setStatus("Report copied as JSON.");
  });
  $("#downloadBtn").addEventListener("click", () => {
    if (!state.report) return;
    const blob = new Blob([JSON.stringify(state.report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `blowhorn-tells-report-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
}
