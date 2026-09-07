function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

const ISO_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-](\d{2}):(\d{2}))$/;

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year, month) {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function assertIsoDateTime(value, label) {
  const match = typeof value === "string" ? value.match(ISO_DATE_TIME_PATTERN) : null;
  if (!match) {
    throw new TypeError(`${label} must be an ISO date-time string`);
  }
  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    ,
    zone,
    offsetHourText,
    offsetMinuteText,
  ] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = zone === "Z" ? 0 : Number(offsetHourText);
  const offsetMinute = zone === "Z" ? 0 : Number(offsetMinuteText);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 14 ||
    offsetMinute > 59 ||
    (offsetHour === 14 && offsetMinute !== 0) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new TypeError(`${label} must be an ISO date-time string`);
  }
}

function assertNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer`);
  }
}

export function validateActivitySnapshot(snapshot) {
  assertObject(snapshot, "activity snapshot");
  if (!/^\d{4}-\d{2}$/.test(snapshot.month)) {
    throw new TypeError("activity snapshot month must be YYYY-MM");
  }
  assertIsoDateTime(snapshot.sourceUpdatedAt, "activity snapshot sourceUpdatedAt");
  if (!Array.isArray(snapshot.creators)) {
    throw new TypeError("activity snapshot creators must be an array");
  }
  if (snapshot.rowCount !== snapshot.creators.length) {
    throw new TypeError("activity snapshot rowCount must match creators.length");
  }

  const seen = new Set();
  for (const [index, creator] of snapshot.creators.entries()) {
    assertObject(creator, `activity creator ${index}`);
    if (typeof creator.accountKey !== "string" || !creator.accountKey.trim()) {
      throw new TypeError(`activity creator ${index} accountKey is required`);
    }
    if (seen.has(creator.accountKey)) {
      throw new TypeError(`activity creator accountKey is duplicated: ${creator.accountKey}`);
    }
    seen.add(creator.accountKey);
    assertNonNegativeInteger(creator.diamonds, `activity creator ${index} diamonds`);
    assertNonNegativeInteger(creator.effectiveLiveDays, `activity creator ${index} effectiveLiveDays`);
    assertNonNegativeInteger(creator.liveMinutes, `activity creator ${index} liveMinutes`);
  }
  return snapshot;
}


export function normalizeAccountKey(value) {
  let normalized = String(value).normalize("NFKC").trim();
  if (normalized.startsWith("@")) normalized = normalized.slice(1);
  return normalized.toLocaleLowerCase("und");
}

export function normalizeMonth(value) {
  const match = String(value).trim().match(/^(\d{4})[-/]?(\d{2})$/);
  if (!match) throw new TypeError(`month must be YYYY-MM or YYYYMM: ${value}`);
  const month = Number(match[2]);
  if (month < 1 || month > 12) throw new TypeError(`invalid month: ${value}`);
  return `${match[1]}-${match[2]}`;
}

function monthDays(month) {
  const [year, value] = month.split("-").map(Number);
  return new Date(Date.UTC(year, value, 0)).getUTCDate();
}

export function normalizeSnapshot(raw, monthOverride) {
  const snapshot = validateActivitySnapshot(raw);
  const month = normalizeMonth(snapshot.month);
  if (monthOverride && normalizeMonth(monthOverride) !== month) {
    throw new TypeError(`input month ${month} does not match requested month ${normalizeMonth(monthOverride)}`);
  }
  const seen = new Map();
  const creators = snapshot.creators.map((creator) => {
    const accountKey = normalizeAccountKey(creator.accountKey);
    if (!accountKey) throw new TypeError("accountKey must not be empty after normalization");
    if (seen.has(accountKey)) {
      throw new TypeError(`accountKey is duplicated after normalization: ${creator.accountKey}`);
    }
    seen.set(accountKey, creator.accountKey);
    if (creator.effectiveLiveDays > monthDays(month)) {
      throw new TypeError(
        `${creator.accountKey}.effectiveLiveDays exceeds the number of days in ${month}`,
      );
    }
    return { ...creator, accountKey };
  });
  return { ...snapshot, month, creators };
}


export const METRIC_KEYS = Object.freeze(['diamonds', 'effectiveLiveDays', 'liveMinutes']);

export function canonical(value) {
  if (Array.isArray(value)) {
    return JSON.stringify(value.map(item => JSON.parse(canonical(item))));
  }
  if (value && typeof value === 'object') {
    return JSON.stringify(Object.fromEntries(Object.keys(value).sort()
      .map(key => [key, JSON.parse(canonical(value[key]))])));
  }
  return JSON.stringify(value);
}

export function validateRequest(value) {
  if (!value || normalizeMonth(value.month) !== value.month
      || !Array.isArray(value.accountKeys) || !value.accountKeys.length
      || value.accountKeys.some(key => typeof key !== 'string')) {
    throw new TypeError('explicit month and account scope are required');
  }
  const accountKeys = value.accountKeys.map(normalizeAccountKey);
  if (accountKeys.some(key => !key) || new Set(accountKeys).size !== accountKeys.length) {
    throw new TypeError('account scope is empty or duplicated');
  }
  return { month: value.month, accountKeys };
}

export function validateSelection(value, requireWrite = false) {
  if (!value || ['readBinding', 'targetBinding'].some(key => typeof value[key] !== 'string' || !value[key])
      || (requireWrite && (typeof value.writeBinding !== 'string' || !value.writeBinding))) {
    throw new TypeError('explicit selection binding is required');
  }
  return structuredClone(value);
}

export function assertSelection(actual, expected, requireWrite = false) {
  validateSelection(actual, requireWrite);
  validateSelection(expected, requireWrite);
  if (canonical(actual) !== canonical(expected)) {
    throw new TypeError('destination selection does not match expected binding');
  }
}

export function validateMetrics(value, nullable = false) {
  if (!value || Object.keys(value).length !== METRIC_KEYS.length
      || METRIC_KEYS.some(key => !(nullable && value[key] === null)
        && (!Number.isSafeInteger(value[key]) || value[key] < 0))) {
    throw new TypeError('monthly metrics are invalid');
  }
  return value;
}

export function validateChanges(changes) {
  if (!Array.isArray(changes) || changes.length > 200
      || new Set(changes.map(row => row?.recordId)).size !== changes.length) {
    throw new TypeError('change count or record identity is invalid');
  }
  for (const row of changes) {
    if (!row || Object.keys(row).sort().join(',') !== 'accountKey,current,desired,recordId'
        || typeof row.recordId !== 'string' || !row.recordId
        || typeof row.accountKey !== 'string' || !row.accountKey) {
      throw new TypeError('change fields or identity are invalid');
    }
    validateMetrics(row.current, true);
    validateMetrics(row.desired);
  }
  return changes;
}
