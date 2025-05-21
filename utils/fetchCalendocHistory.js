const { gqlRequest } = require("../delta-tracker"); // ou à extraire proprement
const { splitRangeByMonth } = require("./time");

const GRAPHQL_ENDPOINT = 'https://graphql.calendoc.com/graphql';


const CALENDAR_QUERY = `
  query fetchCalendarsByName($name: String!) {
    fetchCalendarsByName(name: $name) {
      id
      name
    }
  }
`;

const TIMESLOT_QUERY = `
  query FetchTimeslotsByTimeRange($startTimestamp: Long!, $endTimestamp: Long!, $calendarId: UUID!) {
    fetchTimeslotsByTimeRange(startTimestamp: $startTimestamp, endTimestamp: $endTimestamp, calendarId: $calendarId) {
      category {
        id
        name
      }
      startTimestamp
      endTimestamp
      calendar {
        id
        name
        ownerLogin
      }
    }
  }
`;

async function buildCalendarMap() {
  const data = await gqlRequest(CALENDAR_QUERY, { name: "ORTHOPTISTE" });
  const calendars = data.fetchCalendarsByName || [];

  const allIds = calendars.map(c => c.id);
  return { ALL: allIds };

}

async function fetchMotivesBetween(start, end, calendarIds) {
  let motives = [];
  for (const calendarId of calendarIds) {
    const ranges = splitRangeByMonth(start, end);
    for (const { start: s, end: e } of ranges) {
      const data = await gqlRequest(TIMESLOT_QUERY, {
        startTimestamp: s.getTime(),
        endTimestamp: e.getTime(),
        calendarId
      });

      const slots = data.fetchTimeslotsByTimeRange || [];
      for (const ts of slots) {
        const raw = ts.category?.name?.substring(0, 3) || "";
        const normalized = raw === "Pat" ? "SNC" : (raw === "Fer" ? "Fermé" : raw);
        if (["BSC", "SNC", "UNL"].includes(normalized)) {
          motives.push(normalized);
        }
      }
    }
  }
  return motives;
}

async function fetchCalendocSlotsWithMotifs(start, end, calendarIds) {
  const { splitRangeByMonth } = require("./time");
  const all = [];

  for (const calendarId of calendarIds) {
    for (const { start: s, end: e } of splitRangeByMonth(start, end)) {
      const data = await gqlRequest(TIMESLOT_QUERY, {
        startTimestamp: s.getTime(),
        endTimestamp: e.getTime(),
        calendarId
      });

      const slots = data.fetchTimeslotsByTimeRange || [];
      for (const ts of slots) {
        const raw = ts.category?.name?.substring(0, 3) || "";
        const normalized = raw === "Pat" ? "SNC" : (raw === "Fer" ? "Fermé" : raw);
        if (!["BSC", "SNC", "UNL"].includes(normalized)) continue;

        const startTS = new Date(ts.startTimestamp);
        const dateStr = startTS.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" });
        const timeStr = startTS.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Paris" });

        all.push({
          date: dateStr,
          time: timeStr,
          email: ts.calendar?.ownerLogin || "_",
          motive: normalized
        });
      }
    }
  }

  return all;
}

module.exports = {
  buildCalendarMap,
  fetchMotivesBetween,
  fetchCalendocSlotsWithMotifs
};



  