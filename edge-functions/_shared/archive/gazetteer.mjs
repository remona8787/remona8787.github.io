// Compact gazetteer for location detection in news titles and excerpts (docs/ARCHIVE_SPEC.md §3 "Normalize").
// Countries and major cities with English, Korean and local names (and the forms the 14 classifier languages use).
// It names where a text says something is; it never invents coordinates (detected latitude/longitude stay null).
//
// Format: "ISO2|name;name;…" per line. Latin names match whole words (a trailing * allows inflected forms such as
// the Polish "Warszawie" or the Russian "Москве"); Hangul/kana/Han names match inside words. Names that are also
// common words were left out on purpose: Korean 인도 (sidewalk), 오만 (arrogance), 세종 (also King Sejong),
// 고양 (cat), 화성 (Mars), 경주 (race), 선전 (propaganda), 시안 (draft), 창사 (founding); English Nice, Bath, Reading,
// Split, Florence, Victoria, Sofia, Jordan, Georgia, Chad, Porto ("port" in Italian); Japanese タイ and インド
// (inside タイム, インドア).

// ISO 3166-1 alpha-2 → region: a copy of site-public-cleared/archive-taxonomy.js (the Edge Function bundle only
// contains edge-functions/), compared key by key in tests/archive-collector-normalize.test.mjs.
const R = {
  east_asia: 'KR KP JP CN TW HK MO MN',
  southeast_asia: 'SG MY TH VN PH ID KH LA MM BN TL',
  south_asia: 'IN PK BD LK NP BT MV AF',
  central_asia: 'KZ UZ TM KG TJ',
  middle_east: 'AE SA QA KW BH OM YE IQ IR IL PS JO LB SY TR CY',
  europe: 'GB IE FR DE NL BE LU CH AT IT ES PT GR MT DK NO SE FI IS EE LV LT PL CZ SK HU SI HR BA RS ME MK AL XK BG RO MD UA BY RU GE AM AZ LI MC SM VA AD FO GL GI IM JE GG AX',
  africa: 'EG MA DZ TN LY SD SS ET ER DJ SO KE UG TZ RW BI CD CG CF CM GA GQ ST NG NE TD ML BF SN GM GW GN SL LR CI GH TG BJ MR CV AO ZM ZW MW MZ MG MU SC KM NA BW ZA LS SZ RE YT SH EH',
  north_america: 'US CA BM PM',
  latin_america: 'MX GT BZ SV HN NI CR PA CU JM HT DO PR BS BB TT AG DM GD KN LC VC AW CW SX BQ KY TC VG VI AI MS GP MQ BL MF CO VE GY SR GF EC PE BO BR PY UY AR CL FK',
  oceania: 'AU NZ PG FJ SB VU NC PF WS TO KI TV NR FM MH PW GU MP AS CK NU TK WF',
}
/** @type {Record<string, string>} */
export const REGION_BY_ISO = {}
for (const [region, codes] of Object.entries(R)) for (const c of codes.split(' ')) REGION_BY_ISO[c] = region
/** @param {string|null|undefined} iso2 */
export const regionOf = (iso2) => REGION_BY_ISO[String(iso2 || '').toUpperCase()] || null

export const COUNTRIES = `
KR|South Korea;Republic of Korea;Korea;대한민국;한국;韓国;韩国;韓國;Südkorea;Corée du Sud;Corea del Sur;Corea del Sud;Coreia do Sul;Zuid-Korea;Korea Południowa;Güney Kore;Южн* Коре*;كوريا الجنوبية
KP|North Korea;북한;北朝鮮;朝鲜;Nordkorea;Corée du Nord;Северн* Коре*
JP|Japan;일본;日本;Japon;Japón;Giappone;Japão;Japonia;Japonya;Япони*;اليابان
CN|China;중국;中国;中國;Chine;Cina;Chiny;Çin;Кита*;الصين
TW|Taiwan;대만;臺灣;台湾;台灣;Taïwan;Tajwan;Тайван*
HK|Hong Kong;홍콩;香港;Гонконг*
MO|Macau;Macao;마카오;澳门;澳門;マカオ
MN|Mongolia;몽골;Монголи*
SG|Singapore;싱가포르;新加坡;シンガポール;Singapur;Singapour;Сингапур*;سنغافورة
MY|Malaysia;말레이시아;马来西亚;マレーシア;Malaisie;Malasia
TH|Thailand;태국;泰国;Thaïlande;Tailandia;Tajlandia;Tayland;Таиланд*
VN|Vietnam;Viet Nam;베트남;越南;ベトナム;Việt Nam;Вьетнам*
PH|Philippines;필리핀;菲律宾;フィリピン;Filipinas;Filipiny
ID|Indonesia;인도네시아;印度尼西亚;インドネシア;Indonésie;Indonezja;Endonezya;Индонези*
IN|India;Inde;Indien;Hindistan;印度;Индия;Индии;Индию;الهند
PK|Pakistan;파키스탄;Пакистан*
BD|Bangladesh;방글라데시
LK|Sri Lanka;스리랑카
KZ|Kazakhstan;카자흐스탄;Kasachstan;Kazachstan;Казахстан*
UZ|Uzbekistan;우즈베키스탄;Узбекистан*
AE|United Arab Emirates;UAE;아랍에미리트;阿联酋;アラブ首長国連邦;Emirati Arabi Uniti;Émirats arabes unis;Emiratos Árabes Unidos;ОАЭ;الإمارات
SA|Saudi Arabia;사우디아라비아;사우디;沙特阿拉伯;サウジアラビア;Saudi-Arabien;Arabie saoudite;Arabia Saudita;Arabia Saudyjska;Suudi Arabistan;Саудовск* Арави*;السعودية
QA|Qatar;카타르;卡塔尔;カタール;Katar;Катар*;قطر
KW|Kuwait;쿠웨이트;Koweït;الكويت
BH|Bahrain;바레인;البحرين
OM|Oman
IL|Israel;이스라엘;以色列;Israël;Израил*
JO|요르단;الأردن
LB|Lebanon;레바논;Liban;Líbano;Libano;لبنان
EG|Egypt;이집트;埃及;エジプト;Ägypten;Égypte;Egipto;Egitto;Egito;Egipt;Mısır;Египет;Египта;Египте;مصر
TR|Türkiye;Turkey;튀르키예;터키;土耳其;トルコ;Türkei;Turquie;Turquía;Turchia;Turquia;Turcja;Турци*;تركيا
IR|Iran;伊朗;Иран*;إيران
IQ|Iraq;이라크;Irak;العراق
GB|United Kingdom;UK;Britain;Great Britain;England;Scotland;Wales;영국;英国;英國;イギリス;Großbritannien;Vereinigtes Königreich;Royaume-Uni;Angleterre;Reino Unido;Inglaterra;Regno Unito;Inghilterra;Verenigd Koninkrijk;Engeland;Wielka Brytania;Anglia;İngiltere;Великобритани*;Англия;Англии;بريطانيا;المملكة المتحدة
IE|Ireland;爱尔兰;Irland;Irlande;Irlanda;Ierland;Irlandia;İrlanda;Ирланди*
FR|France;프랑스;法国;法國;フランス;Frankreich;Francia;França;Frankrijk;Francja;Fransa;Франци*;فرنسا
DE|Germany;독일;德国;德國;ドイツ;Deutschland;Allemagne;Alemania;Germania;Alemanha;Duitsland;Niemcy;Niemczech;Almanya;Германи*;ألمانيا
NL|Netherlands;Holland;네덜란드;荷兰;荷蘭;オランダ;Niederlande;Pays-Bas;Países Bajos;Paesi Bassi;Países Baixos;Holanda;Nederland;Holandia;Hollanda;Нидерланд*;هولندا
BE|Belgium;벨기에;比利时;ベルギー;Belgien;Belgique;Bélgica;Belgio;België;Belgia;Belçika;Бельги*
LU|Luxembourg;룩셈부르크;Luxemburg;Luxemburgo;Lussemburgo
CH|Switzerland;스위스;瑞士;スイス;Schweiz;Suisse;Suiza;Svizzera;Suíça;Zwitserland;Szwajcaria;İsviçre;Швейцари*
AT|Austria;오스트리아;奥地利;オーストリア;Österreich;Autriche;Oostenrijk;Avusturya;Австри*
IT|Italy;이탈리아;意大利;イタリア;Italien;Italie;Italia;Itália;Italië;Włochy;Włoszech;İtalya;Итали*;إيطاليا
ES|Spain;스페인;西班牙;スペイン;Spanien;Espagne;España;Spagna;Espanha;Spanje;Hiszpania;İspanya;Испани*;إسبانيا
PT|Portugal;포르투갈;葡萄牙;ポルトガル;Portogallo;Portugalia;Portekiz;Португали*
GR|Greece;그리스;希腊;ギリシャ;Griechenland;Grèce;Grecia;Grécia;Griekenland;Grecja;Yunanistan;Греци*;Ελλάδα
DK|Denmark;덴마크;丹麦;デンマーク;Dänemark;Danemark;Dinamarca;Danimarca;Denemarken;Dania;Danimarka;Дания;Дании;Danmark
NO|Norway;노르웨이;挪威;ノルウェー;Norwegen;Norvège;Noruega;Norvegia;Noorwegen;Norwegia;Norveç;Норвеги*;Norge
SE|Sweden;스웨덴;瑞典;スウェーデン;Schweden;Suède;Suecia;Svezia;Suécia;Zweden;Szwecja;İsveç;Швеци*;Sverige
FI|Finland;핀란드;芬兰;フィンランド;Finnland;Finlande;Finlandia;Finlândia;Finlandiya;Финлянди*;Suomi
IS|Iceland;아이슬란드;Islande;Islandia;Ísland
EE|Estonia;에스토니아;Estland;Estonie
LV|Latvia;라트비아;Lettland;Lettonie;Łotwa
LT|Lithuania;리투아니아;Litauen;Lituanie;Litwa
PL|Poland;폴란드;波兰;ポーランド;Polen;Pologne;Polonia;Polônia;Polska;Polsce;Polonya;Польш*
CZ|Czech Republic;Czechia;체코;捷克;チェコ;Tschechien;Tchéquie;República Checa;Repubblica Ceca;Tsjechië;Czechy;Çekya;Чехи*;Česko
SK|Slovakia;슬로바키아;Slowakei;Słowacja
HU|Hungary;헝가리;匈牙利;ハンガリー;Ungarn;Hongrie;Hungría;Ungheria;Hongarije;Węgry;Macaristan;Венгри*;Magyarország
SI|Slovenia;슬로베니아;Slowenien;Slovénie
HR|Croatia;크로아티아;Kroatien;Croatie;Croacia;Croazia;Chorwacja;Hırvatistan;Hrvatska
RS|Serbia;세르비아;Serbien;Serbie;Сербия;Srbija
RO|Romania;루마니아;Rumänien;Roumanie;Rumania;Rumunia;Romanya;Румыни*;România;罗马尼亚
BG|Bulgaria;불가리아;Bulgarien;Bulgarie;Bułgaria;Болгари*
UA|Ukraine;우크라이나;乌克兰;ウクライナ;Ucrania;Ucraina;Ucrânia;Oekraïne;Ukraina;Ukrayna;Украин*
RU|Russia;러시아;俄罗斯;俄羅斯;ロシア;Russland;Russie;Rusia;Rússia;Rusland;Rosja;Rosji;Rusya;Росси*;روسيا
BY|Belarus;벨라루스;Белорусси*;Беларус*
AM|Armenia;아르메니아;Armenien;Arménie;Армени*
AZ|Azerbaijan;아제르바이잔;Aserbaidschan;Azerbaïdjan;Азербайджан*
US|United States;USA;U.S.;미국;美国;美國;アメリカ;米国;Vereinigte Staaten;États-Unis;Estados Unidos;Stati Uniti;Verenigde Staten;Stany Zjednoczone;Amerika Birleşik Devletleri;ABD;США;الولايات المتحدة
CA|Canada;캐나다;加拿大;カナダ;Kanada;Canadá;Канад*;كندا
MX|Mexico;México;멕시코;墨西哥;メキシコ;Mexiko;Mexique;Messico;Meksyk;Meksika;Мексик*;المكسيك
BR|Brazil;Brasil;브라질;巴西;ブラジル;Brasilien;Brésil;Brasile;Brazylia;Brezilya;Бразили*;البرازيل
AR|Argentina;아르헨티나;阿根廷;アルゼンチン;Argentinien;Argentine;Argentinië;Аргентин*
CL|Chile;칠레;智利;Cile;Чили
CO|Colombia;콜롬비아;Kolumbien;Colombie;Kolumbia;Колумби*
PE|Peru;Perú;페루;Pérou;Перу
UY|Uruguay;우루과이
CU|Cuba;쿠바;Kuba;Куба
AU|Australia;호주;오스트레일리아;澳大利亚;澳洲;オーストラリア;Australien;Australie;Austrália;Australië;Avustralya;Австрали*;أستراليا
NZ|New Zealand;뉴질랜드;新西兰;ニュージーランド;Neuseeland;Nouvelle-Zélande;Nueva Zelanda;Nuova Zelanda;Nieuw-Zeeland;Nowa Zelandia;Yeni Zelanda;Нов* Зеланди*
ZA|South Africa;남아프리카공화국;남아공;南非;南アフリカ;Südafrika;Afrique du Sud;Sudáfrica;Sudafrica;África do Sul;Zuid-Afrika;RPA;Güney Afrika;ЮАР
NG|Nigeria;나이지리아;Nigéria
KE|Kenya;케냐;Kenia
MA|Morocco;모로코;Marokko;Maroc;Marruecos;Marocco;Marrocos;Maroko;Марокко;المغرب
TN|Tunisia;튀니지;Tunesien;Tunisie;Túnez;تونس
DZ|Algeria;알제리;Algerien;Algérie;Argelia;الجزائر
ET|Ethiopia;에티오피아;Äthiopien;Éthiopie;Etiopía
GH|Ghana
RW|Rwanda;르완다;Ruanda
`

export const CITIES = `
KR|Seoul;서울;ソウル;首尔;首爾;Séoul;Seúl;Сеул*
KR|Busan;Pusan;부산;釜山;Пусан*
KR|Incheon;인천;仁川
KR|Daegu;대구;大邱
KR|Daejeon;대전광역시;大田
KR|Gwangju;광주광역시;광주;光州
KR|Ulsan;울산;蔚山
KR|Suwon;수원;水原
KR|Sejong City;세종시
KR|Jeju;제주;済州;济州
KR|Gangneung;강릉
KR|Jeonju
KR|Changwon;창원
KR|Pohang;포항
KR|Seongnam;성남
KR|Yongin
KR|Paju;파주
JP|Tokyo;도쿄;東京;Tokio;Tokyo;Tóquio;Токио;طوكيو
JP|Osaka;오사카;大阪;Осак*
JP|Kyoto;교토;京都;Киото
JP|Yokohama;요코하마;横浜;横滨
JP|Nagoya;나고야;名古屋
JP|Fukuoka;후쿠오카;福岡
JP|Sapporo;삿포로;札幌
JP|고베;神戸;神户
JP|Hiroshima;히로시마;広島;广岛
JP|Sendai;센다이;仙台
CN|Beijing;Peking;베이징;北京;ペキン;Pékin;Pekín;Pechino;Pequim;Pekin;Пекин*;بكين
CN|Shanghai;상하이;上海;シャンハイ;Shanghái;Szanghaj;Şanghay;Шанха*;شنغهاي
CN|Shenzhen;深圳;Шэньчжэн*
CN|Guangzhou;광저우;广州;廣州;Гуанчжоу
CN|Hangzhou;항저우;杭州
CN|Chengdu;청두;成都
CN|Chongqing;충칭;重庆;重慶
CN|Wuhan;우한;武汉;武漢
CN|Xi'an;Xian
CN|Nanjing;난징;南京
CN|Tianjin;톈진;天津
CN|Suzhou;쑤저우;苏州;蘇州
CN|Qingdao;칭다오;青岛;青島
CN|Xiamen;厦门;廈門
CN|Harbin;하얼빈;哈尔滨
CN|Zhengzhou;정저우;郑州
TW|Taipei;타이베이;台北;臺北;Тайбэй
TW|Kaohsiung;가오슝;高雄
TW|Taichung;타이중
HK|Hong Kong;홍콩;香港
MO|Macau;Macao;마카오;澳门;澳門
SG|Singapore;싱가포르;新加坡;シンガポール
MY|Kuala Lumpur;쿠알라룸푸르;吉隆坡
TH|Bangkok;방콕;曼谷;バンコク;Бангкок*;กร\u0e38งเทพ
VN|Ho Chi Minh City;Saigon;호찌민;호치민;胡志明市;Hồ Chí Minh
VN|Hanoi;하노이;河内;Hà Nội
PH|Manila;마닐라;马尼拉
ID|Jakarta;자카르타;雅加达;Dżakarta
IN|Mumbai;뭄바이;孟买;Мумба*
IN|New Delhi;Delhi;뉴델리;新德里;Дели
IN|Bengaluru;Bangalore;벵갈루루
PK|Karachi;Lahore
BD|Dhaka
LK|Colombo
KZ|Almaty;알마티;Алмат*
KZ|Astana;아스타나;Астан*
UZ|Tashkent;타슈켄트;Ташкент*
AE|Dubai;두바이;迪拜;ドバイ;Dubaj;Dubái;Дубай*;دبي
AE|Abu Dhabi;아부다비;阿布扎比;Абу-Даби;أبوظبي;أبو ظبي
AE|Sharjah;샤르자;الشارقة
SA|Riyadh;리야드;利雅得;Rijad;Эр-Рияд*;الرياض
SA|Jeddah;Jiddah
SA|AlUla;Al-Ula;알울라;العلا
QA|Doha;多哈;Доха;الدوحة
KW|Kuwait City;مدينة الكويت
BH|Manama;المنامة
OM|Muscat
IL|Tel Aviv;텔아비브;特拉维夫;Тель-Авив*
LB|Beirut;베이루트;Beyrouth;Бейрут*;بيروت
JO|Amman;암만
EG|Cairo;카이로;开罗;Kairo;Le Caire;El Cairo;Il Cairo;Kair;Kahire;Каир*;القاهرة
MA|Casablanca;카사블랑카;الدار البيضاء
MA|Marrakech;Marrakesh;마라케시;مراكش
TN|Tunis
NG|Lagos;라고스
KE|Nairobi;나이로비
ZA|Johannesburg;요하네스버그
ZA|Cape Town;케이프타운;Kapstadt;Ciudad del Cabo
RW|Kigali
GH|Accra
ET|Addis Ababa;아디스아바바
TR|Istanbul;İstanbul;이스탄불;伊斯坦布尔;イスタンブール;Estambul;Stambuł;Стамбул*;إسطنبول
TR|Ankara;앙카라;Анкар*
TR|Izmir;İzmir;이즈미르
GB|London;런던;伦敦;倫敦;ロンドン;Londres;Londra;Londen;Londyn*;Лондон*;لندن
GB|Manchester;맨체스터
GB|Birmingham;버밍엄
GB|Liverpool;리버풀
GB|Edinburgh;에든버러;Édimbourg;Edimburgo
GB|Glasgow;글래스고
GB|Durham
IE|Dublin;더블린;Dublín;Дублин*
FR|Paris;파리;巴黎;パリ;París;Parigi;Paryż*;Париж*;باريس
FR|Lyon;리옹;里昂;リヨン;Lione;Lyonie;Лион;Лионе
FR|Marseille;마르세유;Marsella;Marsiglia
FR|Lille
FR|Bordeaux;보르도
FR|Strasbourg;스트라스부르;Straßburg;Estrasburgo
FR|Toulouse;툴루즈
FR|Nantes;낭트
DE|Berlin;베를린;柏林;ベルリン;Berlín;Berlino;Berlim;Berlinie;Берлин*;برلين
DE|Hamburg;함부르크;Hambourg;Hamburgo;Amburgo;Гамбург;Гамбурге;Гамбурга
DE|Munich;München;뮌헨;慕尼黑;ミュンヘン;Múnich;Monaco di Baviera;Monachium;Мюнхен*
DE|Frankfurt;프랑크푸르트;法兰克福;Francfort;Fráncfort;Francoforte;Франкфурт*
DE|Cologne;Köln;쾰른;Colonia;Kolonia;Кёльн*
DE|Stuttgart;슈투트가르트
DE|Düsseldorf;뒤셀도르프
DE|Leipzig;라이프치히
DE|Dresden;드레스덴
AT|Vienna;Wien;维也纳;ウィーン;Viena;Wiedeń;Viyana;Вена;Вене;Вену;Вены
AT|Linz;린츠;林茨;Линц*
AT|Graz;그라츠
CH|Zurich;Zürich;취리히;苏黎世;Zúrich;Zurigo;Zurych;Цюрих*
CH|Geneva;Genève;Genf;제네바;日内瓦;Ginebra;Ginevra;Genewa;Женев*
CH|Basel;바젤;Basilea;Bazylea
NL|Amsterdam;암스테르담;阿姆斯特丹;アムステルダム;Ámsterdam;Amsterdamie;Амстердам*
NL|Rotterdam;로테르담;鹿特丹;Rotterdamie
NL|Eindhoven;에인트호번;아인트호벤
NL|The Hague;Den Haag;헤이그;La Haye;La Haya;L'Aia
NL|Utrecht;위트레흐트
BE|Brussels;Bruxelles;Brussel;브뤼셀;布鲁塞尔;Bruselas;Bruxelas;Bruksel*;Брюссел*
BE|Antwerp;Antwerpen;Anvers;앤트워프;Amberes;Anversa
BE|Ghent;Gand;겐트
ES|Madrid;마드리드;马德里;Madryt*;Мадрид*;مدريد
ES|Barcelona;바르셀로나;巴塞罗那;Barcelone;Barcellona;Barcelonie;Барселон*
ES|Valencia;발렌시아;Valence;Walencja
ES|Seville;Sevilla;세비야;Séville;Siviglia;Sewilla
ES|Bilbao;빌바오
ES|Málaga;Malaga;말라가
PT|Lisbon;Lisboa;리스본;里斯本;Lisbonne;Lisbona;Lizbon*;Лиссабон*
IT|Rome;Roma;罗马;ローマ;Rzym*;Рим;Рима;Риме;روما
IT|Milan;Milano;밀라노;米兰;ミラノ;Milán;Mailand;Mediolan*;Милан*
IT|Turin;Torino;토리노;Turyn
IT|Venice;Venezia;베네치아;베니스;Venise;Venecia;Veneza;Venedig;Wenecj*;Венеци*
IT|Naples;Napoli;나폴리;Nápoles;Neapel
IT|Bologna;볼로냐;Bologne;Bolonia
GR|Athens;아테네;雅典;Athen;Athènes;Atenas;Atene;Ateny;Афин*;Αθήνα
DK|Copenhagen;København;코펜하겐;哥本哈根;Kopenhagen;Copenhague;Copenaghen;Kopenhaga;Копенгаген*
NO|Oslo;오슬로
SE|Stockholm;스톡홀름;斯德哥尔摩;Estocolmo;Stoccolma;Sztokholm*;Стокгольм*
FI|Helsinki;헬싱키;Хельсинки
IS|Reykjavik;Reykjavík;레이캬비크
EE|Tallinn;탈린
LV|
LT|Vilnius;빌뉴스;Wilno
PL|Warsaw;Warszaw*;바르샤바;华沙;Varsovie;Varsovia;Varsavia;Varşova;Варшав*
PL|Kraków;Krakow*;크라쿠프;Cracovie;Cracovia;Краков*
PL|Wrocław;Wrocław*;Breslau;브로츠와프
PL|Gdańsk;Gdańsk*;Gdańsku;Danzig;그단스크
PL|Łódź;Łodzi;Lodz
PL|Poznań;Poznani*;포즈난
CZ|Prague;Praha;프라하;布拉格;Prag;Praga;Pradze;Прага;Праге
HU|Budapest;부다페스트;布达佩斯;Budapeszt*;Будапешт*
SK|Bratislava;브라티슬라바
SI|Ljubljana;류블랴나
HR|Zagreb;자그레브
RS|Belgrade;Beograd;베오그라드;Belgrad
RO|Bucharest;București;부쿠레슈티;Bukarest;Bucarest;Bukareszt
UA|Kyiv;Kiev;키이우;키예프;Kijów;Kiew;Київ;Киев*
RU|Moscow;모스크바;莫斯科;モスクワ;Moskau;Moscou;Moscú;Mosca;Moskou;Moskwa;Moskwie;Moskova;Москв*;موسكو
RU|Saint Petersburg;St. Petersburg;St Petersburg;상트페테르부르크;圣彼得堡;Sankt Petersburg;Saint-Pétersbourg;San Petersburgo;San Pietroburgo;Petersburg;Санкт-Петербург*;Петербург*
RU|Kazan;카잔;Казан*
BY|Minsk;민스크;Минск*
GE|Tbilisi;트빌리시;Тбилиси
AM|Yerevan;예레반;Ереван*
AZ|Baku;Баку
US|New York;New York City;NYC;뉴욕;纽约;紐約;ニューヨーク;Nueva York;Nowy Jork;Nowym Jorku;Нью-Йорк*;نيويورك
US|Las Vegas;라스베이거스;라스베가스;拉斯维加斯;ラスベガス;Лас-Вегас*
US|Los Angeles;로스앤젤레스;洛杉矶;ロサンゼルス;Лос-Анджелес*
US|Chicago;시카고;芝加哥;シカゴ;Чикаго
US|San Francisco;샌프란시스코;旧金山;サンフランシスコ;Сан-Франциско
US|Miami;마이애미;迈阿密;Майами
US|Seattle;시애틀;西雅图
US|Boston;보스턴;波士顿;Бостон*
US|Houston;휴스턴
US|Dallas;댈러스
US|Atlanta;애틀랜타
US|Philadelphia;필라델피아
US|Denver;덴버
CA|Toronto;토론토;多伦多;Торонто
CA|Montreal;Montréal;몬트리올;蒙特利尔;Монреаль*
CA|Vancouver;밴쿠버;温哥华;Ванкувер*
MX|Mexico City;Ciudad de México;멕시코시티;墨西哥城;Mexiko-Stadt
MX|Guadalajara;과달라하라
MX|Monterrey;몬테레이
BR|São Paulo;Sao Paulo;상파울루;圣保罗;Сан-Паулу
BR|Rio de Janeiro;리우데자네이루;里约热内卢;Рио-де-Жанейро
AR|Buenos Aires;부에노스아이레스;布宜诺斯艾利斯;Буэнос-Айрес*
CO|Bogotá;Bogota;보고타
CO|Medellín;Medellin;메데인
CU|Havana;La Habana;Havanna;아바나
AU|Sydney;시드니;悉尼;シドニー;Sídney;Сидне*;سيدني
AU|Melbourne;멜버른;墨尔本;メルボルン;Мельбурн*
AU|Brisbane;브리즈번
AU|Perth
AU|Adelaide;애들레이드
NZ|Auckland;오클랜드;奥克兰
`

/** @typedef {{iso2: string, names: string[], city?: string}} Place */
/** @param {string} text @param {boolean} cities @returns {Place[]} */
function parse(text, cities) {
  /** @type {Place[]} */
  const out = []
  for (const line of text.split('\n')) {
    const [iso2, names] = line.split('|')
    if (!iso2 || !names) continue
    const list = names.split(';').map((n) => n.trim()).filter(Boolean)
    out.push(cities ? { iso2, names: list, city: list[0].replace(/\*$/, '') } : { iso2, names: list })
  }
  return out
}
export const COUNTRY_LIST = parse(COUNTRIES, false)
export const CITY_LIST = parse(CITIES, true)
