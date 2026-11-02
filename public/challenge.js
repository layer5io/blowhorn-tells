import { buildInteractionReport, INTERACTION_PHRASE, readFieldFacts } from "./collect-interaction.js";
import { validateInteractionReport } from "./generated/validate-interaction-report.js";
import { $ } from "./dom.js";
import { discardSubmitAttempt } from "./runtime.js";

// The interaction test: Start, type the fixed phrase, Submit. The three elements carry
// data-tells-target so the capture in runtime.js and any harness can find them.
export function setupChallenge(state, renderRuntime, runChecks) {
  const startButton = $('[data-tells-target="start"]');
  const field = $('[data-tells-target="phrase"]');
  const submitButton = $('[data-tells-target="submit"]');
  const status = $("#challengeStatus");
  const nowMs = () => Math.round(performance.now() - state.startedAt);

  startButton.addEventListener("click", () => {
    if (state.interaction.startMs !== null) return;
    state.interaction.startMs = nowMs();
    field.disabled = false;
    status.textContent = `Click the field, type ${INTERACTION_PHRASE}, then press Submit.`;
    renderRuntime(state);
  });

  submitButton.addEventListener("click", () => {
    if (state.interaction.endMs !== null) return;
    if (state.interaction.startMs === null) {
      discardSubmitAttempt(state);
      status.textContent = "Press Start first.";
      return;
    }
    // Lost events leave a hole in the chains, so the run is not scored at all. Reloading starts a clean buffer.
    if (state.interaction.dropped > 0) {
      status.textContent = "Too many events were recorded to score this run. Reload the page and try again.";
      return;
    }
    const facts = readFieldFacts(field);
    if (!facts.valueMatches) {
      discardSubmitAttempt(state);
      status.textContent = `Type ${INTERACTION_PHRASE} exactly, then press Submit.`;
      return;
    }

    const endMs = nowMs();
    state.interaction.endMs = endMs;
    const report = buildInteractionReport(state.interaction.events, {
      ...facts,
      startMs: state.interaction.startMs,
      endMs,
      completed: true,
      fullscreen: Boolean(document.fullscreenElement)
    });
    if (!validateInteractionReport(report)) {
      state.interaction.endMs = null;
      discardSubmitAttempt(state);
      status.textContent = "The interaction test could not be scored in this browser.";
      return;
    }

    state.interaction.report = report;
    // Kept for external harnesses (an external Rust runner reads it). Remove it only once a replacement read path exists.
    window.__tellsInteraction = report;
    field.disabled = true;
    submitButton.disabled = true;
    status.textContent = "Interaction test complete. Checking the verdict now.";
    renderRuntime(state);
    // Intentional: the checks run on their own after Submit, so the verdict needs no extra press.
    runChecks(state).then((scored) => {
      if (scored === false) status.textContent = "The verdict could not be scored. Press Run the inspection to send the interaction test again.";
    });
  });
}
