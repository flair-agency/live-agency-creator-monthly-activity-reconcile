import { validateActivitySnapshot } from '@flair-agency/backstage-provider/contracts/activity';
import { normalizeAccountKey, normalizeMonth } from '@flair-agency/lark-base-provider/contracts/creator-activity';
export { validateActivitySnapshot } from '@flair-agency/backstage-provider/contracts/activity';
export { normalizeAccountKey, normalizeMonth, METRIC_KEYS, canonical, validateRequest,
  validateSelection, assertSelection, validateMetrics, validateChanges
} from '@flair-agency/lark-base-provider/contracts/creator-activity';

// Business normalization and the requested-month/calendar constraints stay here.
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
