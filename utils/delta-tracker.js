const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const dotenv = require("dotenv");
const db = require("./firestore");
dotenv.config();

const GRAPHQL_ENDPOINT = 'https://graphql.calendoc.com/graphql';
const VARIABLES = {
  login: process.env.CALENDOC_LOGIN,
  password: process.env.CALENDOC_PASSWORD,
  groupId: process.env.CALENDOC_GROUP_ID
};

// ————————————————————————————————————————
// 🔐 JWT + requêtes GraphQL
const AUTH_QUERY = `
  query Authenticate($login: String!, $password: String!, $groupId: String!) {
    authenticate(login: $login, password: $password, groupId: $groupId) {
      jwt
    }
  }
`;

async function getJwt() {
  const res = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: AUTH_QUERY, variables: VARIABLES })
  });
  const { data, errors } = await res.json();
  if (errors) throw new Error("JWT auth error: " + JSON.stringify(errors));
  return data.authenticate.jwt;
}

async function gqlRequest(query, variables = {}) {
  const token = await getJwt();
  const res = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": token
    },
    body: JSON.stringify({ query, variables })
  });
  const { data, errors } = await res.json();
  if (errors?.length) throw new Error(errors.map(e => e.message).join(', '));
  return data;
}

// ————————————————————————————————————————
// 📅 Fetch Calendars & Timeslots
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
      creationTimestamp
      id
      label
      category {
        id
        name
      }
      calendar {
        id
        name
        ownerLogin
      }
      startTimestamp
      endTimestamp
    }
  }
`;

async function fetchCalendars(substring) {
  const data = await gqlRequest(CALENDAR_QUERY, { name: substring });
  return data.fetchCalendarsByName.map(c => c.id);
}

async function fetchTimeslots(startTS, endTS, calendarId) {
  const data = await gqlRequest(TIMESLOT_QUERY, { startTimestamp: startTS, endTimestamp: endTS, calendarId });
  return data.fetchTimeslotsByTimeRange.map(ts => {
    const start = new Date(ts.startTimestamp);
    const end = new Date(ts.endTimestamp);
    const motive = ts.category?.name?.substring(0, 3) || "";
    const normalized = motive === "Pat" ? "SNC" : (motive === "Fer" ? "Fermé" : motive);

    return {
      timeslotID: ts.id,
      calendarID: ts.calendar?.id,
      email: ts.calendar?.ownerLogin,
      motive: normalized,
      creationTimestamp: ts.creationTimestamp,
      startTS: start,
      endTS: end,
      date: start.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' }),
    };
  }).filter(s => ["SNC", "UNL", "BSC", "Fermé"].includes(s.motive));
}

// ————————————————————————————————————————
// 🔁 Générer plages de N mois à partir du mois actuel
function getMonthRanges(count = 3) {
  const now = new Date();
  const baseMonth = now.getMonth();
  const baseYear = now.getFullYear();

  const ranges = [];

  for (let offset = 0; offset < count; offset++) {
    const month = (baseMonth + offset) % 12;
    const year = baseYear + Math.floor((baseMonth + offset) / 12);

    const startDate = new Date(year, month, 1, 0, 0, 0);
    const endDate = new Date(year, month + 1, 1, 0, 0, 0);
    ranges.push({ startDate, endDate });
  }

  return ranges;
}

// ————————————————————————————————————————
// 🧠 Fusion et chevauchement

function mergeTimeslotsWithMotives(slotA, slotB) {
  const merged = {
    email: slotA.email,
    calendarID: slotA.calendarID,
    timeslotID: slotA.timeslotID,
    startTS: new Date(Math.min(slotA.startTS, slotB.startTS)),
    endTS: new Date(Math.max(slotA.endTS, slotB.endTS)),
    creationTimestamp: Math.max(slotA.creationTimestamp, slotB.creationTimestamp),
  };
  merged.startDatetime = merged.startTS.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
  merged.endDatetime = merged.endTS.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
  merged.date = merged.startTS.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' });

  merged.motives = {};

  const accumulate = (motive, duration) => {
    if (!merged.motives[motive]) merged.motives[motive] = 0;
    merged.motives[motive] += duration;
  };

  const duration = s => (s.endTS - s.startTS) / (1000 * 60 * 60);
  for (const s of [slotA, slotB]) {
    const motives = s.motives || { [s.motive]: duration(s) };
    for (const [m, d] of Object.entries(motives)) accumulate(m, d);
  }

  return merged;
}

function resolveOverlaps(slots) {
  const result = [];
  const sorted = slots.sort((a, b) => a.startTS - b.startTS);

  for (const slot of sorted) {
    const last = result[result.length - 1];

    const isOverlappingOrConsecutive =
    last &&
    slot.email === last.email &&
    slot.startTS <= last.endTS;

    if (isOverlappingOrConsecutive) {
      result[result.length - 1] = mergeTimeslotsWithMotives(last, slot);
    } else {
      slot.startDatetime = slot.startTS.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
      slot.endDatetime = slot.endTS.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
      slot.date = slot.startTS.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' });
      slot.motives = { [slot.motive]: (slot.endTS - slot.startTS) / (1000 * 60 * 60) };
      result.push(slot);
    }
  }
  return result;
}

// ————————————————————————————————————————
// 🔥 Firestore data
async function fetchFirestoreConfirmedSlots() {
  const ranges = getMonthRanges(3);
  const snapshots = await Promise.all(
    ranges.map(({ startDate, endDate }) =>
      db.collection("bookings-ortho")
        .where("event", "==", "Confirmed")
        .where("dateTime", ">=", startDate)
        .where("dateTime", "<", endDate)
        .get()
    )
  );

  return snapshots.flatMap(snapshot =>
    snapshot.docs.map(doc => {
      const d = doc.data();
      return {
        email: d.email,
        date: d.date,
        time: d.time,
        dateKey: `${d.date} ${d.time} ${d.email}`
      };
    })
  );
}

// ————————————————————————————————————————
// 📆 Normalisation par pas de 30 minutes
function normalizeTo30MinKeys(slots) {
  const keys = new Set();
  const grouped = {};

  for (const s of slots) {
    if (!grouped[s.date]) grouped[s.date] = [];
    grouped[s.date].push(s);
  }

  for (const date in grouped) {
    const group = grouped[date].sort((a, b) => a.startTS - b.startTS);
    for (const slot of group) {
      let current = new Date(slot.startTS);
      while (current < slot.endTS) {
        const timeKey = current.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Paris' });
        keys.add(`${slot.date} ${timeKey} ${slot.email}`);
        current = new Date(current.getTime() + 30 * 60 * 1000);
      }
    }
  }

  return keys;
}

// ————————————————————————————————————————
// 🚀 Main
async function getMissingSlots() {
  const calendarIds = await fetchCalendars("ORTHOPTISTE");
  const ranges = getMonthRanges(3);

  let allRawSlots = [];

  for (const { startDate, endDate } of ranges) {
    for (const calendarId of calendarIds) {
      const timeslots = await fetchTimeslots(startDate.getTime(), endDate.getTime(), calendarId);
      allRawSlots.push(...timeslots);
    }
  }

  const groupedByEmail = {};
  for (const slot of allRawSlots) {
    if (!groupedByEmail[slot.email]) groupedByEmail[slot.email] = [];
    groupedByEmail[slot.email].push(slot);
  }

  const resolved = Object.values(groupedByEmail).flatMap(resolveOverlaps);
  const calendocKeys = normalizeTo30MinKeys(resolved);
  const firestoreSlots = await fetchFirestoreConfirmedSlots();
  const firestoreKeys = new Set(firestoreSlots.map(s => s.dateKey));

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const missingInCalendoc = [...firestoreKeys].filter(key => {
    if (calendocKeys.has(key)) return false;
    const [dateStr] = key.split(" ");
    const [day, month, year] = dateStr.split("/").map(Number);
    const slotDate = new Date(year, month - 1, day);
    return slotDate >= today;
  });

  return missingInCalendoc.map(key => {
    const [date, time, email] = key.split(" ");
    return { date, time, email };
  });
}

module.exports = {getMissingSlots,gqlRequest};