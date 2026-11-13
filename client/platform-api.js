// v2.0 member platform API (docs/PLATFORM.md): window.AOLPlatformAPI for site-public-cleared/platform.js. Loaded by
// cloud-boot.js after cloud.js, only when config.js names a Supabase project, and uses cloud.js's client (the member's
// own session, the publishable key: no secret in the browser). Every read and write goes through the database's
// row-level security, views and RPCs (supabase/migrations/20261112000000_v2_platform.sql); this module adds no access
// rule of its own. Public photos come from the public bucket community-photos.
const cloud = window.AOLCloud
const client = () => cloud?.client?.()
const cfg = window.AOL_CONFIG || {}
const must = (r) => { if (r.error) throw r.error; return r.data }
const uid = () => cloud?.state?.user?.id || null
const publicUrl = (path) => `${String(cfg.SUPABASE_URL).replace(/\/+$/, '')}/storage/v1/object/public/community-photos/${path.split('/').map(encodeURIComponent).join('/')}`
const SUB_FIELDS = ['kind', 'project_id', 'name', 'name_en', 'country_iso2', 'city', 'venue', 'project_type', 'creators', 'year_start', 'description', 'official_url', 'source_urls', 'field_name', 'proposed_value', 'event_starts_on', 'event_ends_on', 'image_note', 'relation', 'status']

window.AOLPlatformAPI = {
  configured: !!client(),
  user: () => (uid() ? { id: uid() } : null),
  account: async () => must(await client().rpc('my_account')),
  profile: async () => must(await client().from('member_profiles').select('display_name,bio,show_profile,public_id').eq('user_id', uid()).maybeSingle()),
  saveProfile: async (p) => must(await client().from('member_profiles').upsert({ user_id: uid(), display_name: p.display_name, bio: p.bio, show_profile: p.show_profile !== false })),
  posts: async ({ project = null, kind = null, limit = 30 } = {}) => {
    let q = client().from('community_public_posts').select('*').order('published_at', { ascending: false }).limit(limit)
    if (project) q = q.eq('project_id', project)
    if (kind) q = q.eq('kind', kind)
    return must(await q)
  },
  post: async (id) => {
    const post = must(await client().from('community_public_posts').select('*').eq('id', id).maybeSingle())
    const comments = post ? must(await client().from('community_public_comments').select('*').eq('post_id', id).order('published_at')) : []
    return { post, comments }
  },
  createPost: async (p) => must(await client().from('community_posts').insert({ kind: p.kind, project_id: p.project_id, title: p.title, body: p.body, visited_on: p.visited_on, status: p.status }).select('id,status').single()),
  comment: async (postId, body) => must(await client().from('community_comments').insert({ post_id: postId, body }).select('id,status').single()),
  like: async (postId) => must(await client().from('community_likes').insert({ post_id: postId, user_id: uid() })),
  photos: async (project) => (must(await client().from('community_public_photos').select('*').eq('project_id', project).order('published_at', { ascending: false }).limit(12))).map((f) => ({ ...f, url: publicUrl(f.public_path) })),
  uploadPhoto: async (f) => {
    const name = `${uid()}/${f.project_id}-${Date.now().toString(36)}.jpg`
    must(await client().storage.from('community-uploads').upload(name, f.blob, { contentType: 'image/jpeg', upsert: false }))
    const row = { project_id: f.project_id, upload_path: name, mime: 'image/jpeg', bytes: f.blob.size, width: f.width, height: f.height, caption: f.caption, credit_name: f.credit_name || null, taken_on: f.taken_on, licence: f.licence, offer_official: f.offer_official, own_photo: f.own_photo, can_license: f.can_license, people_ok: f.people_ok, artwork_rights_notice: f.artwork_rights_notice }
    const r = await client().from('community_photos').insert(row).select('id,status').single()
    if (r.error) { await client().storage.from('community-uploads').remove([name]); throw r.error }
    return r.data
  },
  saveSubmission: async (s) => {
    const row = Object.fromEntries(SUB_FIELDS.map((k) => [k, s[k] ?? null]))
    row.source_urls = s.source_urls || []
    if (s.id) return must(await client().from('community_submissions').update(row).eq('id', s.id).select('id,status').single())
    return must(await client().from('community_submissions').insert(row).select('id,status').single())
  },
  updatePost: async (id, p) => must(await client().from('community_posts').update({ title: p.title, body: p.body }).eq('id', id).eq('user_id', uid()).select('id,status').single()),
  deletePost: async (id) => must(await client().from('community_posts').delete().eq('id', id).eq('user_id', uid())),
  deleteComment: async (id) => must(await client().from('community_comments').delete().eq('id', id).eq('user_id', uid())),
  // A photo goes through the server function so its public file is deleted with the record.
  withdrawPhoto: async (id) => { const { data, error } = await client().functions.invoke('publish-photo', { body: { photo_id: id, action: 'withdraw' } }); if (error) throw error; return data },
  member: async (publicId) => {
    const profile = must(await client().from('community_public_members').select('*').eq('public_id', publicId).maybeSingle())
    const posts = profile ? must(await client().from('community_public_posts').select('*').eq('author_public_id', publicId).order('published_at', { ascending: false }).limit(30)) : []
    return { profile, posts }
  },
  mine: async () => {
    const sel = (t, cols) => client().from(t).select(cols).eq('user_id', uid()).order('created_at', { ascending: false }).limit(100)
    const [posts, photos, submissions, appeals, comments] = await Promise.all([
      sel('community_posts', 'id,kind,title,body,status,decision_reason,created_at'), sel('community_photos', 'id,project_id,caption,status,decision_reason,created_at'),
      sel('community_submissions', 'id,kind,name,project_id,status,decision_reason,approved_project_id,created_at'), sel('moderation_appeals', 'id,target_type,target_id,status,note,created_at'), sel('community_comments', 'id,post_id,body,status,decision_reason,created_at')])
    return { posts: must(posts), photos: must(photos), submissions: must(submissions), appeals: must(appeals), comments: must(comments) }
  },
  flag: async (f) => must(await client().from('content_flags').insert({ target_type: f.target_type, target_id: f.target_id, reason: f.reason, message: f.message, contact_email: f.contact_email, reporter: uid() })),
  appeal: async (a) => must(await client().from('moderation_appeals').insert({ target_type: a.target_type, target_id: a.target_id, message: a.message })),
  applyResearcher: async (a) => {
    const row = { affiliation: a.affiliation, research_field: a.research_field, purpose: a.purpose, requested_datasets: a.requested_datasets, verification_url: a.verification_url, verification_note: a.verification_note, terms_version: a.terms_version }
    if (a.update) return must(await client().from('researcher_applications').update(row).eq('id', a.update).select('id,status').single())
    return must(await client().from('researcher_applications').insert({ ...row, full_name: a.full_name, applicant_type: a.applicant_type, privacy_version: a.terms_version }).select('id,status').single())
  },
  acceptTerms: async (version) => must(await client().from('researcher_applications').update({ terms_version: version }).eq('user_id', uid()).eq('status', 'approved')),
}
window.dispatchEvent(new Event('aol:platform-ready'))
