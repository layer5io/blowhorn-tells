import { $ } from "./dom.js";

export function setupChallenge(state, renderRuntime) {
  const form = $("#challengeForm");
  const wrap = $("#challengeTableWrap");
  const status = $("#challengeStatus");
  const table = $("#challengeTable");

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    state.challenge.formSubmitted = true;
    state.challenge.submittedAtMs = Math.round(performance.now() - state.startedAt);

    if (window.confirm("Start the human check?")) {
      state.challenge.confirmAccepted = true;
      state.challenge.tableShown = true;
      wrap.classList.remove("hidden");
      status.textContent = "Match each target value, then verify the row.";
    }
    renderRuntime(state);
  });

  table.querySelectorAll("tbody tr").forEach((row) => {
    const button = row.querySelector("button");
    const input = row.querySelector("input");
    const probeName = row.cells[0]?.textContent || "Probe";
    const target = row.dataset.target || "";

    button.addEventListener("click", () => {
      if (button.dataset.updated === "1") return;
      if (input.value.trim() !== target) {
        status.textContent = `${probeName}: enter ${target} before verifying.`;
        input.focus();
        return;
      }

      button.dataset.updated = "1";
      button.textContent = "Verified";
      button.disabled = true;
      input.disabled = true;
      row.classList.add("is-verified");
      state.challenge.updatedRows += 1;
      state.challenge.lastUpdatedAtMs = Math.round(performance.now() - state.startedAt);
      const rowCount = table.querySelectorAll("tbody tr").length;
      if (state.challenge.updatedRows >= rowCount) {
        state.challenge.completed = true;
        status.textContent = "Human check complete. Run checks again to update the verdict.";
      } else {
        status.textContent = `${state.challenge.updatedRows} of ${rowCount} rows verified.`;
      }
      renderRuntime(state);
    });
  });
}
