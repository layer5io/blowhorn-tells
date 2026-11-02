import { buildInteractionReport, INTERACTION_PHRASE, readFieldFacts } from "./collect-interaction.js";
import { validateInteractionReport } from "./generated/validate-interaction-report.js";
import { $ } from "./dom.js";

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
    state.challenge.started = true;
    status.textContent = `Click the field, type ${INTERACTION_PHRASE}, then press Submit.`;
    renderRuntime(state);
  });

  submitButton.addEventListener("click", () => {
    if (state.interaction.endMs !== null) return;
    if (state.interaction.startMs === null) {
      status.textContent = "Press Start first.";
      return;
    }
    const facts = readFieldFacts(field);
    if (!facts.valueMatches) {
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
      status.textContent = "The interaction test could not be scored in this browser.";
      return;
    }

    state.interaction.report = report;
    window.__tellsInteraction = report;
    state.challenge.completed = true;
    state.challenge.completedAtMs = endMs;
    field.disabled = true;
    submitButton.disabled = true;
    status.textContent = "Interaction test complete. Checking the verdict now.";
    renderRuntime(state);
    runChecks(state);
  });
}
