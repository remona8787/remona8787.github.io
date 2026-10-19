// Seed collection rules and weighted keywords of the archive collector: the one source of truth for
// archive_collection_rules and archive_keywords (docs/ARCHIVE_SPEC.md §2, §3, §8 "Seeds").
// scripts/archive-seed-sql.mjs turns them into release/launch/archive-seed.sql (idempotent upserts keyed by
// (kind, name) and (term, language)); classify.mjs scores with SEED_KEYWORDS unless the database's enabled keywords
// are passed in.
//
// Keyword syntax (classify.mjs): matching is on folded text (lower case, no diacritics, punctuation → space).
// A word ending in `*` matches any word starting with it ("fasad* medialn*" matches "fasadzie medialnej").
// Terms with Hangul, kana or Han match inside words (no spaces needed: "미디어파사드를"), others match whole words.
// Latin-script terms of a language other than English count only for items in that language (or of unknown
// language), so the Polish "cena" (price) does not penalise a Spanish "cena de gala".
//
// category (not stored in the database; classify.mjs looks it up by term and language):
//   positive: facade (media facade / media architecture), projection (counts ONLY with an architectural context
//             term), event (light festivals, light shows), screen (billboards, urban screens → ad_screen),
//             art (light/media art), lighting (architectural lighting, light-ups)
//   context:  arch (building, facade, tower… also what unlocks projection terms) or context (plaza, unveiled,
//             installed, festival, night…)
//   negative: ad, rental, vendor, real_estate, job

/** @typedef {'positive'|'context'|'negative'} Polarity */
/** @typedef {{term: string, language: string, polarity: Polarity, weight: number, category: string}} SeedKeyword */

/** @type {SeedKeyword[]} */
export const SEED_KEYWORDS = []
/** @param {string} language @param {Polarity} polarity @param {string} category @param {number} weight @param {...string} terms */
function K(language, polarity, category, weight, ...terms) {
  for (const term of terms) SEED_KEYWORDS.push({ term, language, polarity, weight, category })
}
const P = 'positive', C = 'context', N = 'negative'

// ---- English (also matched in every other language: English loanwords are common in all of them) ----
K('en', P, 'facade', 45, 'media facade*', 'media-facade*', 'mediafacade*', 'led facade*', 'digital facade*', 'interactive facade*', 'facade projection*', 'architectural projection*')
K('en', P, 'facade', 35, 'kinetic facade*', 'media mesh', 'led mesh', 'media canvas', 'building projection*', 'projection onto the facade', 'projected onto the facade', 'projections on the facade')
K('en', P, 'facade', 30, 'media architecture', 'facade animation*', 'pixel facade*')
K('en', P, 'facade', 20, 'media wall')
K('en', P, 'projection', 40, 'projection mapping', 'projection-mapped', 'projection mapped', 'video mapping', 'mapping show*')
K('en', P, 'event', 35, 'light festival*', 'festival of light*', 'festival of lights', 'vivid sydney', 'fete des lumieres', 'lumiere festival', 'amsterdam light festival', 'ilight')
K('en', P, 'event', 20, 'light show*', 'illumination festival*', 'light and sound show*')
K('en', P, 'screen', 25, 'urban screen*', 'anamorphic', '3d billboard*', 'anamorphic billboard*')
K('en', P, 'screen', 12, 'digital billboard*', 'led screen*', 'led display*', 'giant screen*', 'video wall*', 'dooh screen*')
K('en', P, 'art', 20, 'light art', 'light installation*', 'light artwork*', 'media art', 'digital art installation*')
K('en', P, 'lighting', 15, 'facade lighting', 'architectural lighting', 'facade illumination', 'lit up the facade')
K('en', C, 'arch', 6, 'building*', 'tower*', 'facade*', 'skyscraper*', 'architecture', 'architectural', 'architect*', 'landmark*', 'cathedral*', 'castle*', 'palace*', 'city hall', 'town hall', 'museum*', 'exterior', 'opera house', 'stadium facade', 'church*', 'bridge*', 'headquarters')
K('en', C, 'context', 5, 'plaza*', 'square', 'unveil*', 'installed', 'installation', 'inaugurat*', 'festival*', 'night*', 'skyline', 'illuminat*', 'pixels', 'led', 'debut*', 'switched on', 'premiere*', 'artist*')
K('en', N, 'ad', 30, 'ad agency', 'advertising agency', 'media buying', 'ad space', 'advertising space', 'book your ad', 'advertising rates', 'ad rates')
K('en', N, 'ad', 15, 'advertis*', 'brand campaign*')
K('en', N, 'rental', 35, 'rental*', 'for rent', 'for hire', 'leasing')
K('en', N, 'vendor', 30, 'supplier*', 'manufacturer*', 'oem', 'odm', 'moq', 'factory direct', 'for sale', 'free shipping', 'shop now', 'get a quote', 'request a quote', 'buy now')
K('en', N, 'vendor', 35, 'wholesale*')
K('en', N, 'vendor', 20, 'price*', 'pricing', 'buy', 'factory', 'cheap', 'led module*', 'cabinet size', 'per square meter')
K('en', N, 'vendor', 10, 'pixel pitch', 'refresh rate')
K('en', N, 'real_estate', 40, 'real estate', 'realtor*', 'property listing*', 'condo*', 'apartments for sale', 'homes for sale', 'property for sale')
K('en', N, 'job', 40, 'hiring', 'vacanc*', 'job opening*', 'job offer*', 'internship*', 'apply now', 'we are hiring', 'job posting*')
K('en', N, 'job', 25, 'job', 'jobs', 'career*', 'recruit*')

// ---- Korean ----
K('ko', P, 'facade', 45, '미디어파사드', '미디어 파사드', 'LED 파사드', '디지털 파사드', '인터랙티브 파사드')
K('ko', P, 'facade', 30, '미디어월', '미디어 월', '미디어 캔버스', '미디어캔버스', '미디어 건축', '건물 외벽 영상', '외벽 미디어')
K('ko', P, 'projection', 40, '프로젝션 매핑', '프로젝션매핑', '프로젝션 맵핑', '프로젝션맵핑', '맵핑쇼', '매핑쇼', '미디어 맵핑')
K('ko', P, 'event', 35, '빛축제', '빛 축제', '서울라이트', '서울 라이트', '빛의 축제', '라이트 페스티벌')
K('ko', P, 'event', 20, '라이트쇼', '빛 공연', '레이저쇼', '불빛 쇼')
K('ko', P, 'screen', 25, '아나모픽', '3D 전광판', '초대형 전광판')
K('ko', P, 'screen', 15, '옥외 전광판', '전광판', '대형 스크린', '디지털 사이니지', '미디어폴', '사이니지')
K('ko', P, 'art', 15, '미디어아트', '미디어 아트', '라이트아트', '라이트 아트', '빛 예술', '빛 조형물')
K('ko', P, 'lighting', 15, '경관조명', '야간경관', '경관 조명', '야간 경관')
K('ko', C, 'arch', 6, '건물', '빌딩', '타워', '외벽', '파사드', '건축', '랜드마크', '청사', '성당', '교량', '대교', '박물관', '미술관', '사옥')
K('ko', C, 'context', 5, '광장', '공개', '설치', '점등', '개막', '축제', '야간', '야경', '선보', '상영', '작가', '작품')
K('ko', N, 'ad', 35, '광고대행', '광고 대행', '광고 문의', '광고문의', '광고비', '광고 단가', '매체 판매')
K('ko', N, 'ad', 15, '옥외광고', '광고주', '광고 집행')
K('ko', N, 'rental', 35, '임대', '렌탈', '렌털', '대여', '임차')
K('ko', N, 'vendor', 30, '견적', '전문업체', '전문 업체', '시공 문의', '제작 문의', '설치 문의', '최저가', '도매', '납품 문의')
K('ko', N, 'vendor', 20, '제조사', '제조업체', '판매', '가격', '구매', '납품', '시공사례', '시공 사례', '업체 추천', '할인')
K('ko', N, 'vendor', 10, '업체', '문의', '상담')
K('ko', N, 'real_estate', 40, '분양', '매매', '부동산', '모델하우스', '청약', '전세', '월세')
K('ko', N, 'real_estate', 15, '오피스텔', '아파트 분양')
K('ko', N, 'job', 40, '채용', '구인', '경력직', '신입사원', '인턴 모집', '채용공고')
K('ko', N, 'job', 15, '모집')

// ---- Japanese ----
K('ja', P, 'facade', 45, 'メディアファサード', 'メディア・ファサード', 'LEDファサード', 'デジタルファサード')
K('ja', P, 'facade', 30, 'メディアアーキテクチャ', '建物外壁の映像', '外壁ビジョン')
K('ja', P, 'projection', 40, 'プロジェクションマッピング', 'プロジェクション・マッピング', '3Dマッピング')
K('ja', P, 'event', 35, '光の祭典', 'ライトフェスティバル', '光のフェスティバル')
K('ja', P, 'event', 15, 'イルミネーション', 'ライトショー', '光のショー')
K('ja', P, 'screen', 25, '3D広告', '3D看板', '裸眼3D')
K('ja', P, 'screen', 12, '大型ビジョン', 'デジタルサイネージ', '街頭ビジョン', 'LEDビジョン')
K('ja', P, 'art', 15, 'メディアアート', 'ライトアート', '光のアート')
K('ja', P, 'lighting', 12, 'ライトアップ', '景観照明')
K('ja', C, 'arch', 6, '建物', 'ビル', 'タワー', '外壁', 'ファサード', '建築', '庁舎', 'ランドマーク', '大聖堂', '駅舎', '美術館', '博物館')
K('ja', C, 'context', 5, '広場', '公開', '設置', '点灯', '開幕', '祭り', 'フェスティバル', '夜景', '上映', '作品')
K('ja', N, 'ad', 30, '広告掲載', '広告代理店', '広告枠', '広告料金')
K('ja', N, 'ad', 15, '広告')
K('ja', N, 'rental', 35, 'レンタル', '貸出')
K('ja', N, 'vendor', 30, '見積', 'メーカー直販', '卸売', '格安')
K('ja', N, 'vendor', 20, 'メーカー', '価格', '販売', '購入', '通販')
K('ja', N, 'real_estate', 40, '不動産', '分譲', '賃貸物件', '売買物件')
K('ja', N, 'job', 40, '求人', '採用情報', '募集要項', 'アルバイト')

// ---- Chinese (simplified, with the common traditional forms) ----
K('zh', P, 'facade', 45, '媒体立面', '媒体幕墙', '媒體立面', '媒體幕牆', '建筑投影', '建築投影', '楼体灯光秀', '樓體燈光秀')
K('zh', P, 'facade', 30, 'LED幕墙', '媒体建筑', '媒體建築', '楼体亮化', '外墙屏')
K('zh', P, 'projection', 35, '投影秀', '3D投影', '投影映射', '光影秀')
K('zh', P, 'event', 35, '灯光节', '燈光節', '光影节')
K('zh', P, 'event', 20, '灯光秀', '燈光秀', '灯光表演')
K('zh', P, 'screen', 25, '裸眼3D', '户外大屏', '戶外大屏')
K('zh', P, 'screen', 10, '大屏', 'LED显示屏', 'LED屏')
K('zh', P, 'art', 15, '光影艺术', '媒体艺术', '灯光艺术', '光影藝術')
K('zh', P, 'lighting', 12, '亮化工程', '夜景照明')
K('zh', C, 'arch', 6, '建筑', '大楼', '大厦', '外墙', '立面', '地标', '大樓', '大廈', '外牆', '地標', '楼体', '博物馆', '美术馆')
K('zh', C, 'context', 5, '广场', '亮相', '安装', '点亮', '开幕', '夜景', '廣場', '點亮', '首秀')
K('zh', N, 'ad', 30, '广告投放', '广告位', '廣告投放')
K('zh', N, 'ad', 20, '招商')
K('zh', N, 'ad', 15, '广告', '廣告')
K('zh', N, 'rental', 35, '租赁', '出租', '租賃')
K('zh', N, 'vendor', 30, '厂家', '供应商', '批发', '报价', '廠家', '供應商', '批發', '報價')
K('zh', N, 'vendor', 20, '价格', '销售', '價格', '銷售', '多少钱')
K('zh', N, 'real_estate', 40, '房地产', '楼盘', '售楼', '房地產', '樓盤')
K('zh', N, 'job', 40, '招聘', '求职', '诚聘')

// ---- German ----
K('de', P, 'facade', 45, 'medienfassade*', 'medien fassade*', 'led fassade*', 'fassadenprojektion*', 'digitale fassade*', 'mediale fassade*')
K('de', P, 'facade', 30, 'medienarchitektur', 'lichtfassade*')
K('de', P, 'projection', 40, 'projektionsmapping', 'projektions mapping', 'videomapping', 'video mapping', '3d projektion*')
K('de', P, 'event', 35, 'lichtfestival*', 'lichterfest*', 'festival der lichter', 'luminale', 'festival of lights berlin')
K('de', P, 'event', 20, 'lichtshow*', 'lichterschau')
K('de', P, 'screen', 12, 'led wand', 'led wande', 'grossbildleinwand*', 'werbescreen*')
K('de', P, 'art', 20, 'lichtkunst', 'lichtinstallation*', 'medienkunst')
K('de', P, 'lighting', 15, 'fassadenbeleuchtung', 'illumination')
K('de', C, 'arch', 6, 'gebaude*', 'turm*', 'hochhaus*', 'fassade*', 'architektur*', 'wahrzeichen', 'rathaus*', 'dom', 'kirche*', 'brucke*', 'museum*', 'bahnhof*')
K('de', C, 'context', 5, 'platz', 'enthullt', 'installiert*', 'eroffnet', 'festival*', 'nacht*', 'kunstler*')
K('de', N, 'ad', 30, 'werbeflache*', 'werbung schalten', 'mediaagentur*')
K('de', N, 'ad', 15, 'werbung', 'werbe*')
K('de', N, 'rental', 35, 'vermietung', 'mieten', 'verleih')
K('de', N, 'vendor', 30, 'lieferant*', 'grosshandel', 'jetzt kaufen', 'angebot anfordern')
K('de', N, 'vendor', 20, 'hersteller*', 'kaufen', 'preise', 'onlineshop')
K('de', N, 'real_estate', 40, 'immobilie*', 'eigentumswohnung*', 'makler*')
K('de', N, 'job', 40, 'stellenangebot*', 'stellenanzeige*', 'wir suchen', 'karriere')

// ---- French ----
K('fr', P, 'facade', 45, 'facade* media*', 'facade* multimedia*', 'facade* numerique*', 'facade* led', 'architecture mediatique')
K('fr', P, 'facade', 35, 'projection monumentale', 'projections monumentales', 'facade* lumineuse*', 'projection* sur la facade')
K('fr', P, 'projection', 40, 'mapping video', 'video mapping', 'videomapping', 'projection mapping', 'mapping 3d')
K('fr', P, 'event', 35, 'fete des lumieres', 'festival des lumieres', 'festival lumiere*', 'nuit des lumieres')
K('fr', P, 'event', 20, 'spectacle* lumineux', 'spectacle son et lumiere', 'son et lumiere')
K('fr', P, 'screen', 12, 'ecran* geant*', 'ecran* led', 'panneau* numerique*')
K('fr', P, 'art', 20, 'art lumineux', 'installation* lumineuse*', 'art numerique')
K('fr', P, 'lighting', 15, 'mise en lumiere', 'eclairage de facade')
K('fr', C, 'arch', 6, 'batiment*', 'facade*', 'architecture', 'architectural*', 'monument*', 'cathedrale*', 'hotel de ville', 'pont*', 'gratte ciel', 'immeuble*', 'musee*', 'chateau*', 'eglise*')
K('fr', C, 'context', 5, 'inaugur*', 'installe*', 'festival*', 'nuit', 'artiste*', 'oeuvre*', 'devoile*')
K('fr', N, 'ad', 30, 'regie publicitaire', 'espace* publicitaire*', 'agence de publicite')
K('fr', N, 'ad', 15, 'publicite*', 'publicitaire*')
K('fr', N, 'rental', 35, 'location d ecran*', 'location de materiel', 'a louer')
K('fr', N, 'vendor', 30, 'fournisseur*', 'grossiste*', 'demandez un devis', 'devis gratuit')
K('fr', N, 'vendor', 20, 'fabricant*', 'acheter', 'devis')
K('fr', N, 'vendor', 10, 'tarif*')
K('fr', N, 'real_estate', 40, 'immobilier*', 'appartement* a vendre', 'agence immobiliere')
K('fr', N, 'job', 40, 'offre* d emploi', 'recrutement', 'nous recrutons', 'stage* remunere*')
K('fr', N, 'job', 25, 'emploi*')

// ---- Spanish ----
K('es', P, 'facade', 45, 'fachada* multimedia', 'fachada* de medios', 'fachada* mediatica*', 'fachada* led', 'fachada* de led', 'fachada* digital*', 'fachada* interactiva*')
K('es', P, 'facade', 35, 'proyeccion* sobre la fachada', 'proyeccion* en la fachada', 'arquitectura mediatica')
K('es', P, 'projection', 40, 'videomapping', 'video mapping', 'mapping', 'mapeo de proyeccion', 'proyeccion mapping', 'mapping 3d')
K('es', P, 'event', 35, 'festival de luz', 'festival de la luz', 'festival de las luces', 'fiesta de las luces')
K('es', P, 'event', 20, 'espectaculo* de luz', 'show de luces', 'espectaculo* de luces')
K('es', P, 'screen', 12, 'pantalla* gigante*', 'pantalla* led', 'valla* digital*')
K('es', P, 'art', 20, 'arte luminico', 'instalacion* luminica*', 'arte digital')
K('es', P, 'lighting', 15, 'iluminacion de fachada', 'iluminacion arquitectonica')
K('es', C, 'arch', 6, 'edificio*', 'torre*', 'fachada*', 'arquitectura', 'arquitectonic*', 'catedral*', 'ayuntamiento', 'puente*', 'rascacielos', 'museo*', 'palacio*', 'iglesia*')
K('es', C, 'context', 5, 'plaza*', 'inaugur*', 'instalad*', 'festival*', 'noche*', 'artista*', 'obra*', 'presenta*')
K('es', N, 'ad', 30, 'espacios publicitarios', 'agencia de publicidad', 'tarifas publicitarias')
K('es', N, 'ad', 15, 'publicidad', 'publicitari*')
K('es', N, 'rental', 35, 'alquiler*', 'renta de pantalla*', 'se alquila')
K('es', N, 'vendor', 30, 'proveedor*', 'mayorista*', 'venta al por mayor', 'cotizacion', 'pide presupuesto')
K('es', N, 'vendor', 20, 'fabricante*', 'precio*', 'comprar', 'presupuesto')
K('es', N, 'real_estate', 40, 'inmobiliari*', 'se vende', 'departamento* en venta', 'piso* en venta')
K('es', N, 'job', 40, 'oferta* de empleo', 'empleo*', 'vacante*', 'trabaja con nosotros', 'bolsa de trabajo')

// ---- Italian ----
K('it', P, 'facade', 45, 'facciat* mediatic*', 'facciat* multimedial*', 'facciat* led', 'facciat* digital*', 'media facciata')
K('it', P, 'facade', 35, 'proiezion* sulla facciata', 'proiezion* sulle facciate', 'proiezion* architettonic*')
K('it', P, 'projection', 40, 'videomapping', 'video mapping', 'proiezion* mapping', 'mapping 3d', 'projection mapping')
K('it', P, 'event', 35, 'festival della luce', 'festival delle luci', 'festa delle luci', 'luci d artista')
K('it', P, 'event', 20, 'spettacol* di luc*', 'show di luci')
K('it', P, 'screen', 12, 'maxischerm*', 'schermo led', 'schermi led', 'ledwall')
K('it', P, 'art', 20, 'arte luminosa', 'installazion* luminos*', 'arte digitale')
K('it', P, 'lighting', 15, 'illuminazione della facciata', 'illuminazione architettonica')
K('it', C, 'arch', 6, 'edifici*', 'torre', 'facciat*', 'architettur*', 'architettonic*', 'duomo', 'cattedrale', 'palazzo*', 'ponte', 'grattacielo*', 'museo', 'chiesa', 'municipio')
K('it', C, 'context', 5, 'piazza', 'inaugurat*', 'installat*', 'festival*', 'notte', 'artista', 'opera', 'presentat*')
K('it', N, 'ad', 30, 'spazi pubblicitari', 'concessionaria di pubblicita', 'agenzia pubblicitaria')
K('it', N, 'ad', 15, 'pubblicita', 'pubblicitari*')
K('it', N, 'rental', 35, 'noleggi*', 'affitto')
K('it', N, 'vendor', 30, 'fornitor*', 'ingrosso', 'richiedi un preventivo', 'preventivo gratuito')
K('it', N, 'vendor', 20, 'produttor*', 'prezz*', 'acquista', 'preventivo')
K('it', N, 'real_estate', 40, 'immobiliar*', 'vendesi', 'appartament* in vendita')
K('it', N, 'job', 40, 'offert* di lavoro', 'lavora con noi', 'cerchiamo', 'posizion* aperta')

// ---- Portuguese ----
K('pt', P, 'facade', 45, 'fachada* de midia', 'fachada* multimidia', 'fachada* midiatica*', 'fachada* de led', 'fachada* led', 'fachada* digital', 'fachada* digitais')
K('pt', P, 'facade', 35, 'projec* na fachada', 'projecao mapeada', 'projecoes mapeadas')
K('pt', P, 'projection', 40, 'videomapping', 'video mapping', 'mapping', 'mapeamento de projecao', 'projection mapping')
K('pt', P, 'event', 35, 'festival de luz', 'festival das luzes', 'festival de luzes')
K('pt', P, 'event', 20, 'espetaculo* de luz', 'show de luzes', 'show de luz')
K('pt', P, 'screen', 12, 'telao', 'teloes', 'painel de led', 'paineis de led', 'painel* digital*')
K('pt', P, 'art', 20, 'arte luminosa', 'instalac* luminosa*', 'arte digital')
K('pt', P, 'lighting', 15, 'iluminacao da fachada', 'iluminacao arquitetonica')
K('pt', C, 'arch', 6, 'edificio*', 'predio*', 'torre*', 'fachada*', 'arquitetura', 'arquitetonic*', 'catedral', 'ponte*', 'arranha ceu*', 'museu*', 'palacio*', 'igreja*', 'prefeitura')
K('pt', C, 'context', 5, 'praca*', 'inaugur*', 'instalad*', 'festival*', 'noite', 'artista*', 'obra*', 'apresenta*')
K('pt', N, 'ad', 30, 'espacos publicitarios', 'agencia de publicidade', 'midia exterior')
K('pt', N, 'ad', 15, 'publicidade', 'publicitari*', 'anuncio*')
K('pt', N, 'rental', 35, 'aluguel', 'locacao de', 'aluga se', 'alugamos')
K('pt', N, 'vendor', 30, 'fornecedor*', 'atacado', 'orcamento gratis', 'solicite um orcamento')
K('pt', N, 'vendor', 20, 'fabricante*', 'preco*', 'comprar', 'orcamento')
K('pt', N, 'real_estate', 40, 'imobiliari*', 'apartamento* a venda', 'imovel', 'imoveis')
K('pt', N, 'job', 40, 'vaga* de emprego', 'emprego*', 'trabalhe conosco', 'vagas abertas')

// ---- Dutch ----
K('nl', P, 'facade', 45, 'mediagevel*', 'media gevel*', 'led gevel*', 'gevelprojectie*', 'digitale gevel*')
K('nl', P, 'facade', 30, 'media architectuur', 'mediaarchitectuur', 'lichtgevel*')
K('nl', P, 'projection', 40, 'videomapping', 'video mapping', 'projection mapping', 'projectiemapping')
K('nl', P, 'event', 35, 'lichtfestival*', 'glow eindhoven', 'festival van het licht')
K('nl', P, 'event', 20, 'lichtshow*', 'lichtspektakel')
K('nl', P, 'screen', 12, 'led scherm*', 'reclamescherm*', 'groot scherm', 'videowand*')
K('nl', P, 'art', 20, 'lichtkunst', 'lichtkunstwerk*', 'lichtinstallatie*')
K('nl', P, 'lighting', 15, 'gevelverlichting', 'aanlichting')
K('nl', C, 'arch', 6, 'gebouw*', 'toren*', 'gevel*', 'architectuur', 'stadhuis', 'kathedraal', 'brug', 'wolkenkrabber*', 'museum', 'kerk*', 'station')
K('nl', C, 'context', 5, 'plein', 'onthul*', 'geinstalleerd', 'festival*', 'nacht', 'kunstenaar*', 'kunstwerk*')
K('nl', N, 'ad', 30, 'reclameruimte', 'reclamebureau', 'adverteren op')
K('nl', N, 'ad', 15, 'reclame', 'advertenties', 'adverteren')
K('nl', N, 'rental', 35, 'verhuur', 'huren', 'te huur')
K('nl', N, 'vendor', 30, 'leverancier*', 'groothandel', 'offerte aanvragen', 'gratis offerte')
K('nl', N, 'vendor', 20, 'fabrikant*', 'prijzen', 'kopen', 'offerte')
K('nl', N, 'real_estate', 40, 'vastgoed', 'makelaar*', 'te koop', 'koopwoning*')
K('nl', N, 'job', 40, 'vacature*', 'wij zoeken', 'solliciteer', 'werken bij')

// ---- Polish ----
K('pl', P, 'facade', 45, 'fasad* medialn*', 'fasad* multimedialn*', 'fasad* led', 'fasad* ledow*', 'fasad* cyfrow*', 'mediafasad*')
K('pl', P, 'facade', 35, 'projekcj* na fasadz*', 'projekcj* na fasad*', 'projekcj* na budynk*', 'architektur* medialn*')
K('pl', P, 'projection', 40, 'mapping*', 'videomapping*', 'video mapping', 'projection mapping')
K('pl', P, 'event', 35, 'festiwal* swiatla', 'swieto swiatla', 'festiwal* swiatel')
K('pl', P, 'event', 20, 'pokaz* swiatla', 'pokaz* swietln*', 'widowisk* swietln*')
K('pl', P, 'screen', 12, 'ekran* led', 'telebim*', 'ekran* reklamow*')
K('pl', P, 'art', 20, 'sztuk* swiatla', 'instalacj* swietln*', 'sztuk* cyfrow*')
K('pl', P, 'lighting', 15, 'iluminacj* fasad*', 'iluminacj* budynk*', 'podswietleni* fasad*')
K('pl', C, 'arch', 6, 'budyn*', 'wiez*', 'fasad*', 'architektur*', 'ratusz*', 'katedr*', 'wiezowc*', 'wiezowiec', 'muzeum', 'kosciol*', 'palac*', 'gmach*')
K('pl', C, 'context', 5, 'plac*', 'odslon*', 'zainstalowan*', 'festiwal*', 'noc', 'noca', 'artyst*', 'zaprezentowan*')
K('pl', N, 'ad', 30, 'powierzchni* reklamow*', 'agencj* reklamow*', 'cennik reklam*')
K('pl', N, 'ad', 15, 'reklam*')
K('pl', N, 'rental', 35, 'wynajem', 'wynajm*', 'wypozyczalni*', 'dzierzaw*')
K('pl', N, 'vendor', 30, 'dostawc*', 'hurtow*', 'zapytaj o wycen*', 'darmowa wycena')
K('pl', N, 'vendor', 20, 'producent*', 'cena', 'ceny', 'kup', 'kupic', 'wycena', 'sklep')
K('pl', N, 'real_estate', 40, 'nieruchomo*', 'mieszkani* na sprzedaz', 'na sprzedaz', 'deweloper*')
K('pl', N, 'job', 40, 'oferta pracy', 'oferty pracy', 'rekrutacj*', 'zatrudni*')

// ---- Russian ----
K('ru', P, 'facade', 45, 'медиафасад*', 'медиа фасад*', 'светодиодн* фасад*', 'цифров* фасад*', 'интерактивн* фасад*')
K('ru', P, 'facade', 35, 'проекци* на фасад*', 'проекци* на здани*', 'медиаархитектур*')
K('ru', P, 'projection', 40, 'видеомэппинг*', 'видеомаппинг*', 'мэппинг*', 'маппинг*', '3d мэппинг*', '3d маппинг*', 'проекционн* шоу')
K('ru', P, 'event', 35, 'фестивал* света', 'круг света', 'фестивал* огней')
K('ru', P, 'event', 20, 'светов* шоу', 'лазерн* шоу')
K('ru', P, 'screen', 12, 'медиаэкран*', 'светодиодн* экран*', 'рекламн* экран*', 'led экран*')
K('ru', P, 'art', 20, 'светов* искусств*', 'светов* инсталляци*', 'медиаискусств*')
K('ru', P, 'lighting', 15, 'подсветк* фасад*', 'архитектурн* подсветк*', 'иллюминаци*')
K('ru', C, 'arch', 6, 'здани*', 'башн*', 'фасад*', 'архитектур*', 'небоскреб*', 'собор*', 'дворц*', 'дворец', 'театр*', 'музе*', 'мост', 'моста', 'мосту')
K('ru', C, 'context', 5, 'площад*', 'открыт*', 'установ*', 'фестивал*', 'ночн*', 'художник*', 'презентова*', 'представ*')
K('ru', N, 'ad', 30, 'рекламн* агентств*', 'размещени* реклам*', 'рекламн* мест*')
K('ru', N, 'ad', 15, 'реклам*')
K('ru', N, 'rental', 35, 'аренд*', 'прокат')
K('ru', N, 'vendor', 30, 'поставщик*', 'оптом', 'оптов*', 'под заказ')
K('ru', N, 'vendor', 20, 'производител*', 'цена', 'цены', 'ценам', 'купить', 'стоимость', 'заказать')
K('ru', N, 'real_estate', 40, 'недвижимост*', 'новостройк*', 'квартир* в продаже', 'продажа квартир*')
K('ru', N, 'job', 40, 'ваканси*', 'требуется', 'требуются', 'резюме')

// ---- Arabic (written as usual; classify.mjs folds alef/hamza/taa marbuta and strips the article) ----
K('ar', P, 'facade', 45, 'واجهة إعلامية', 'واجهة اعلامية', 'واجهة رقمية', 'واجهة LED', 'واجهة ليد', 'واجهات إعلامية', 'واجهات رقمية', 'واجهة تفاعلية')
K('ar', P, 'facade', 35, 'إسقاط على واجهة', 'عرض على واجهة', 'إسقاط ضوئي على المبنى')
K('ar', P, 'projection', 40, 'إسقاط ضوئي', 'العرض الإسقاطي', 'خرائط الإسقاط', 'الإسقاط ثلاثي الأبعاد')
K('ar', P, 'event', 35, 'مهرجان الأضواء', 'مهرجان النور', 'مهرجان الضوء', 'نور الرياض')
K('ar', P, 'event', 20, 'عرض ضوئي', 'عروض ضوئية', 'عرض الليزر')
K('ar', P, 'screen', 12, 'شاشة عملاقة', 'شاشات عملاقة', 'شاشة LED', 'لوحة إعلانية رقمية')
K('ar', P, 'art', 20, 'فن الضوء', 'فنون الضوء', 'عمل ضوئي', 'تركيب ضوئي', 'الفن الرقمي')
K('ar', P, 'lighting', 15, 'إضاءة الواجهة', 'إنارة المبنى')
K('ar', C, 'arch', 6, 'مبنى', 'مباني', 'برج', 'واجهة', 'واجهات', 'عمارة', 'معماري', 'معمارية', 'جسر', 'متحف', 'قصر', 'ناطحة سحاب', 'مسجد')
K('ar', C, 'context', 5, 'ساحة', 'افتتاح', 'تدشين', 'تركيب', 'مهرجان', 'ليلة', 'فنان', 'كشف')
K('ar', N, 'ad', 30, 'وكالة إعلانات', 'مساحات إعلانية', 'أسعار الإعلانات')
K('ar', N, 'ad', 15, 'إعلان', 'إعلانات', 'إعلاني')
K('ar', N, 'rental', 35, 'تأجير', 'إيجار', 'للإيجار')
K('ar', N, 'vendor', 30, 'مورد شاشات', 'بالجملة', 'عرض سعر', 'اطلب عرض')
K('ar', N, 'vendor', 20, 'مصنع', 'سعر', 'أسعار', 'للبيع', 'شراء')
K('ar', N, 'real_estate', 40, 'عقارات', 'عقار', 'شقق للبيع', 'شقة للبيع')
K('ar', N, 'job', 40, 'وظيفة', 'وظائف', 'مطلوب موظف', 'فرص عمل', 'توظيف')

// ---- Turkish ----
K('tr', P, 'facade', 45, 'medya cephe*', 'led cephe*', 'dijital cephe*', 'medya cephesi', 'etkilesimli cephe*')
K('tr', P, 'facade', 35, 'cepheye projeksiyon', 'cephe projeksiyon*', 'binaya projeksiyon', 'medya mimari*')
K('tr', P, 'projection', 40, 'projeksiyon mapping', 'projection mapping', 'video mapping', 'projeksiyon haritalama', 'mapping gosteri*')
K('tr', P, 'event', 35, 'isik festival*', 'isik festivali', 'isiklar festival*')
K('tr', P, 'event', 20, 'isik gosteri*', 'isik sov*', 'lazer gosteri*')
K('tr', P, 'screen', 12, 'dev ekran*', 'led ekran*', 'dijital reklam panosu', 'reklam ekran*')
K('tr', P, 'art', 20, 'isik sanati', 'isik enstalasyon*', 'dijital sanat')
K('tr', P, 'lighting', 15, 'cephe aydinlatma*', 'mimari aydinlatma')
K('tr', C, 'arch', 6, 'bina*', 'kule*', 'cephe*', 'mimari*', 'gokdelen*', 'kopru*', 'muze*', 'saray*', 'cami*', 'belediye binasi')
K('tr', C, 'context', 5, 'meydan*', 'acilis*', 'acildi', 'kuruldu', 'festival*', 'gece', 'sanatci*', 'tanitildi')
K('tr', N, 'ad', 30, 'reklam ajans*', 'reklam alani', 'reklam fiyatlari')
K('tr', N, 'ad', 15, 'reklam', 'reklami', 'reklamlar*')
K('tr', N, 'rental', 35, 'kiralama', 'kiralik', 'kiralayin')
K('tr', N, 'vendor', 30, 'tedarikci*', 'toptan', 'fiyat teklifi', 'teklif alin')
K('tr', N, 'vendor', 20, 'uretici*', 'fiyat*', 'satin al', 'satis')
K('tr', N, 'real_estate', 40, 'emlak', 'satilik', 'konut projesi', 'satilik daire')
K('tr', N, 'job', 40, 'is ilani', 'is ilanlari', 'eleman araniyor', 'personel alimi')

// ---- collection rules ----

// GDELT matches queries against the English machine translations of the 65 languages it monitors (its native-language
// keyword search is being phased out, see blog.gdeltproject.org), so every group asks the same English phrases and
// narrows by source language with sourcelang:. The native terms of each language are what the classifier scores
// in the original-language titles; they are listed in each rule's notes.
export const GDELT_CORE_TERMS = ['media facade', 'media facades', 'led facade', 'digital facade', 'facade projection', 'projection mapping', 'media architecture']
export const GDELT_LANGUAGES = /** @type {const} */ ([
  // [ISO 639-1, GDELT sourcelang name, region hint, native terms (notes and classifier)]
  ['en', 'english', null, 'media facade, media façade, LED facade, projection mapping on a building'],
  ['ko', 'korean', 'east_asia', '미디어파사드, 미디어 파사드, 프로젝션 매핑, 빛축제'],
  ['ja', 'japanese', 'east_asia', 'メディアファサード, プロジェクションマッピング'],
  ['zh', 'chinese', 'east_asia', '媒体立面, 媒体幕墙, 楼体灯光秀'],
  ['de', 'german', 'europe', 'Medienfassade, LED-Fassade, Projektionsmapping'],
  ['fr', 'french', 'europe', 'façade média, façade médiatique, mapping vidéo'],
  ['es', 'spanish', null, 'fachada multimedia, fachada de medios, videomapping'],
  ['it', 'italian', 'europe', 'facciata mediatica, videomapping'],
  ['pt', 'portuguese', null, 'fachada de mídia, fachada multimídia, videomapping'],
  ['nl', 'dutch', 'europe', 'mediagevel, gevelprojectie'],
  ['pl', 'polish', 'europe', 'fasada medialna, mapping'],
  ['ru', 'russian', 'europe', 'медиафасад, видеомэппинг'],
  ['ar', 'arabic', 'middle_east', 'واجهة إعلامية, إسقاط ضوئي'],
  ['tr', 'turkish', 'middle_east', 'medya cephe, projeksiyon mapping'],
])
const GDELT_TERMS_URL = 'https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/'

/** @param {string} t */
const quote = (t) => /\s/.test(t) ? `"${t}"` : t
/** GDELT DOC 2.0 query: OR'd phrases in parentheses, then the language filter. @param {string[]} terms @param {string|null} [sourcelang] */
export function gdeltQuery(terms, sourcelang = null) {
  const group = terms.length > 1 ? `(${terms.map(quote).join(' OR ')})` : quote(terms[0])
  return sourcelang ? `${group} sourcelang:${sourcelang}` : group
}

/**
 * @typedef {object} SeedRule
 * @property {'gdelt'|'rss'|'naver_news'|'naver_blog'|'brave'|'wikidata'|'websub'} kind
 * @property {string} name
 * @property {string|null} query
 * @property {string|null} url
 * @property {string|null} language
 * @property {string|null} region_hint
 * @property {boolean} enabled
 * @property {number} cadence_hours
 * @property {string|null} terms_url
 * @property {null} verified_at   always null in the seed: only a successful live run (probe or deployment) verifies a source
 * @property {string} notes
 */

/** @type {SeedRule[]} */
export const SEED_RULES = [
  ...GDELT_LANGUAGES.map(([language, sourcelang, region, native]) => ({
    kind: /** @type {const} */ ('gdelt'),
    name: `GDELT ${language} · media facade`,
    query: gdeltQuery(GDELT_CORE_TERMS, sourcelang),
    url: 'https://api.gdeltproject.org/api/v2/doc/doc',
    language, region_hint: region, enabled: true, cadence_hours: 6,
    terms_url: GDELT_TERMS_URL, verified_at: null,
    notes: `GDELT DOC 2.0 ArtList, sourcelang:${sourcelang}. GDELT searches English machine translations; the classifier scores the original titles with the ${language} terms (${native}). Cite GDELT; at most 1 request per 5 s.`,
  })),
  // RSS feeds (§2). URLs established from feed directories and the publishers' URL patterns; none could be fetched
  // from the build machine, so every one starts unverified (verified_at null) until the probe or a deployed run reads it.
  rss('Dezeen', 'https://www.dezeen.com/feed/', 'en', null, 'WordPress feed; listed by feed directories (feeder.co, rss.app).'),
  rss('designboom', 'https://www.designboom.com/feed/', 'en', null, 'WordPress feed path (designboom runs WordPress); not confirmed by a directory listing.'),
  rss('ArchDaily', 'https://feeds.feedburner.com/Archdaily', 'en', null, 'The long-published Feedburner address. ArchDaily\'s own per-office/per-tag feeds (archdaily.com/…/x.xml) name https://www.archdaily.com/show.xml as atom:link self; switch to it if the probe finds Feedburner stale.'),
  rss('Archinect', 'https://archinect.com/feed/1/news', 'en', null, 'Atom; path pattern of Archinect\'s news tag feeds (archinect.com/feed/1/news/tag/…).'),
  rss('Creative Applications Network', 'https://www.creativeapplications.net/feed/', 'en', null, 'WordPress feed; CAN announced a members\' full-content feed in Dec 2024 — only the public excerpt feed is used.'),
  rss('Media Architecture Institute', 'https://mediaarchitecture.org/feed/', 'en', null, 'WordPress site (wp-json API present); /feed/ is the WordPress default.'),
  rss('Designboom Korea', 'https://www.designboom.com/tag/korea/feed/', 'en', 'east_asia', 'No Korean edition of designboom was found; this is designboom\'s WordPress tag feed for Korea (/tag/<tag>/feed/).'),
  // NAVER: off until NAVER_API_KEY_ID / NAVER_API_KEY are set (and then enabled by an admin).
  naver('naver_news', 'NAVER 뉴스 · 미디어파사드', '미디어파사드'),
  naver('naver_news', 'NAVER 뉴스 · 프로젝션 매핑 건물', '프로젝션 매핑 건물'),
  naver('naver_blog', 'NAVER 블로그 · 미디어파사드', '미디어파사드'),
  // Brave: metered (card required); off unless an admin enables it after BRAVE_API_KEY is set.
  {
    kind: 'brave', name: 'Brave · media facade', query: '"media facade" building', url: 'https://api.search.brave.com/res/v1/web/search',
    language: null, region_hint: null, enabled: false, cadence_hours: 24, terms_url: 'https://brave.com/search/api/', verified_at: null,
    notes: 'Metered: about $5 per 1,000 requests with a $5 monthly credit; a card is required even for the credit. One request per run (count 20, freshness pw).',
  },
  {
    kind: 'wikidata', name: 'Wikidata · archive project changes', query: null, url: 'https://query.wikidata.org/sparql',
    language: null, region_hint: null, enabled: true, cadence_hours: 6, terms_url: 'https://www.wikidata.org/wiki/Wikidata:Data_access', verified_at: null,
    notes: 'Change detection for archive projects with a QID: schema:dateModified plus P571, P17, P625, P856, P5817; each change becomes an archive_project_updates row of kind wikidata_changed.',
  },
]

/** @param {string} name @param {string} url @param {string} language @param {string|null} region @param {string} notes @returns {SeedRule} */
function rss(name, url, language, region, notes) {
  return { kind: 'rss', name, query: null, url, language, region_hint: region, enabled: true, cadence_hours: 6, terms_url: null, verified_at: null, notes: notes + ' Conditional GET; only items matching positive keywords are kept.' }
}
/** @param {'naver_news'|'naver_blog'} kind @param {string} name @param {string} query @returns {SeedRule} */
function naver(kind, name, query) {
  return {
    kind, name, query, url: null, language: 'ko', region_hint: 'east_asia', enabled: false, cadence_hours: 6,
    terms_url: 'https://api.ncloud-docs.com/docs/en/naver-api-hub-overview', verified_at: null,
    notes: 'NAVER API HUB (or legacy developers.naver.com keys until 2027-06-30); sort=date, display=100. Off until the keys are set.',
  }
}
