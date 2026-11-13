-- v2.0 P1 (docs/PLATFORM.md "Image permission requests"): the request ledger keeps every step of a request, and the
-- database refuses the steps that would rest on a guess.
--  - where the contact was found (contact_source) and why that party holds the rights (holder_basis) are recorded; a
--    request is marked sent only with both, a contact and a saved draft. The console never sends mail: the operator
--    reads and edits the draft, sends it from their own account, then marks it sent.
--  - no_contact: no contact or no identifiable rights holder was found; the note says what was searched, and nothing
--    is guessed. It can return to draft when a contact turns up.
--  - the reply (reply_note), the granted scope and the evidence are required for an approval; applying an approval to
--    the site (applied_at, applied_ref: the editorial decision) needs an approved request.
--  - a request moves only along the ledger's steps; a closed one (denied, withdrawn, revoked, expired) stays closed
--    and a new request is made instead. Every status change is in the audit log (as before).
-- Re-runnable after 20261112000000_v2_platform.sql.

alter table public.image_permission_requests add column if not exists contact_source text check(contact_source is null or char_length(contact_source) between 3 and 1000);
alter table public.image_permission_requests add column if not exists holder_basis text check(holder_basis is null or char_length(holder_basis) between 3 and 1000);
alter table public.image_permission_requests add column if not exists draft_subject text check(draft_subject is null or char_length(draft_subject)<=300);
alter table public.image_permission_requests add column if not exists draft_text text check(draft_text is null or char_length(draft_text)<=12000);
alter table public.image_permission_requests add column if not exists reply_note text check(reply_note is null or char_length(reply_note)<=4000);
alter table public.image_permission_requests add column if not exists applied_at timestamptz;
alter table public.image_permission_requests add column if not exists applied_ref text check(applied_ref is null or char_length(applied_ref) between 3 and 300);
alter table public.image_permission_requests add column if not exists sent_by uuid references auth.users(id) on delete set null;
alter table public.image_permission_requests drop constraint if exists image_permission_requests_status_check;
alter table public.image_permission_requests add constraint image_permission_requests_status_check
 check(status in ('draft','no_contact','sent','replied','approved','denied','withdrawn','expired','revoked'));

create or replace function public.image_permission_touch() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare prev text:=case when tg_op='UPDATE' then old.status else null end;
begin
 new.updated_at:=now();
 if tg_op='INSERT' then new.created_by:=coalesce((select auth.uid()),new.created_by); new.applied_at:=null; new.applied_ref:=null;
  if new.status not in ('draft','no_contact') then raise exception 'permission_new_must_be_draft' using errcode='check_violation'; end if;
 end if;
 if new.status is distinct from prev then
  -- The ledger's steps; a closed request is not reopened.
  if prev is not null and not (
     (prev='draft' and new.status in ('no_contact','sent','withdrawn')) or
     (prev='no_contact' and new.status in ('draft','withdrawn')) or
     (prev='sent' and new.status in ('replied','approved','denied','withdrawn','expired')) or
     (prev='replied' and new.status in ('approved','denied','withdrawn')) or
     (prev='approved' and new.status in ('revoked','expired','withdrawn'))) then
   raise exception 'permission_step_not_allowed' using errcode='check_violation', detail=prev||' -> '||new.status;
  end if;
  if new.status='sent' and (nullif(btrim(coalesce(new.contact_value,'')),'') is null or new.contact_source is null or new.holder_basis is null or nullif(btrim(coalesce(new.draft_text,'')),'') is null) then
   raise exception 'permission_send_incomplete' using errcode='check_violation', hint='contact, where it was found, why this party holds the rights, and the saved draft';
  end if;
  if new.status='no_contact' and nullif(btrim(coalesce(new.evidence_note,'')),'') is null then
   raise exception 'permission_no_contact_note' using errcode='check_violation', hint='what was searched';
  end if;
  if new.status in ('replied','approved','denied') and nullif(btrim(coalesce(new.reply_note,'')),'') is null then
   raise exception 'permission_reply_note' using errcode='check_violation';
  end if;
  if new.status='approved' and (nullif(btrim(coalesce(new.granted_scope,'')),'') is null or nullif(btrim(coalesce(new.evidence_note,'')),'') is null) then
   raise exception 'permission_approval_incomplete' using errcode='check_violation', hint='granted scope and evidence';
  end if;
  if new.status='sent' then new.requested_at:=coalesce(new.requested_at,now()); new.sent_by:=coalesce((select auth.uid()),new.sent_by); end if;
  if new.status in ('replied','approved','denied') then new.response_at:=coalesce(new.response_at,now()); end if;
  if new.status in ('revoked','withdrawn','expired') and prev in ('approved','sent','replied') then new.revoked_at:=coalesce(new.revoked_at,now()); end if;
 end if;
 if tg_op='UPDATE' then
  -- Applied once, to an approved request, with the decision it went into.
  if new.applied_at is not null and old.applied_at is null and (new.status<>'approved' or new.applied_ref is null) then
   raise exception 'permission_apply_needs_approval' using errcode='check_violation';
  end if;
  if old.applied_at is not null then new.applied_at:=old.applied_at; new.applied_ref:=coalesce(old.applied_ref,new.applied_ref); end if;
  -- The send record is the server's.
  if old.status<>'draft' then new.sent_by:=old.sent_by; new.requested_at:=coalesce(old.requested_at,new.requested_at); end if;
  if old.status is distinct from new.status then
   insert into public.platform_audit_log(actor,action,target_type,target_id,detail) values((select auth.uid()),'permission_'||new.status,'image_permission_request',new.id::text,jsonb_build_object('from',old.status));
  elsif old.applied_at is null and new.applied_at is not null then
   insert into public.platform_audit_log(actor,action,target_type,target_id,detail) values((select auth.uid()),'permission_applied','image_permission_request',new.id::text,jsonb_build_object('ref',new.applied_ref));
  end if;
 end if;
 return new;
end $$;
drop trigger if exists image_permission_touch on public.image_permission_requests;
create trigger image_permission_touch before insert or update on public.image_permission_requests for each row execute function public.image_permission_touch();
