// Who a Commons photo is credited to (pipeline/lib/commons.mjs commonsAuthor). Replays 2026-11-27: two CC BY 4.0
// photos of CAT-1FUKQNM (Hydroproject building, Moscow) were credited to "missing name", the text Commons renders
// for a {{Creator}} template with a broken Wikidata link; one more was credited to "Own work".
import test from 'node:test'
import assert from 'node:assert/strict'
import { commonsAuthor, fileInfo, fileRecord } from '../pipeline/lib/commons.mjs'
import { commonsCandidate } from '../pipeline/lib/images.mjs'

const FILE = '20250816 Gidroproekt (41652).jpg'
const page = (title, { artist = 'missing name', credit = 'Own work', user = 'Sergey A. Demidov' } = {}) => ({
  title: 'File:' + title,
  imageinfo: [{
    url: 'https://upload.wikimedia.org/wikipedia/commons/b/b9/x.jpg', thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b9/x.jpg/330px-x.jpg',
    width: 2242, height: 3361, size: 2845586, mime: 'image/jpeg', sha1: 'a', timestamp: '2025-08-16T10:09:51Z', ...(user ? { user } : {}),
    extmetadata: { Artist: { value: artist }, Credit: { value: credit }, LicenseShortName: { value: 'CC BY 4.0' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by/4.0' } },
  }],
  templates: [],
})

test('commons author: a placeholder Artist or Credit is no name; the uploader is credited instead', () => {
  assert.equal(commonsAuthor({ artist: 'missing name', credit: 'Own work', user: 'Sergey A. Demidov' }), 'Sergey A. Demidov')
  assert.equal(commonsAuthor({ artist: 'Missing  name ', credit: null, user: 'Uploader' }), 'Uploader')
  assert.equal(commonsAuthor({ artist: null, credit: 'Own work', user: null }), null)
  // A real Artist or a Credit that names someone keeps its place before the uploader.
  assert.equal(commonsAuthor({ artist: 'Elena Weisz', credit: 'Own work', user: 'EW' }), 'Elena Weisz')
  assert.equal(commonsAuthor({ artist: null, credit: 'Photo: Jan Beránek', user: 'JB' }), 'Photo: Jan Beránek')
  // Statements about the work are not placeholders.
  assert.equal(commonsAuthor({ artist: 'Unknown author', user: 'Uploader' }), 'Unknown author')
  assert.equal(commonsAuthor({ artist: 'Anonymous', user: 'Uploader' }), 'Anonymous')
})

test('commons candidate: the CAT-1FUKQNM photo is credited to its uploader, never to "missing name"', () => {
  const c = commonsCandidate(fileRecord(FILE, page(FILE)), { kr_fop: false })
  assert.deepEqual([c.author, c.rights_holder, c.attribution], ['Sergey A. Demidov', 'Sergey A. Demidov', 'Sergey A. Demidov · CC BY 4.0 · Wikimedia Commons'])
  // No name anywhere: the existing neutral credit, not the placeholder.
  const none = commonsCandidate(fileRecord(FILE, page(FILE, { user: null })), { kr_fop: false })
  assert.equal(none.author, 'Wikimedia Commons 기여자')
})

test('file info: only cached records with no name to credit and no uploader field are fetched again', async () => {
  const cachedBefore = ({ user, ...rec }) => rec // a record from before the uploader was fetched
  const store = new Map([
    // Cached before, with a placeholder name: fetched again.
    [FILE, cachedBefore(fileRecord(FILE, page(FILE)))],
    // Cached before, with a real name: kept.
    ['Named.jpg', cachedBefore(fileRecord('Named.jpg', page('Named.jpg', { artist: 'Elena Weisz' })))],
    // Fetched with the uploader field already (none given): kept, not fetched on every run.
    ['NoUser.jpg', fileRecord('NoUser.jpg', page('NoUser.jpg', { user: null }))],
  ])
  const cache = { fresh: (ns, k) => store.get(k), any: (ns, k) => store.get(k), set: (ns, k, v) => store.set(k, v) }
  const asked = []
  const client = { json: async (url) => { const titles = new URL(url).searchParams.get('titles').split('|'); asked.push(...titles); assert.match(new URL(url).searchParams.get('iiprop'), /\buser\b/); return { query: { pages: titles.map((t) => page(t.replace(/^File:/, ''))) } } } }
  const out = await fileInfo(client, [FILE, 'Named.jpg', 'NoUser.jpg'], { cache })
  assert.deepEqual(asked.map((t) => t.replace(/^File:/, '').replace(/_/g, ' ')), [FILE])
  assert.equal(out.get(FILE).user, 'Sergey A. Demidov')
  assert.equal(commonsAuthor(out.get(FILE)), 'Sergey A. Demidov')
  assert.equal(commonsAuthor(out.get('Named.jpg')), 'Elena Weisz')
})
