import { $ } from "./dom.js";

export function setupButtons(state, runChecks, setStatus) {
  $("#runBtn").addEventListener("click", () => runChecks(state));
  $("#copyBtn").addEventListener("click", async () => {
    if (!state.report) return;
    await navigator.clipboard.writeText(JSON.stringify(state.report, null, 2));
    setStatus("JSON copied.");
  });
  $("#downloadBtn").addEventListener("click", () => {
    if (!state.report) return;
    const blob = new Blob([JSON.stringify(state.report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `amiabot-report-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
}
