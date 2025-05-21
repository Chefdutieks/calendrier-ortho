function getWeekStart(date) {
    const d = new Date(date);
    const day = d.getDay(); // 0 = dimanche
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // lundi
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
}
  
function getWeekKey(date) {
    const start = getWeekStart(date);
    return start.toISOString().slice(0, 10); // ex: "2025-05-20"
}

function groupByWeek(slots) {
    const weeks = {};
    for (const slot of slots) {
        const slotDate = new Date(`${slot.date.split("/").reverse().join("-")}T${slot.time}`);
        const key = getWeekKey(slotDate);
        if (!weeks[key]) weeks[key] = [];
        weeks[key].push(slot);
    }
    return weeks;
}
  
function getPrevious4WeeksRange(weekStart) {
    const end = new Date(weekStart);
    const start = new Date(weekStart);
    start.setDate(start.getDate() - 28);
    return { start, end };
}

function splitRangeByMonth(start, end) {
    const chunks = [];
    let current = new Date(start);
  
    while (current < end) {
      const year = current.getFullYear();
      const month = current.getMonth();
      const chunkStart = new Date(current);
      const chunkEnd = new Date(year, month + 1, 1); // début du mois suivant
  
      if (chunkEnd > end) chunkEnd.setTime(end.getTime());
  
      chunks.push({ start: new Date(chunkStart), end: new Date(chunkEnd) });
      current = new Date(chunkEnd);
    }
  
    return chunks;
  }
  

module.exports = { getWeekKey, groupByWeek, getPrevious4WeeksRange, splitRangeByMonth };
  