const fs = require("fs");
const path = require("path");
const { parseSlotDatetime } = require("./distribution");

function getMonthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function summarizeMotifsByMonth(slots) {
  const stats = {};

  for (const slot of slots) {
    const dt = parseSlotDatetime(slot);
    const month = getMonthKey(dt);
    const m = slot.assignedMotive || slot.motive;

    if (!["BSC", "SNC", "UNL"].includes(m)) continue;

    if (!stats[month]) stats[month] = { BSC: 0, SNC: 0, UNL: 0, total: 0 };
    stats[month][m]++;
    stats[month].total++;
  }

  return stats;
}

function logMotifSummaryPerMonth(slots) {
  const logPath = path.join(__dirname, "../logs/repartition.log");
  const stats = summarizeMotifsByMonth(slots);

  let output = "📊 Répartition des motifs par mois :\n";

  for (const month of Object.keys(stats).sort()) {
    const { BSC, SNC, UNL, total } = stats[month];
    const pct = (x) => total ? `${((x / total) * 100).toFixed(1)}%` : "0.0%";
    output += `\n🗓️ Mois ${month}\n`;
    output += `• BSC : ${BSC} (${pct(BSC)})\n`;
    output += `• SNC : ${SNC} (${pct(SNC)})\n`;
    output += `• UNL : ${UNL} (${pct(UNL)})\n`;
  }

  fs.appendFileSync(logPath, output + "\n");
  console.log("📝 Log écrit dans logs/repartition.log");
}

module.exports = { logMotifSummaryPerMonth };
