const FIGURES = {
  inspector: { src: "/assets/brand/sleeper-cell-base.webp", alt: "Sleeper Cell, the unit's privacy scout, sweeping for bots with a radar" },
  bot: { src: "/assets/brand/robo-recruit.webp", alt: "Robo-Recruit, a wind-up tin-can chicken, saluting" }
};

const VERDICTS = {
  pending: {
    label: "Inspecting",
    title: "Hold still, recruit.",
    line: "Inspection in progress.",
    figure: "inspector"
  },
  likely_human: {
    label: "Human",
    title: "At ease. You pass inspection.",
    line: "Nothing here reads as a bot. Boots could use a polish.",
    figure: "inspector"
  },
  suspicious: {
    label: "Suspicious",
    title: "Fall in. A few tells showed.",
    line: "Some signals disagree. Fix the first one under Top signals, then run it again.",
    figure: "inspector"
  },
  likely_bot: {
    label: "Bot",
    title: "Busted. You read as a bot.",
    line: "Every tell is listed under Top signals. Robo-Recruit sends his regards.",
    figure: "bot"
  }
};

export function verdictVoice(classification) {
  const voice = VERDICTS[classification] || VERDICTS.pending;
  return { ...voice, figure: FIGURES[voice.figure] };
}

// The verdict card's one-word readout. Keys match the classification the server returns
// (score 75 and up is likely_human, 45 to 74 suspicious, under 45 likely_bot; see src/report-verdict.js).
const VERDICT_WORDS = {
  pending: "In progress",
  likely_human: "Looks human",
  suspicious: "Hard to tell",
  likely_bot: "Looks like a bot"
};

export function verdictWord(classification) {
  return VERDICT_WORDS[classification] || VERDICT_WORDS.pending;
}

export function failureVoice(message) {
  return {
    ...VERDICTS.pending,
    label: "Failed",
    title: "Inspection failed.",
    line: `${message} Run the inspection again.`,
    figure: FIGURES.inspector
  };
}
