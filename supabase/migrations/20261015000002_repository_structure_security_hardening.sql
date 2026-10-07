-- Phase 2H security hardening: generated structure can only be written by the server-side analyzer.
--
-- PROBLEM (found in review): 20261015000001 let any OWNER/ADMIN write symbols/relationships and the analysis
-- lifecycle/metrics straight through PostgREST (and call persist_structure_analysis with an arbitrary payload).
-- The browser and the Next.js server share the same `authenticated` principal, so GRANTs and RLS alone cannot tell
-- the analyzer from a hand-crafted request. The boundary therefore needs a server-only secret.
--
-- TRUST BOUNDARY (after this migration)
--   * Clients (authenticated) can READ structure (existing visibility rules), CREATE a PENDING analysis row and
--     DELETE an analysis (cascades). They can NOT insert/delete symbols or relationships and can NOT UPDATE the
--     analysis row in any column.
--   * The lifecycle moves only through SECURITY DEFINER functions that re-check OWNER/ADMIN of the derived
--     organization themselves (definer functions bypass RLS):
--         begin_structure_analysis(id)         PENDING    -> PROCESSING  (issues a random run token)
--         fail_structure_analysis(id, message) PENDING|PROCESSING -> FAILED
--         reset_structure_analysis(id)         FAILED     -> PENDING     (retry; drops the old run token)
--   * Structure is written only by persist_structure_analysis(), which additionally requires the run token AND a
--     valid HMAC-SHA256 signature computed by the server with STRUCTURE_PERSIST_KEY. The database verifies it with
--     the same key stored in Supabase Vault. An OWNER/ADMIN can call the function but cannot produce a signature
--     the database accepts, so cannot forge, alter, replay or re-target a payload.
--
-- KEY PROVISIONING (never in git, never in a migration, never in .env.example)
--   The key is a random secret of at least 32 characters. The SAME value must be set in two private places:
--     1. the application's server-only environment as STRUCTURE_PERSIST_KEY (never NEXT_PUBLIC_*), and
--     2. Supabase Vault under the name 'structure_persist_key', by an operator:
--          select vault.create_secret('<the same value>', 'structure_persist_key', 'Phase 2H structure persistence HMAC key');
--        (rotate with vault.update_secret). Only SECURITY DEFINER functions owned by postgres can read it:
--        authenticated/anon have no privilege on the vault schema.
--   Without the Vault secret persist_structure_analysis() refuses every call.
--
-- CANONICAL SIGNED MESSAGE (version 1, UTF-8; every line ends with LF; documented once, implemented twice:
--   private.structure_canonical() here and src/server/repository-structure/signing.ts, kept in agreement by a
--   fixed test vector):
--     OFA-STRUCTURE-V1
--     <analysis_id, lowercase uuid>
--     <run_token, 64 lowercase hex>
--     <files_total>|<files_analyzed>|<files_unsupported>|<files_failed>
--     <number of symbols>
--     <number of relationships>
--     one line per symbol, in array order:
--       S|<file_id>|<kind>|<start_line>|<start_column>|<end_line>|<end_column>|<visibility or ->|<S name>|<S qualified_name>|<S signature>
--     one line per relationship, in array order:
--       R|<source_index>|<target_index>|<relationship_type>
--   where <S x> is "-" when x is NULL, otherwise "<UTF-8 byte length>:<x>" (length-prefixed, so a name containing
--   '|' or a newline can never shift a field). Integers are plain decimal. signature = lowercase hex of
--   HMAC-SHA256(key, message).
--
-- COMPLETED IMMUTABILITY at the database level: a BEFORE UPDATE trigger rejects every UPDATE of a COMPLETED
-- analysis (definer functions bypass RLS, so RLS can no longer be the only seal). Symbols/relationships can only
-- be INSERTed while their analysis is PROCESSING and are never UPDATEd. Deleting still works (cascades).

-- 1. Private schema (not exposed by PostgREST; no privilege for any client role) ------------------

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- One row per analysis that is currently PROCESSING: the random token binding a signed persistence to that run.
create table private.structure_analysis_runs (
  analysis_id uuid primary key references public.repository_structure_analyses (id) on delete cascade,
  run_token   text not null check (run_token ~ '^[0-9a-f]{64}$'),
  created_at  timestamptz not null default now()
);
revoke all on private.structure_analysis_runs from public, anon, authenticated;
alter table private.structure_analysis_runs enable row level security; -- no policies: nothing but the owner can touch it

-- A token row can only exist for a PROCESSING analysis (so a COMPLETED/FAILED/PENDING analysis never has run state).
create or replace function private.enforce_run_row_window()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.repository_structure_analyses a where a.id = new.analysis_id and a.status = 'PROCESSING'
  ) then
    raise exception 'A run token can only exist for a PROCESSING analysis' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger structure_analysis_runs_enforce_window
  before insert or update on private.structure_analysis_runs
  for each row execute function private.enforce_run_row_window();

-- 2. Helpers (private; executed only inside the definer functions below) -------------------------

create or replace function private.structure_analysis_org(p_analysis_id uuid)
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select d.organization_id
  from public.repository_structure_analyses a
  join public.repository_snapshots s on s.id = a.snapshot_id
  join public.repositories r on r.id = s.repository_id
  join public.projects p on p.id = r.project_id
  join public.teams t on t.id = p.team_id
  join public.departments d on d.id = t.department_id
  where a.id = p_analysis_id;
$$;

create or replace function private.structure_persist_key()
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_key text;
begin
  select s.decrypted_secret into v_key from vault.decrypted_secrets s where s.name = 'structure_persist_key';
  if v_key is null or char_length(v_key) < 32 then
    raise exception 'Structure persistence is not configured' using errcode = '55000';
  end if;
  return v_key;
end;
$$;

create or replace function private.structure_hmac(p_message text, p_key text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select encode(extensions.hmac(convert_to(p_message, 'UTF8'), convert_to(p_key, 'UTF8'), 'sha256'), 'hex');
$$;

create or replace function private.structure_canonical(
  p_analysis_id       uuid,
  p_run_token         text,
  p_symbols           jsonb,
  p_relationships     jsonb,
  p_files_total       integer,
  p_files_analyzed    integer,
  p_files_unsupported integer,
  p_files_failed      integer
)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select 'OFA-STRUCTURE-V1' || E'\n'
    || p_analysis_id::text || E'\n'
    || p_run_token || E'\n'
    || p_files_total::text || '|' || p_files_analyzed::text || '|' || p_files_unsupported::text || '|' || p_files_failed::text || E'\n'
    || jsonb_array_length(p_symbols)::text || E'\n'
    || jsonb_array_length(p_relationships)::text || E'\n'
    || coalesce((
         select string_agg(
           'S|' || coalesce(e.obj ->> 'file_id', '-')
             || '|' || coalesce(e.obj ->> 'kind', '-')
             || '|' || coalesce(((e.obj ->> 'start_line')::int)::text, '-')
             || '|' || coalesce(((e.obj ->> 'start_column')::int)::text, '-')
             || '|' || coalesce(((e.obj ->> 'end_line')::int)::text, '-')
             || '|' || coalesce(((e.obj ->> 'end_column')::int)::text, '-')
             || '|' || coalesce(e.obj ->> 'visibility', '-')
             || '|' || case when e.obj ->> 'name' is null then '-' else octet_length(e.obj ->> 'name')::text || ':' || (e.obj ->> 'name') end
             || '|' || case when e.obj ->> 'qualified_name' is null then '-' else octet_length(e.obj ->> 'qualified_name')::text || ':' || (e.obj ->> 'qualified_name') end
             || '|' || case when e.obj ->> 'signature' is null then '-' else octet_length(e.obj ->> 'signature')::text || ':' || (e.obj ->> 'signature') end
             || E'\n',
           '' order by e.ord)
         from jsonb_array_elements(p_symbols) with ordinality as e(obj, ord)
       ), '')
    || coalesce((
         select string_agg(
           'R|' || coalesce(((e.obj ->> 'source_index')::int)::text, '-')
             || '|' || coalesce(((e.obj ->> 'target_index')::int)::text, '-')
             || '|' || coalesce(e.obj ->> 'relationship_type', '-')
             || E'\n',
           '' order by e.ord)
         from jsonb_array_elements(p_relationships) with ordinality as e(obj, ord)
       ), '');
$$;

revoke all on function private.structure_analysis_org(uuid) from public, anon, authenticated;
revoke all on function private.structure_persist_key() from public, anon, authenticated;
revoke all on function private.structure_hmac(text, text) from public, anon, authenticated;
revoke all on function private.structure_canonical(uuid, text, jsonb, jsonb, integer, integer, integer, integer) from public, anon, authenticated;

-- 3. Remove every client write path to generated structure and to the analysis lifecycle ---------

drop policy repository_symbols_insert_admin on public.repository_symbols;
drop policy repository_symbols_delete_admin on public.repository_symbols;
drop policy repository_symbol_relationships_insert_admin on public.repository_symbol_relationships;
drop policy repository_symbol_relationships_delete_admin on public.repository_symbol_relationships;
drop policy repository_structure_analyses_update_admin on public.repository_structure_analyses;

revoke all on public.repository_symbols from anon, authenticated;
grant select on public.repository_symbols to authenticated;
revoke all on public.repository_symbol_relationships from anon, authenticated;
grant select on public.repository_symbol_relationships to authenticated;

-- Analyses: clients keep SELECT, INSERT of a PENDING row (snapshot_id, status) and DELETE. No UPDATE of any column.
revoke all on public.repository_structure_analyses from anon, authenticated;
grant select on public.repository_structure_analyses to authenticated;
grant insert (snapshot_id, status) on public.repository_structure_analyses to authenticated;
grant delete on public.repository_structure_analyses to authenticated;

-- COMPLETED is sealed by the database itself: no UPDATE of any column of a COMPLETED analysis, by anyone
-- (definer functions bypass RLS, so this trigger is the seal that no policy can give them).
create or replace function public.enforce_structure_analysis_sealed()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'A COMPLETED structure analysis is immutable' using errcode = '23514';
end;
$$;

create trigger repository_structure_analyses_enforce_sealed
  before update on public.repository_structure_analyses
  for each row
  when (old.status = 'COMPLETED')
  execute function public.enforce_structure_analysis_sealed();

-- Generated structure can only be INSERTed while the analysis is PROCESSING, and is never UPDATEd.
-- (No DELETE trigger: cascades from analysis, file, snapshot and repository must keep working.)
create or replace function public.enforce_structure_write_window()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'Generated structure is immutable' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.repository_structure_analyses a where a.id = new.analysis_id and a.status = 'PROCESSING'
  ) then
    raise exception 'Structure can only be written while the analysis is PROCESSING' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger repository_symbols_enforce_write_window
  before insert or update on public.repository_symbols
  for each row execute function public.enforce_structure_write_window();

create trigger repository_symbol_relationships_enforce_write_window
  before insert or update on public.repository_symbol_relationships
  for each row execute function public.enforce_structure_write_window();

-- 4. Lifecycle functions (SECURITY DEFINER: they re-check authorization themselves) ---------------

-- Every function below: caller must be authenticated and OWNER/ADMIN of the organization derived from the analysis
-- (an unknown analysis and an unauthorized caller are indistinguishable: 42501).

create or replace function public.begin_structure_analysis(p_analysis_id uuid)
returns table (analysis_id uuid, run_token text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org uuid;
  v_status text;
  v_token text;
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  v_org := private.structure_analysis_org(p_analysis_id);
  if v_org is null or not public.has_org_role(v_org, array['OWNER', 'ADMIN']) then
    raise exception 'Analysis not found' using errcode = '42501';
  end if;

  select a.status into v_status from public.repository_structure_analyses a where a.id = p_analysis_id for update;
  if v_status <> 'PENDING' then
    raise exception 'Analysis is not PENDING (it is %)', v_status using errcode = '55000';
  end if;

  update public.repository_structure_analyses a
  set status = 'PROCESSING', started_at = now(), completed_at = null, error_message = null,
      files_total = 0, files_analyzed = 0, files_unsupported = 0, files_failed = 0,
      symbols_count = 0, relationships_count = 0
  where a.id = p_analysis_id;

  -- a new run starts from nothing (relationships cascade)
  delete from public.repository_symbols s where s.analysis_id = p_analysis_id;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into private.structure_analysis_runs (analysis_id, run_token) values (p_analysis_id, v_token)
  on conflict (analysis_id) do update set run_token = excluded.run_token, created_at = now();

  return query select p_analysis_id, v_token;
end;
$$;

create or replace function public.fail_structure_analysis(p_analysis_id uuid, p_error_message text)
returns table (analysis_id uuid, status text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org uuid;
  v_status text;
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  v_org := private.structure_analysis_org(p_analysis_id);
  if v_org is null or not public.has_org_role(v_org, array['OWNER', 'ADMIN']) then
    raise exception 'Analysis not found' using errcode = '42501';
  end if;

  select a.status into v_status from public.repository_structure_analyses a where a.id = p_analysis_id for update;
  if v_status not in ('PENDING', 'PROCESSING') then
    raise exception 'Analysis cannot be failed from %', v_status using errcode = '55000';
  end if;

  update public.repository_structure_analyses a
  set status = 'FAILED', completed_at = now(),
      error_message = left(coalesce(nullif(btrim(p_error_message), ''), 'Structure analysis failed.'), 2000)
  where a.id = p_analysis_id;

  delete from private.structure_analysis_runs r where r.analysis_id = p_analysis_id;
  delete from public.repository_symbols s where s.analysis_id = p_analysis_id;

  return query select p_analysis_id, 'FAILED'::text;
end;
$$;

create or replace function public.reset_structure_analysis(p_analysis_id uuid)
returns table (analysis_id uuid, status text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org uuid;
  v_status text;
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  v_org := private.structure_analysis_org(p_analysis_id);
  if v_org is null or not public.has_org_role(v_org, array['OWNER', 'ADMIN']) then
    raise exception 'Analysis not found' using errcode = '42501';
  end if;

  select a.status into v_status from public.repository_structure_analyses a where a.id = p_analysis_id for update;
  if v_status <> 'FAILED' then
    raise exception 'Only a FAILED analysis can be reset (it is %)', v_status using errcode = '55000';
  end if;

  update public.repository_structure_analyses a
  set status = 'PENDING', started_at = null, completed_at = null, error_message = null,
      files_total = 0, files_analyzed = 0, files_unsupported = 0, files_failed = 0,
      symbols_count = 0, relationships_count = 0
  where a.id = p_analysis_id;

  delete from private.structure_analysis_runs r where r.analysis_id = p_analysis_id;
  delete from public.repository_symbols s where s.analysis_id = p_analysis_id;

  return query select p_analysis_id, 'PENDING'::text;
end;
$$;

-- 5. Signed, atomic persistence ----------------------------------------------------------------

drop function public.persist_structure_analysis(uuid, jsonb, jsonb, integer, integer, integer, integer);

create or replace function public.persist_structure_analysis(
  p_analysis_id       uuid,
  p_run_token         text,
  p_symbols           jsonb,
  p_relationships     jsonb,
  p_files_total       integer,
  p_files_analyzed    integer,
  p_files_unsupported integer,
  p_files_failed      integer,
  p_signature         text
)
returns table (id uuid, status text, symbols_count integer, relationships_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_status text;
  v_stored_token text;
  v_key text;
  v_message text;
  v_symbol_total int;
  v_ids uuid[];
  v_symbols int;
  v_relationships int;
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  v_org := private.structure_analysis_org(p_analysis_id);
  if v_org is null or not public.has_org_role(v_org, array['OWNER', 'ADMIN']) then
    raise exception 'Analysis not found' using errcode = '42501';
  end if;
  if p_run_token is null or p_signature is null
     or p_files_total is null or p_files_analyzed is null or p_files_unsupported is null or p_files_failed is null
     or jsonb_typeof(p_symbols) is distinct from 'array' or jsonb_typeof(p_relationships) is distinct from 'array' then
    raise exception 'Invalid structure payload' using errcode = '22023';
  end if;

  select a.status into v_status from public.repository_structure_analyses a where a.id = p_analysis_id for update;
  if v_status <> 'PROCESSING' then
    raise exception 'Analysis is not PROCESSING (it is %)', v_status using errcode = '55000';
  end if;

  -- 1. the run token binds the payload to THIS execution (replaced on every retry, deleted on completion)
  select r.run_token into v_stored_token from private.structure_analysis_runs r where r.analysis_id = p_analysis_id;
  if v_stored_token is null or v_stored_token <> p_run_token then
    raise exception 'Invalid run token' using errcode = '42501';
  end if;

  -- 2. the HMAC proves the payload was produced by a holder of the server-only key. Verified BEFORE any write.
  --    Compared as HMAC(supplied) = HMAC(expected) so the comparison does not depend on where the strings differ.
  v_key := private.structure_persist_key();
  v_message := private.structure_canonical(p_analysis_id, p_run_token, p_symbols, p_relationships,
                                           p_files_total, p_files_analyzed, p_files_unsupported, p_files_failed);
  if extensions.hmac(convert_to(p_signature, 'UTF8'), convert_to(v_key, 'UTF8'), 'sha256')
     <> extensions.hmac(convert_to(private.structure_hmac(v_message, v_key), 'UTF8'), convert_to(v_key, 'UTF8'), 'sha256') then
    raise exception 'Invalid structure signature' using errcode = '42501';
  end if;

  v_symbol_total := jsonb_array_length(p_symbols);
  v_ids := array(select gen_random_uuid() from generate_series(1, v_symbol_total));

  delete from public.repository_symbol_relationships r where r.analysis_id = p_analysis_id;
  delete from public.repository_symbols s where s.analysis_id = p_analysis_id;

  insert into public.repository_symbols
    (id, analysis_id, file_id, name, kind, qualified_name, signature,
     start_line, start_column, end_line, end_column, visibility)
  select v_ids[e.ord::int],
         p_analysis_id,
         (e.obj ->> 'file_id')::uuid,
         e.obj ->> 'name',
         e.obj ->> 'kind',
         e.obj ->> 'qualified_name',
         e.obj ->> 'signature',
         (e.obj ->> 'start_line')::int,
         (e.obj ->> 'start_column')::int,
         (e.obj ->> 'end_line')::int,
         (e.obj ->> 'end_column')::int,
         e.obj ->> 'visibility'
  from jsonb_array_elements(p_symbols) with ordinality as e(obj, ord);

  insert into public.repository_symbol_relationships (analysis_id, source_symbol_id, target_symbol_id, relationship_type)
  select p_analysis_id,
         v_ids[(e.obj ->> 'source_index')::int + 1],
         v_ids[(e.obj ->> 'target_index')::int + 1],
         e.obj ->> 'relationship_type'
  from jsonb_array_elements(p_relationships) as e(obj);

  select count(*) into v_symbols from public.repository_symbols s where s.analysis_id = p_analysis_id;
  select count(*) into v_relationships from public.repository_symbol_relationships r where r.analysis_id = p_analysis_id;

  update public.repository_structure_analyses a
  set status = 'COMPLETED',
      completed_at = now(),
      error_message = null,
      files_total = p_files_total,
      files_analyzed = p_files_analyzed,
      files_unsupported = p_files_unsupported,
      files_failed = p_files_failed,
      symbols_count = v_symbols,
      relationships_count = v_relationships
  where a.id = p_analysis_id;

  -- the token is consumed: the same run can never be persisted twice
  delete from private.structure_analysis_runs r where r.analysis_id = p_analysis_id;

  return query
    select a.id, a.status, a.symbols_count, a.relationships_count
    from public.repository_structure_analyses a
    where a.id = p_analysis_id;
end;
$$;

revoke all on function public.begin_structure_analysis(uuid) from public, anon;
grant execute on function public.begin_structure_analysis(uuid) to authenticated;
revoke all on function public.fail_structure_analysis(uuid, text) from public, anon;
grant execute on function public.fail_structure_analysis(uuid, text) to authenticated;
revoke all on function public.reset_structure_analysis(uuid) from public, anon;
grant execute on function public.reset_structure_analysis(uuid) to authenticated;
revoke all on function public.persist_structure_analysis(uuid, text, jsonb, jsonb, integer, integer, integer, integer, text) from public, anon;
grant execute on function public.persist_structure_analysis(uuid, text, jsonb, jsonb, integer, integer, integer, integer, text) to authenticated;
