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

export function failureVoice(message) {
  return {
    ...VERDICTS.pending,
    label: "Failed",
    title: "Inspection failed.",
    line: `${message} Run the inspection again.`,
    figure: FIGURES.inspector
  };
}
