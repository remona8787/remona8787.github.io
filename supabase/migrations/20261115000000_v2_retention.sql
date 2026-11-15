-- v2.0 retention (docs/policies/v2-final.md, privacy policy section 2): the periods the privacy policy states are kept by
-- the daily platform_expire run (schedule aol-platform-expire, 18:37 UTC = 03:37 KST), not by hand:
--  - researcher applications that ended (rejected, revoked, expired, withdrawn): removed 1 year after they ended
--    (platform_settings.retention_application_days, default 365)
--  - handled reports (content_flags, content_reports), decided appeals, staff and automatic decisions
--    (moderation_events) and the audit log (platform_audit_log): removed 3 years after they were handled or written
--    (platform_settings.retention_record_days, default 1095)
-- Open reports and open appeals are never removed by age. A changed period must be changed in the policy too; neither
-- setting goes below 30 days. Re-runnable after 20261114000000_v2_submission_followup.sql.

insert into public.platform_settings(key,value) values
 ('retention_application_days','365'::jsonb),
 ('retention_record_days','1095'::jsonb)
on conflict(key) do nothing;

create or replace function public.platform_expire() returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 n integer; apps integer; flags integer; reports integer; appeals integer; events integer; audit integer;
 app_cut timestamptz:=now()-make_interval(days=>greatest(public.platform_setting_int('retention_application_days',365),30));
 rec_cut timestamptz:=now()-make_interval(days=>greatest(public.platform_setting_int('retention_record_days',1095),30));
begin
 update public.researcher_applications set status='expired',updated_at=now() where status='approved' and expires_at is not null and expires_at<=now();
 get diagnostics n=row_count;
 -- An ended application counts from its last change (the decision, revocation, expiry or withdrawal).
 delete from public.researcher_applications where status in ('rejected','revoked','expired','withdrawn') and greatest(coalesce(decided_at,'-infinity'),updated_at)<app_cut;
 get diagnostics apps=row_count;
 delete from public.content_flags where status<>'open' and coalesce(handled_at,created_at)<rec_cut;
 get diagnostics flags=row_count;
 delete from public.content_reports where status<>'open' and coalesce(handled_at,created_at)<rec_cut;
 get diagnostics reports=row_count;
 delete from public.moderation_appeals where status<>'open' and coalesce(decided_at,created_at)<rec_cut;
 get diagnostics appeals=row_count;
 delete from public.moderation_events where at<rec_cut;
 get diagnostics events=row_count;
 delete from public.platform_audit_log where at<rec_cut;
 get diagnostics audit=row_count;
 return jsonb_build_object('expired_applications',n,'removed',jsonb_build_object('applications',apps,'flags',flags,'reports',reports,'appeals',appeals,'moderation_events',events,'audit_log',audit));
end $$;
revoke all on function public.platform_expire() from public,anon,authenticated;
grant execute on function public.platform_expire() to service_role;
