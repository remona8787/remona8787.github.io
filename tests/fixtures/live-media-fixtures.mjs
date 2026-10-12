// Response shapes of the Wikidata Query Service (SPARQL JSON) and the Commons API (formatversion=2),
// used by unit tests (tests/live-media.test.mjs) and browser tests (qa/live-media.spec.mjs).

// rows: [name, lang, qid, imageFile?, wktPoint?, website?, commonsCategory?]
export function wdqs(rows) {
  return {
    head: { vars: ['name', 'item', 'image', 'cat', 'site', 'coord'] },
    results: {
      bindings: rows.map(([name, lang, qid, image, coord, site, cat]) => ({
        name: { 'xml:lang': lang, type: 'literal', value: name },
        item: { type: 'uri', value: `http://www.wikidata.org/entity/${qid}` },
        ...(image ? { image: { type: 'uri', value: 'http://commons.wikimedia.org/wiki/Special:FilePath/' + encodeURIComponent(image) } } : {}),
        ...(coord ? { coord: { datatype: 'http://www.opengis.net/ont/geosparql#wktLiteral', type: 'literal', value: coord } } : {}),
        ...(site ? { site: { type: 'uri', value: site } } : {}),
        ...(cat ? { cat: { type: 'literal', value: cat } } : {}),
      })),
    },
  }
}

export function commonsPage({ artist = 'Photographer', license = 'CC BY-SA 4.0', licenseUrl = 'https://creativecommons.org/licenses/by-sa/4.0', date = '', mime = 'image/jpeg', templates = [], url = 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Photo.jpg' } = {}) {
  return {
    ns: 6,
    imageinfo: [{
      url,
      thumburl: url.replace('/commons/', '/commons/thumb/') + '/960px-Photo.jpg',
      descriptionurl: 'https://commons.wikimedia.org/wiki/File:Photo.jpg',
      mime,
      extmetadata: {
        ...(artist ? { Artist: { value: artist, source: 'commons-desc-page' } } : {}),
        LicenseShortName: { value: license, source: 'commons-desc-page' },
        ...(licenseUrl ? { LicenseUrl: { value: licenseUrl, source: 'commons-desc-page' } } : {}),
        ...(date ? { DateTimeOriginal: { value: date, source: 'commons-desc-page' } } : {}),
      },
    }],
    templates: templates.map(title => ({ ns: 10, title })),
  }
}

export function commonsResponse(byFile) {
  return { batchcomplete: true, query: { pages: Object.entries(byFile).map(([file, page]) => ({ title: 'File:' + file, ...page })) } }
}
