# Archive operations console (admin track, v0.16)

The console lives in `site-public-cleared/admin/` (served at `/admin/`) and is copied unchanged to `admin/`;
`npm run check` fails if the two `app.js` files differ, and every other file is kept identical too. It is a static page
under the site CSP (no inline scripts or handlers; `connect-src` allows `*.supabase.co`). It loads `./config.js`
(public URL and publishable key only), `../archive-taxonomy.js` (every vocabulary label) and `../assets/supabase.js`
(the pinned supabase-js bundle built by `scripts/build.mjs`).

Everything here is **mock-tested only** (`qa/admin.spec.mjs` with `qa/admin-fixtures.mjs`, Supabase mocked through
Playwright routes). Nothing has run against a live Supabase project yet.

## Roles

`app_admins.role` is `admin`, `editor` or `researcher` (ARCHIVE_SPEC §4); `archive_role()` returns it, or null.
After sign-in the console calls `archive_role`; anyone without a role is signed out with a message. The console
hides what a role may not do, and the database functions enforce it.

| | researcher | editor | admin |
|---|---|---|---|
| 연구자 평가 (read published projects, add assessments) | ✓ | ✓ | ✓ |
| 대시보드, 검수 대기열, 프로젝트, 변경 감지, 수집 작업 (read) | | ✓ | ✓ |
| 수집 규칙·키워드 | | read only | edit |
| 지금 수집 실행, 다시 시도 (Edge Function `archive-collect`) | | | ✓ |
| 설정 | | | ✓ |
| 매거진, 장소 후보 (v0.10 tools, `is_app_admin()`) | | ✓ | ✓ |

### Granting a role

The person first creates an account (Supabase Auth, email and password). Then, in the SQL Editor:

```sql
-- Grant or change a role (admin | editor | researcher).
insert into public.app_admins (user_id, role)
select id, 'editor' from auth.users where email = 'person@example.org'
on conflict (user_id) do update set role = excluded.role;

-- Who has which role.
select u.email, a.role, a.created_at
from public.app_admins a join auth.users u on u.id = a.user_id
order by a.role, u.email;

-- Remove a role (the account stays; it can no longer open the console).
delete from public.app_admins
where user_id = (select id from auth.users where email = 'person@example.org');
```

Accounts made with the v0.10 bootstrap (`supabase/13_admin_review_console.sql`) have `role = 'owner'`. That value is
outside the v0.16 role list, so set those rows to `admin`:
`update public.app_admins set role = 'admin' where role = 'owner';`.
Because `is_app_admin()` stays true for admin and editor, editors keep the v0.10 tools. The `can_promote` and
`can_run_discovery` columns still gate the legacy place-promotion and discovery buttons.

## Screens

**로그인.** Email and password through supabase-js. A wrong password shows "이메일 또는 비밀번호가 맞지 않아요.";
an account without a role, or a database without `archive_role`, is signed out with a message that says why.

**대시보드.** Counts from `archive_admin_dashboard()`: queue (검수 대기 + 판단 보류, with a breakdown by status), runs in
24 h and 7 d, collection errors, open updates, broken links, sources by link state, projects by visibility and by
review state. Below that: "살펴볼 규칙" (failing rules or rules in backoff, with 다시 시도 for admins), recent runs
(`archive_admin_list_runs`), and for admins "지금 수집 실행". That form POSTs `{rule_ids:[id]}` or `{max_rules:n}` (1–6)
to `{SUPABASE_URL}/functions/v1/archive-collect` with `Authorization: Bearer <user access token>` and the `apikey`
header, then shows the response.

**검수 대기열.**
- Filters: status (default: needs_review and uncertain), minimum confidence, and free-text search.
- Each list row shows the title, classifier label, score, confidence, hit count, location, and first and last seen.
- The detail drawer (a full-screen sheet below 900 px) shows:
  - every hit, with title, publisher, provider and date, the ≤300-character excerpt, and the link (new tab,
    `rel="noopener noreferrer"`, http/https only);
  - the classifier reasons and version;
  - the detected country, city, coordinates and language;
  - suggested matching projects, each with an attach button.
- Actions, all through `archive_admin_review_candidate`:
  - **approve_new**: a form prefilled from the detection (original name and language, country as an ISO select with
    Korean labels, city, coordinates, and a project type taken from the label) plus a "승인하면서 바로 공개" toggle.
  - **attach** to a suggested project, or to one found with the project search.
  - **merge** into another listed candidate.
  - **reject**, which requires a note (checked in the browser before any call).
  - **ignore**.
  - **reopen**, for processed or auto-ignored candidates.
- After an action the next candidate opens.
- Keyboard: `j`/`k` move, `Enter` opens, `Esc` closes, `/` jumps to search. The shortcuts are listed on screen and
  never fire while typing.

**프로젝트.**
- List: search and a visibility filter (`archive_admin_list_projects`), plus "새 프로젝트".
- Editor groups, following the spec:
  - 기본 정보: names, aliases, location, years, status, type, URL, QID.
  - 기술·건축: installation, envelope, technology, area, resolution, pixel pitch, content, interactivity.
  - 맥락: viewing points, spatial and urban context, summaries.
  - 크레딧.
- Every field shows its field state from `field_status`: 미확인, 출처 기재, 분류 추정, 편집 확인 or 연구자 평가. A blank
  field is always 미확인.
- Changing a value, or pressing "값 확인" on a collected value, marks the field "편집 확인 · 저장 전". Saving sends only
  those fields (see contract changes), and the server marks them editor_verified.
- Vocabulary fields are selects or checkbox groups labelled from `archive-taxonomy.js`.
- Below the form:
  - **출처**: add a source with its kind, language, date, licence and supported fields (`archive_admin_add_source`), or
    remove one with a two-step button (`archive_admin_remove_source`).
  - **미디어**: add, edit or remove media (`archive_admin_set_media`, `archive_admin_remove_media`). "대표 이미지" is
    enabled only when the rights status is 사용 가능 (cleared) and the licence is CC0, CC BY, CC BY-SA or public domain
    (the same rule as `licenseAllowed` in the image pipeline). A cleared image needs an author or an attribution.
  - **공개 상태**: publish, hide or set back to draft, with a note (`archive_admin_set_visibility`). Hiding needs a note,
    and publishing needs at least one source.
  - **합치기**: search for another project and merge it into this one (`archive_admin_merge_projects`, two-step button).

**변경 감지.** `archive_admin_list_updates` (filter: open, applied, dismissed or all), rendering new sources as links,
changed fields as old → new, and other detail keys with Korean labels. 반영 and 무시 call
`archive_admin_resolve_update` with `apply` and `dismiss`. "프로젝트 열기" jumps to the project editor.

**수집 작업.** Runs table (`archive_admin_list_runs`, filterable by rule) with status, trigger, duration and every
count. A rule-state table from `archive_admin_list_rules` shows last status, last and next run, consecutive failures
and backoff time, with 다시 시도 for admins on enabled rules. Below it, the recent errors from
`archive_admin_list_errors`.

**수집 규칙·키워드.** Admins can enable or disable a rule (enabling Brave takes a second press because it costs money)
and edit its cadence, query or feed URL, terms URL and notes. They can also add rules and create, edit and delete
keywords with polarity, weight and language. Editors see the same lists read-only, with a notice. Keyed sources
(NAVER, Brave) say that they need server-side keys.

**설정 (admin).** `auto_list_structured`, `review_threshold` and `auto_ignore_below`, validated as
`0 ≤ auto_ignore_below < review_threshold ≤ 100` before `archive_admin_set_settings`.

**연구자 평가.** The list and detail come from the public `archive_search` (published projects only). The detail shows
known fields with their states, the remaining 미확인 fields, credits, sources and existing assessments. "평가 추가"
picks an archive field (the value widget follows the field's vocabulary) or a research attribute (significance,
design quality, urban impact, authorship, other), then a confidence, a method (required) and a note, and calls
`archive_research_add_assessment`. Assessments stay separate from collected and editor-verified data.

**매거진, 장소 후보.** The v0.10 tools, unchanged on the server: `archive_articles` insert, and the
`external_candidates` RPCs with discovery through `admin-discovery-command`. The old `prompt()`/`alert()` dialogs are
replaced by inline forms.

## RPCs and parameter objects the console sends

These are the exact names and parameter objects (bodies of `POST /rest/v1/rpc/<name>`), as asserted in
`qa/admin.spec.mjs`. The db track's signatures must accept these parameter names.

```text
archive_role                      {}
archive_admin_dashboard           {}
archive_admin_list_candidates     {p_status: text|null, p_q: text|null, p_min_conf: int, p_limit: 50, p_offset: int}
archive_admin_review_candidate    {p_id, p_action: 'approve_new', p_payload: {<non-empty project fields>, publish: bool}}
                                  {p_id, p_action: 'attach',      p_payload: {project_id}}
                                  {p_id, p_action: 'merge',       p_payload: {into_candidate_id}}
                                  {p_id, p_action: 'reject',      p_payload: {note}}
                                  {p_id, p_action: 'ignore',      p_payload: {}}
                                  {p_id, p_action: 'reopen',      p_payload: {}}
archive_admin_list_projects       {p_q: text|null, p_visibility: text|null, p_limit: 50 (10 in pickers), p_offset: int}
archive_admin_upsert_project      {p_project: {id, <changed fields>, credits?}}  or, new: {p_project: {<non-empty fields>, credits?}}
archive_admin_set_visibility      {p_project_id, p_visibility: 'published'|'hidden'|'draft', p_note: text|null}
archive_admin_merge_projects      {p_keep, p_drop}
archive_admin_add_source          {p_project_id, p_source: {url, source_kind, title?, publisher?, language?, published_at?, license?}, p_supports: text[]}
archive_admin_remove_source       {p_project_id, p_source_id}                         -- contract change 1
archive_admin_set_media           {p_project_id, p_media: {id?, url, page_url, commons_file, license, license_url, author, attribution, rights_status, is_primary}}
archive_admin_remove_media        {p_media_id}
archive_admin_list_updates        {p_status: 'open'|'applied'|'dismissed'|null, p_limit: 100}
archive_admin_resolve_update      {p_id, p_action: 'apply'|'dismiss'}
archive_admin_list_runs           {p_limit: 10|50, p_rule_id: uuid|null}
archive_admin_list_errors         {p_limit: 50}
archive_admin_list_rules          {}
archive_admin_upsert_rule         {p_rule: {id, enabled}}                                                     (toggle)
                                  {p_rule: {id, enabled, cadence_hours, query, url, terms_url, notes}}         (edit)
                                  {p_rule: {kind, name, language, region_hint, enabled, cadence_hours, query, url, terms_url, notes}}  (new)
archive_admin_list_keywords       {}
archive_admin_upsert_keyword      {p_kw: {id?, term, language, polarity, weight: 0..100, enabled}}
archive_admin_delete_keyword      {p_term, p_language}                                -- contract change 2
archive_admin_set_settings        {p_settings: {auto_list_structured, auto_ignore_below, review_threshold}}
archive_search                    {p_q: text|null, p_filters: {}, p_sort: 'relevance'|'updated', p_limit: 50, p_offset: 0}
archive_research_add_assessment   {p_project_id, p_attribute, p_value: json, p_confidence: 'low'|'medium'|'high', p_method, p_note: text|null}

v0.10 tools (unchanged):
admin_candidate_stats             {}
admin_list_candidates             {p_city_code, p_status, p_min_score, p_search, p_limit: 200, p_offset: 0}
admin_update_candidate            {p_candidate_id, p_action: 'ready'|'reviewed'|'hide'|'reject', p_reason: text|null}
admin_promote_candidate           {p_candidate_id, p_place_code}
admin_list_ingestion_jobs         {p_limit: 20}
POST /rest/v1/archive_articles    {title, author, summary, body, source_url, status, published_at}

Edge Functions (Authorization: Bearer <user access token>, apikey: <publishable key>):
archive-collect                   {rule_ids: [uuid]}  or  {max_rules: 1..6}
admin-discovery-command           {city_code, candidate_limit_per_city}
```

### What the console reads back

- `archive_admin_dashboard()`:
  - Keys: `queue` (`{<candidate status>: n}`), `runs_24h` and `runs_7d` (a number, or `{total?, <run status>: n}`),
    `errors`, `open_updates`, `broken_links` (numbers), `sources_by_status` (`{<link_state>: n}`),
    `projects_by_visibility`, `projects_by_review`, and `settings`
    (`{auto_list_structured, auto_ignore_below, review_threshold}`).
  - A number or an object is accepted for each count; `queue_counts` and `errors_24h` are read as aliases.
- `archive_admin_list_candidates` rows:
  - The candidate columns (`id, status, label, score, confidence, reasons, classifier_version, detected_*, latitude,
    longitude, language, first_seen_at, last_seen_at, seen_count, reviewed_at, review_note`).
  - `hits: [{provider, url, canonical_url, title, excerpt, publisher, published_at}]`.
  - `suggested_matches: [{id, name_ko?, name_en?, name_original?, city?, country_iso2?, similarity 0..1, reason?}]`.
  - Optionally `hit_count`.
- `archive_admin_list_projects` rows: every project column including `field_status`, plus:
  - `credits: [{role, name, name_en, wikidata_qid, source_id?}]`;
  - `sources: [{id, url, title, publisher, source_kind, language, published_at, reliability, link_state, license,
    supports}]`;
  - `media: [{id, url, page_url, commons_file, license, license_url, author, attribution, rights_status, is_primary,
    link_state}]` (all media, not only cleared).
- `archive_admin_list_updates` rows: `{id, project_id, project_name, kind, status, detail, created_at, resolved_at}`.
  The `detail` shapes understood are `{sources:[{url,title,publisher}]}`, `{changes:[{field,old,new}]}`,
  `{field, old, new}` and `{url, http_status, ...}`. Any other keys are listed.
- `archive_admin_list_runs` and `archive_admin_list_errors` rows as the tables in §4. An optional `rule_name` is used
  if present; otherwise names come from `archive_admin_list_rules`.
- `archive-collect` responses: top-level scalars are shown, plus a `runs` (or `results`) array of
  `{rule_id, status, fetched, kept, new_candidates, matched_projects, duplicates, ignored, errors, error?}`. The
  whole response can be expanded.
- PostgREST errors are explained in plain Korean:
  - `42501`, or HTTP 401/403: no permission.
  - `PGRST202`: the function is missing, so the migration hasn't been applied.
  - Network failures.
  - `note_required`.
  - Anything else is shown with its message.

## 편집자 검수 기준

### 무엇을 아카이브에 넣나요

넣어요:
- 건물 외피나 구조물에 오래 설치된 미디어파사드. LED 메시, 미디어 글라스, 외장재 뒤 LED, 픽셀 조명, 상설 프로젝션처럼
  건축과 함께 설계됐거나 건축의 일부로 읽히는 것.
- 장소와 주최가 확인되는 정기 프로젝션 매핑·빛 축제 프로그램(유형: 프로젝션 매핑, 축제·전시 프로그램).
- 공공 공간의 미디어 아트, 인터랙티브 설치, 미디어 건축.
- 예술·공공 콘텐츠가 뚜렷한 도시 대형 스크린(유형: 도시 대형 스크린). 광고도 함께 나오면 콘텐츠 유형에 '광고'를 더해요.

반려하거나 무시해요:
- 광고 전광판 임대·매매·분양, 광고 대행 견적. 건축 맥락 없이 광고만 하는 사이니지예요(분류 '광고 전광판').
- LED 제품·업체 홍보와 납품 실적 보도자료(분류 '제품·업체 홍보'). 기사에 프로젝트 이름과 위치가 분명하면, 그
  프로젝트를 다른 출처로 확인한 뒤 이 기사는 출처로만 붙여요.
- 매장 안 디스플레이, 무대 LED, 한 번뿐인 행사 조명, 지어지지 않은 계획안·공모안. 계획안은 준공을 확인할 때까지
  메모를 남기고 무시해 두세요.

이미 있는 프로젝트의 기사라면 새로 승인하지 말고 '기존 프로젝트에 연결'을, 같은 이야기를 다룬 후보끼리는
'다른 후보와 병합'을 쓰세요.

### 출처를 얼마나 믿을까요

- 믿을 만한 순서: 공식(설계사무소·운영기관·지자체), 공공기관, 학술 > 전문 매체 > 뉴스 > 블로그·검색 결과.
- 공식 출처 하나, 또는 서로 다른 매체 두 곳이 같은 사실을 쓰면 그 값은 확인된 것으로 봐요. 같은 보도자료를 옮긴
  기사 여러 개는 출처 하나로 셉니다.
- 블로그나 검색 결과에만 있는 값은 적지 말고 미확인으로 두세요.
- 분류 점수와 신뢰도는 참고값이에요. 분류 근거와 기사를 직접 읽고 판단하세요. GDELT의 국가는 매체의 국가이지
  프로젝트 위치가 아니에요.

### 값을 적는 법

- 출처에서 확인한 값만 적고, 모르면 비워 두세요(미확인). 짐작해서 채우지 않아요.
- 설치 연도, 준공 연도, 운영 시작 연도를 구분해요.
- 정확한 위치를 모르면 좌표를 비우거나 도시 좌표를 넣고 '위치 정확도'를 그에 맞게 고르세요.
- 원어 이름과 원어 언어를 먼저 적고, 한국어·영어 이름은 공식 표기가 있을 때 적어요.
- 값을 적은 출처는 '출처 추가'에서 '뒷받침하는 항목'으로 연결해 두세요.

### 이미지 라이선스

- 다른 사람의 이미지는 저장하지 않아요. 미디어로 등록하는 것은 Wikimedia Commons의 자유 라이선스(CC0, CC BY,
  CC BY-SA, 퍼블릭 도메인) 파일뿐이고, 저작자·라이선스·원본 페이지를 함께 적어요.
- NC·ND 라이선스, "All rights reserved", 언론사·설계사무소 사진은 출처 링크로만 남겨요. 미디어로 이미 들어왔다면
  '사용 불가'로 두세요.
- 건물 사진을 쓸 권리와 화면 속 작품의 저작권은 따로예요. 작품 화면을 크게 담은 사진, 파노라마의 자유가 없거나
  좁은 나라의 작품 사진은 사용 가능으로 두지 마세요.
- 대표 이미지는 사용 가능(cleared)으로 확인한 이미지만 될 수 있어요. 콘솔이 다른 경우는 막아요.

### 언제 공개하나요

- 이름, 국가와 도시, 프로젝트 유형을 확인했고, 믿을 만한 출처가 하나 이상 붙어 있을 때 공개해요. 믿을 만한 출처는
  공식·공공·학술·전문 매체, 또는 서로 다른 매체 두 곳이에요. 출처가 없으면 콘솔이 공개를 막아요.
- 실제로 있는지, 지금 운영하는지 확실하지 않으면 초안으로 두고 메모를 남겨요.
- 철거되거나 끝난 프로젝트도 기록으로 공개해요. 운영 상태를 '종료'나 '철거'로 바꾸세요.
- 비공개로 돌릴 때는 사유를 꼭 적어요. 사실 오류, 권리 문제, 중복 같은 사유예요. 합치기로 사라지는 쪽은 자동으로
  비공개가 돼요.

## Contract changes

Recorded for the integration step; the rest of ARCHIVE_SPEC §4 is used as written.

1. **New RPC `archive_admin_remove_source(p_project_id uuid, p_source_id uuid)`**, editor+. The spec has
   `archive_admin_add_source` but no way to remove a source, which the brief asks for. It deletes the
   `archive_project_sources` row; the `archive_sources` row may stay for other projects.
2. **New RPC `archive_admin_delete_keyword(p_term text, p_language text)`**, admin. The spec has only
   `archive_admin_upsert_keyword`, and the brief asks for deleting keywords. Keywords are keyed by
   `(term, language)`, as in the seed upserts. `archive_keywords.language` is NOT NULL, so both arguments are
   required and the keyword form always sends a language (an English term applies to items in every language).
3. **`archive_admin_upsert_project(p_project)` is a partial update.**
   - With `id`: only the keys present are written, and absent keys stay unchanged.
   - Each written field gets `field_status[field] = {state:'editor_verified', at}`. A key set to `null` clears the
     value and removes its `field_status` entry (shown as 미확인).
   - `p_project.credits` (`[{role, name, name_en, wikidata_qid, source_id?}]`), when present, replaces the project's
     credits; the spec has no credits RPC.
   - Without `id` it inserts a project (`record_origin = editor_created`) from the non-empty fields.
4. **`archive_admin_list_projects` rows carry `credits`, `sources` (with `id`, `source_kind`, `supports`) and `media`
   (with `id`, all rights fields, every rights status).** The editor needs them and there is no get-project RPC.
5. **`archive_admin_dashboard()` includes `settings`**
   (`{auto_list_structured, auto_ignore_below, review_threshold}`). There is no settings getter, and the 설정 screen
   reads its current values from here.
6. **`archive_admin_list_candidates` with `p_status = null` returns the review queue (needs_review and uncertain).**
   Each row carries `hits` and `suggested_matches` in the shapes above.
7. **`archive_admin_resolve_update` actions are `apply` and `dismiss`**, giving status applied or dismissed.
8. **지금 수집 실행 and 다시 시도 are shown to admins only**, as the admin brief asks. Spec §5 lets editors call
   `archive-collect` with a JWT; the function may keep allowing that.
9. **Researchers read projects through `archive_search`**, which returns published projects only, because the
   `archive_admin_*` list RPCs are editor+. Researchers therefore assess published projects only.

## Tests

`qa/admin.spec.mjs` (29 tests, about 1.5 min with `--workers=2`):
- Sign-in: success, wrong password, no role, and a missing `archive_role`; each role sees exactly its tabs.
- Every tab renders for every role.
- Queue: the list, the detail, keyboard navigation, and the exact `approve_new`, `attach`, `merge`, `reject` (note
  required), `ignore` and `reopen` payloads.
- Project editor:
  - only changed fields are sent, and field states change before and after saving;
  - credits and validation;
  - sources: add and remove;
  - media: the primary-image rule;
  - visibility: hiding needs a note;
  - merge;
  - a new project.
- Rules and keywords: read-only for editors, edits by admins; settings.
- Run now and retry: the JWT, the apikey and the rule id, and no token in console output.
- Error states.
- XSS fixtures on every screen (no dialog, no injected element, no `javascript:` link).
- Researcher assessments, change detection, and the v0.10 tools.
- No horizontal scroll at 390 px on any tab or open detail.
- axe (WCAG 2.1 A/AA) on the login screen and every tab, at 390 and 1440 px, in light and dark.

`qa/admin-shots.spec.mjs` saves every tab at 1440×900 and 390×844 in light and dark when `AOL_ADMIN_SHOTS` names a
folder. Otherwise it is skipped.

```sh
AOL_TEST_PORT=4313 npx playwright test qa/admin.spec.mjs --workers=2
AOL_ADMIN_SHOTS=/tmp/admin-shots AOL_TEST_PORT=4313 npx playwright test qa/admin-shots.spec.mjs
```

Needs a live Supabase to verify:
- the real `archive_*` functions and their role checks;
- the response shapes listed above;
- supabase-js session refresh over long sessions;
- `archive-collect` with a user JWT;
- the v0.10 RPCs against today's schema.
