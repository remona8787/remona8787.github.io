// Realistic positive and negative titles/excerpts for the archive classifier, in every language it claims to support.
// `relevant` is the human judgement (is this something an archive editor should review?); `label` the expected label.
// Positives: media facades, facade projection mapping, light festivals on buildings. Negatives: LED vendors, rentals,
// advertising sales, jobs, real estate, unrelated facade renovation, projection-mapping concerts on a stage.

/** @type {{lang: string, title: string, excerpt?: string, relevant: boolean, label: string}[]} */
export const CASES = [
  // ---- en ----
  { lang: 'en', relevant: true, label: 'facade_project', title: 'Lotte World Tower unveils new media facade content for autumn', excerpt: 'The 555-metre skyscraper in Seoul switched on a new programme on its LED skin.' },
  { lang: 'en', relevant: true, label: 'facade_project', title: 'Projection mapping transforms cathedral facade into a canvas', excerpt: 'Artists projected animations onto the Romanesque facade of the cathedral.' },
  { lang: 'en', relevant: true, label: 'event_program', title: 'Vivid Sydney 2026 returns with light installations across the harbour', excerpt: 'The festival of light projects artworks onto the Opera House sails and nearby buildings.' },
  { lang: 'en', relevant: false, label: 'product_vendor', title: 'Outdoor LED Media Facade Screen Manufacturer – Factory Price, OEM', excerpt: 'Wholesale transparent LED mesh. Get a quote today, free shipping on samples.' },
  { lang: 'en', relevant: false, label: 'product_vendor', title: 'LED screen rental for concerts, festivals and corporate events', excerpt: 'Rent a mobile LED video wall with operator. Prices on request.' },
  { lang: 'en', relevant: false, label: 'irrelevant', title: 'Band announces projection mapping concert tour with laser stage show', excerpt: 'Fans can expect a live show with projection mapping on stage and pyrotechnics.' },
  { lang: 'en', relevant: false, label: 'irrelevant', title: 'Facade renovation of the old town hall begins in November', excerpt: 'Workers will replace the crumbling stone facade and repair the roof.' },
  { lang: 'en', relevant: false, label: 'irrelevant', title: 'We are hiring: lighting designer for media facade projects', excerpt: 'Apply now for this job opening in our London studio. Career growth guaranteed.' },
  // ---- ko ----
  { lang: 'ko', relevant: true, label: 'facade_project', title: '롯데월드타워 미디어파사드 가을 콘텐츠 첫 공개', excerpt: '서울 송파구 롯데월드타워 외벽에 설치된 미디어파사드에서 새 영상이 상영됐다.' },
  { lang: 'ko', relevant: true, label: 'event_program', title: '광화문 서울라이트 빛축제 개막…건물 외벽이 캔버스로', excerpt: '광화문광장 일대 건물 외벽에서 미디어아트 작품이 상영된다.' },
  { lang: 'ko', relevant: true, label: 'facade_project', title: '부산시청 외벽에 프로젝션 매핑 작품 상영', excerpt: '부산시청 건물 외벽을 활용한 프로젝션 매핑 공연이 매일 밤 열린다.' },
  { lang: 'ko', relevant: false, label: 'product_vendor', title: '미디어파사드 LED 메쉬 전문업체 최저가 견적 문의', excerpt: 'LED 미디어파사드 제작 설치 시공 문의 환영, 렌탈 가능' },
  { lang: 'ko', relevant: false, label: 'irrelevant', title: '미디어파사드 특화 아파트 분양…모델하우스 오픈', excerpt: '청약 일정과 분양가, 모델하우스 위치 안내' },
  { lang: 'ko', relevant: false, label: 'irrelevant', title: '[채용] 미디어아트 콘텐츠 디자이너 경력직 채용공고', excerpt: '신입사원 및 경력직 모집, 서류 접수 중' },
  { lang: 'ko', relevant: false, label: 'irrelevant', title: '구청사 외벽 보수공사 내달 착공', excerpt: '노후 외벽 타일을 교체하고 방수 공사를 진행한다.' },
  // ---- ja ----
  { lang: 'ja', relevant: true, label: 'facade_project', title: '東京都庁舎のプロジェクションマッピング、冬の新作を公開', excerpt: '都庁第一本庁舎の外壁で新しい作品の上映が始まった。' },
  { lang: 'ja', relevant: true, label: 'facade_project', title: '渋谷の新ビルにメディアファサード　外壁全体がLEDに', excerpt: '高さ200メートルのビルの外壁に設置されたメディアファサードが点灯した。' },
  { lang: 'ja', relevant: false, label: 'product_vendor', title: 'LEDビジョン レンタル 格安 見積無料', excerpt: 'イベント用LEDビジョンのレンタル。価格はお問い合わせください。' },
  { lang: 'ja', relevant: false, label: 'irrelevant', title: 'ライブツアーでプロジェクションマッピング演出、ファン熱狂', excerpt: 'ステージ上の演出が話題に。' },
  { lang: 'ja', relevant: false, label: 'irrelevant', title: 'メディアファサードのデザイナー求人　採用情報', excerpt: 'アルバイトも募集中。' },
  // ---- zh ----
  { lang: 'zh', relevant: true, label: 'facade_project', title: '上海中心大厦媒体立面首秀 点亮浦东夜景', excerpt: '632米高的大楼外墙安装了数万个LED像素点。' },
  { lang: 'zh', relevant: true, label: 'event_program', title: '广州国际灯光节开幕 花城广场建筑投影亮相', excerpt: '多座地标建筑外墙上演光影秀。' },
  { lang: 'zh', relevant: false, label: 'product_vendor', title: 'LED幕墙厂家直销 媒体立面报价 批发', excerpt: '供应商提供户外大屏，价格优惠。' },
  { lang: 'zh', relevant: false, label: 'irrelevant', title: '诚聘媒体建筑设计师 招聘', excerpt: '求职者请投递简历。' },
  { lang: 'zh', relevant: false, label: 'irrelevant', title: '楼盘售楼处开放 外墙采用媒体立面设计', excerpt: '房地产项目开盘，欢迎购房。' },
  // ---- de ----
  { lang: 'de', relevant: true, label: 'facade_project', title: 'Neue Medienfassade am Kunsthaus Graz zeigt Werke junger Künstler', excerpt: 'Die LED-Fassade des Gebäudes wird zur Leinwand für digitale Kunst.' },
  { lang: 'de', relevant: true, label: 'event_program', title: 'Festival of Lights: Projektionen auf dem Berliner Dom', excerpt: 'Zehn Tage lang verwandeln Lichtkünstler Fassaden und Wahrzeichen der Stadt.' },
  { lang: 'de', relevant: false, label: 'product_vendor', title: 'LED-Wand mieten – Vermietung für Events und Messen', excerpt: 'Jetzt kaufen oder mieten, Angebot anfordern.' },
  { lang: 'de', relevant: false, label: 'irrelevant', title: 'Sanierung der Fassade am Rathaus beginnt im November', excerpt: 'Das Gebäude erhält neue Fenster und eine Dämmung.' },
  // ---- fr ----
  { lang: 'fr', relevant: true, label: 'event_program', title: 'Fête des Lumières : la cathédrale Saint-Jean en mapping vidéo', excerpt: 'Les façades du Vieux-Lyon deviennent des écrans pour les artistes.' },
  { lang: 'fr', relevant: true, label: 'facade_project', title: 'Une façade média de 3 000 m² inaugurée sur la tour de la Défense', excerpt: 'Le bâtiment est équipé de 40 000 pixels LED.' },
  { lang: 'fr', relevant: false, label: 'product_vendor', title: 'Écran LED géant : fabricant et fournisseur, devis gratuit', excerpt: 'Location de matériel et vente, demandez un devis.' },
  { lang: 'fr', relevant: false, label: 'irrelevant', title: 'Offre d’emploi : chef de projet éclairage, recrutement immédiat', excerpt: 'Nous recrutons un chef de projet.' },
  // ---- es ----
  { lang: 'es', relevant: true, label: 'facade_project', title: 'Inauguran la fachada multimedia del nuevo centro cultural de Madrid', excerpt: 'El edificio cuenta con una fachada de LED de 2.000 metros cuadrados.' },
  { lang: 'es', relevant: true, label: 'facade_project', title: 'Videomapping sobre la fachada de la catedral de Sevilla', excerpt: 'Proyecciones sobre la fachada del templo durante tres noches.' },
  { lang: 'es', relevant: false, label: 'product_vendor', title: 'Alquiler de pantallas LED para eventos, precios y presupuesto', excerpt: 'Proveedor mayorista de pantallas gigantes.' },
  { lang: 'es', relevant: false, label: 'irrelevant', title: 'Se vende piso en edificio con fachada rehabilitada', excerpt: 'Inmobiliaria ofrece departamento en venta, 3 habitaciones.' },
  // ---- it ----
  { lang: 'it', relevant: true, label: 'facade_project', title: 'Milano, la nuova facciata mediatica del grattacielo si accende', excerpt: 'Diecimila LED trasformano l’edificio in uno schermo urbano.' },
  { lang: 'it', relevant: true, label: 'event_program', title: 'Festival delle luci: videomapping sulla facciata del Duomo', excerpt: 'Proiezioni sulla facciata della cattedrale ogni sera.' },
  { lang: 'it', relevant: false, label: 'product_vendor', title: 'Noleggio ledwall e maxischermi per eventi, preventivo gratuito', excerpt: 'Fornitore all’ingrosso, prezzi competitivi.' },
  { lang: 'it', relevant: false, label: 'irrelevant', title: 'Offerta di lavoro: progettista illuminotecnico, lavora con noi', excerpt: 'Cerchiamo una figura junior.' },
  // ---- pt ----
  { lang: 'pt', relevant: true, label: 'facade_project', title: 'Edifício em São Paulo ganha fachada de mídia com 30 mil LEDs', excerpt: 'A nova fachada digital do prédio foi inaugurada nesta semana.' },
  { lang: 'pt', relevant: true, label: 'event_program', title: 'Festival de luz projeta videomapping na fachada da igreja', excerpt: 'As projeções na fachada acontecem todas as noites.' },
  { lang: 'pt', relevant: false, label: 'product_vendor', title: 'Aluguel de painel de LED para eventos – orçamento grátis', excerpt: 'Fornecedor no atacado, preços baixos, solicite um orçamento.' },
  { lang: 'pt', relevant: false, label: 'irrelevant', title: 'Vagas de emprego para arquiteto: trabalhe conosco', excerpt: 'Vagas abertas em escritório de arquitetura.' },
  // ---- nl ----
  { lang: 'nl', relevant: true, label: 'facade_project', title: 'Nieuwe mediagevel maakt van het stadhuis een lichtkunstwerk', excerpt: 'De gevel van het gebouw is voorzien van duizenden leds.' },
  { lang: 'nl', relevant: true, label: 'event_program', title: 'Amsterdam Light Festival: gevelprojectie op het Rijksmuseum', excerpt: 'Het lichtfestival toont kunstwerken langs de grachten.' },
  { lang: 'nl', relevant: false, label: 'product_vendor', title: 'LED scherm huren? Verhuur van videowanden – offerte aanvragen', excerpt: 'Leverancier van groot scherm, scherpe prijzen.' },
  { lang: 'nl', relevant: false, label: 'irrelevant', title: 'Vacature: projectarchitect, solliciteer nu', excerpt: 'Wij zoeken een collega voor ons team.' },
  // ---- pl ----
  { lang: 'pl', relevant: true, label: 'facade_project', title: 'Fasada medialna na nowym wieżowcu w Warszawie już działa', excerpt: 'Budynek pokryto tysiącami diod LED, które wyświetlają animacje.' },
  { lang: 'pl', relevant: true, label: 'event_program', title: 'Festiwal Światła w Łodzi: mapping na fasadzie katedry', excerpt: 'Projekcje na budynkach przyciągnęły tłumy.' },
  { lang: 'pl', relevant: false, label: 'product_vendor', title: 'Wynajem ekranów LED na eventy – cena i darmowa wycena', excerpt: 'Dostawca hurtowy ekranów reklamowych.' },
  { lang: 'pl', relevant: false, label: 'irrelevant', title: 'Mieszkania na sprzedaż w nowym budynku z odnowioną fasadą', excerpt: 'Deweloper oferuje nieruchomości w centrum.' },
  // ---- ru ----
  { lang: 'ru', relevant: true, label: 'facade_project', title: 'В Москве запустили медиафасад на здании небоскреба', excerpt: 'Светодиодный фасад башни показывает работы художников.' },
  { lang: 'ru', relevant: true, label: 'event_program', title: 'Фестиваль «Круг света»: видеомэппинг на фасаде Большого театра', excerpt: 'Проекции на здании театра покажут пять вечеров.' },
  { lang: 'ru', relevant: false, label: 'product_vendor', title: 'Медиафасад купить: цены от производителя, аренда экранов', excerpt: 'Поставщик светодиодных экранов оптом.' },
  { lang: 'ru', relevant: false, label: 'irrelevant', title: 'Вакансия: архитектор, требуется опыт работы', excerpt: 'Резюме присылайте на почту.' },
  // ---- ar ----
  { lang: 'ar', relevant: true, label: 'facade_project', title: 'تدشين واجهة إعلامية جديدة على برج في دبي', excerpt: 'تحولت واجهة المبنى إلى شاشة ضخمة تعرض أعمالا فنية.' },
  { lang: 'ar', relevant: true, label: 'event_program', title: 'مهرجان نور الرياض يضيء واجهات المباني بأعمال فن الضوء', excerpt: 'عروض ضوئية على المباني التاريخية طوال الأسبوع.' },
  { lang: 'ar', relevant: false, label: 'product_vendor', title: 'تأجير شاشات LED للمناسبات بأفضل سعر', excerpt: 'مصنع ومورد شاشات عملاقة، اطلب عرض سعر.' },
  { lang: 'ar', relevant: false, label: 'irrelevant', title: 'وظائف شاغرة: مطلوب موظف مهندس معماري', excerpt: 'فرص عمل في شركة تصميم.' },
  // ---- tr ----
  { lang: 'tr', relevant: true, label: 'facade_project', title: 'İstanbul’daki gökdelenin medya cephesi ilk kez yandı', excerpt: 'Binanın cephesi binlerce LED ile dev bir ekrana dönüştü.' },
  { lang: 'tr', relevant: true, label: 'event_program', title: 'Işık festivali: tarihi binaya projeksiyon mapping gösterisi', excerpt: 'Festival boyunca cepheye projeksiyon yapılacak.' },
  { lang: 'tr', relevant: false, label: 'product_vendor', title: 'LED ekran kiralama – en uygun fiyat teklifi', excerpt: 'Tedarikçi firmadan toptan dev ekran satış.' },
  { lang: 'tr', relevant: false, label: 'irrelevant', title: 'Satılık daire: yeni konut projesinde fırsat', excerpt: 'Emlak ofisimizden satılık daireler.' },
]
