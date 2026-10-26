// Names that are never a project, whatever source or category led to them (docs/PIPELINE.md "Never a project"):
// date categories ("April 2017 in Daegu", "2017 in Seoul", "Seoul in April 2017", "Events in Seoul in the 2010s") and
// Wikimedia community events (editathons, hackathons, Wiki Loves…). Class-based checks (administrative territorial
// entities, settlements, edit-a-thons) are in config/classes.json (blocklist entries with "subclasses": true).

const MONTH = '(?:january|february|march|april|may|june|july|august|september|october|november|december)'
const YEAR = '(?:1[5-9]\\d\\d|20\\d\\d)'
const DECADE = '(?:1[5-9]\\d0s|20\\d0s)'
const DAY = '(?:[0-3]?\\d)'
// Each pattern is anchored on the whole name (without "Category:").
const DATE_PATTERNS = [
  [`^${MONTH} ${YEAR}(?: in .+)?$`, 'month_year'], // April 2017, April 2017 in Daegu
  [`^(?:${DAY} )?${MONTH}(?: ${DAY})?,? ${YEAR}(?: in .+)?$`, 'day'], // 5 April 2017 in Seoul, April 5, 2017
  [`^(?:${YEAR}|${DECADE}|the ${DECADE}) in .+$`, 'year_in_place'], // 2017 in Daegu, 2010s in Seoul
  [`^.+ in (?:the )?(?:${MONTH} )?(?:${YEAR}|${DECADE})$`, 'place_in_date'], // Seoul in April 2017, Events in Seoul in the 2010s
  [`^.+ (?:on|in) (?:${DAY} )?${MONTH}(?: ${DAY})?,? ${YEAR}$`, 'place_on_day'], // Gwanghwamun on 5 April 2017
  [`^(?:${MONTH} )?(?:${YEAR}|${DECADE}) (?:events|festivals|exhibitions|photographs|photos|images|pictures|works|nights?)\\b`, 'dated_set'], // 2017 events in South Korea
  [`^(?:${YEAR}|${DECADE})$`, 'bare_year'],
  [`^(?:${MONTH}|${YEAR}|${DECADE})\\b.* by (?:day|month|year|date)$`, 'by_date'],
].map(([p, reason]) => ({ re: new RegExp(p, 'iu'), reason }))

// Wikimedia community events and projects: never light projects.
export const WIKIMEDIA_EVENT = /\b(?:wikimedia|wikipedia|wikidata|wikimania|wikiproject|wiki ?loves|wiki ?takes|edit-?a-?thons?|editathons?|hackathons?|wikiexpedition|photo ?walk)\b|위키(?:미디어|백과|데이터)|에디터톤|편집(?:대회|마라톤)|해커톤/iu

const clean = (s) => String(s || '').replace(/^Category:/, '').replace(/_/g, ' ').trim()

/** The date pattern a name matches ("April 2017 in Daegu" → 'month_year'), or null. */
export function dateNameReason(name) {
  const n = clean(name)
  if (!n) return null
  return DATE_PATTERNS.find((p) => p.re.test(n))?.reason ?? null
}
export const isDateName = (name) => dateNameReason(name) !== null
export const isWikimediaEvent = (name) => WIKIMEDIA_EVENT.test(clean(name))

/** Why a name is never a project ('date_category:<rule>' | 'wikimedia_event'), or null. */
export function notProjectName(name) {
  if (isWikimediaEvent(name)) return 'wikimedia_event'
  const d = dateNameReason(name)
  return d ? 'date_category:' + d : null
}
