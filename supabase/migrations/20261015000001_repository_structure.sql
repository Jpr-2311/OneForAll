-- Phase 2H: deterministic code-structure intelligence.
--   repository_snapshots -> repository_structure_analyses (one per snapshot)
--                        -> repository_symbols            (per analysis, per file)
--                        -> repository_symbol_relationships
-- Everything is snapshot-scoped. Ownership is derived through the existing hierarchy only
--   relationship/symbol -> analysis -> snapshot -> repository -> project -> team -> department -> organization
-- so none of these tables carries an organization/department/team/project shortcut column.
--
-- NOT an AI phase: no LLM, embeddings, vectors, graph database or provider call. Source code is never stored
-- in PostgreSQL; only extracted structure (names, kinds, positions, signatures) is.
--
-- POSITION CONVENTION (documented once, used everywhere): start_line/end_line and start_column/end_column are
-- all 0-based, exactly as Tree-sitter reports them. Columns count UTF-16 code units (a JavaScript string index).
-- The end position is exclusive (the position just after the last character of the symbol).
--
-- Authorization reuses Phase 2A's has_org_role() and the parent-visibility strategy of Phases 2D-2G:
--   * READ  : whoever can see the parent (analyses read `repository_snapshots`; symbols and relationships read
--             `repository_structure_analyses`), each under the caller's own RLS.
--   * WRITE : OWNER/ADMIN of the derived organization.
-- No new security-definer functions; no policy on the parent tables references these tables, so no recursion.

-- Analyses ------------------------------------------------------------------

create table public.repository_structure_analyses (
  id                  uuid primary key default gen_random_uuid(),
  snapshot_id         uuid not null references public.repository_snapshots (id) on delete cascade,
  status              text not null default 'PENDING' check (status in ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
  started_at          timestamptz,
  completed_at        timestamptz,
  error_message       text check (char_length(error_message) <= 2000),
  files_total         integer not null default 0 check (files_total >= 0),
  files_analyzed      integer not null default 0 check (files_analyzed >= 0),
  files_unsupported   integer not null default 0 check (files_unsupported >= 0),
  files_failed        integer not null default 0 check (files_failed >= 0),
  symbols_count       integer not null default 0 check (symbols_count >= 0),
  relationships_count integer not null default 0 check (relationships_count >= 0),
  created_at          timestamptz not null default now(),
  -- one analysis per snapshot: a FAILED one is retried in place, a COMPLETED one is terminal.
  constraint repository_structure_analyses_snapshot_key unique (snapshot_id),
  constraint repository_structure_analyses_completed_has_timestamp check (status <> 'COMPLETED' or completed_at is not null),
  constraint repository_structure_analyses_time_order check (started_at is null or completed_at is null or completed_at >= started_at),
  constraint repository_structure_analyses_file_counts check (files_analyzed + files_unsupported + files_failed <= files_total)
);

create index repository_structure_analyses_status_idx on public.repository_structure_analyses (status);

-- Lifecycle: PENDING -> PROCESSING | FAILED; PROCESSING -> COMPLETED | FAILED; FAILED -> PENDING.
-- COMPLETED is terminal. Same-status updates are no-ops (the trigger only fires on a change).
-- SECURITY INVOKER: pure validation, needs no privileges. (The UPDATE policy below ALSO seals a COMPLETED row;
-- this trigger is defense in depth for any path that bypasses RLS.)
create or replace function public.enforce_structure_analysis_status_transition()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not (
    (old.status = 'PENDING'    and new.status in ('PROCESSING', 'FAILED')) or
    (old.status = 'PROCESSING' and new.status in ('COMPLETED', 'FAILED')) or
    (old.status = 'FAILED'     and new.status = 'PENDING')
  ) then
    raise exception 'Invalid structure analysis status transition: % -> %', old.status, new.status
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger repository_structure_analyses_enforce_status_transition
  before update of status on public.repository_structure_analyses
  for each row
  when (old.status is distinct from new.status)
  execute function public.enforce_structure_analysis_status_transition();

-- An analysis may only become COMPLETED when its recorded metrics agree with what is actually persisted:
-- symbols_count/relationships_count equal the real row counts, and the file counts account for every file of
-- the snapshot exactly. So metrics cannot be forged on completion, and a half-persisted analysis cannot complete.
-- SECURITY INVOKER: it counts rows the caller (an OWNER/ADMIN of the organization) can already read.
create or replace function public.enforce_structure_analysis_completion()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_symbols int;
  v_relationships int;
  v_files int;
begin
  select count(*) into v_symbols from public.repository_symbols s where s.analysis_id = new.id;
  select count(*) into v_relationships from public.repository_symbol_relationships r where r.analysis_id = new.id;
  select count(*) into v_files from public.repository_files f where f.snapshot_id = new.snapshot_id;

  if new.symbols_count <> v_symbols then
    raise exception 'symbols_count (%) does not match the persisted symbols (%)', new.symbols_count, v_symbols
      using errcode = '23514';
  end if;
  if new.relationships_count <> v_relationships then
    raise exception 'relationships_count (%) does not match the persisted relationships (%)', new.relationships_count, v_relationships
      using errcode = '23514';
  end if;
  if new.files_total <> v_files then
    raise exception 'files_total (%) does not match the snapshot manifest (%)', new.files_total, v_files
      using errcode = '23514';
  end if;
  if new.files_analyzed + new.files_unsupported + new.files_failed <> new.files_total then
    raise exception 'file counts do not add up to files_total' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger repository_structure_analyses_enforce_completion
  before update of status on public.repository_structure_analyses
  for each row
  when (new.status = 'COMPLETED' and old.status is distinct from 'COMPLETED')
  execute function public.enforce_structure_analysis_completion();

alter table public.repository_structure_analyses enable row level security;

-- SELECT: exactly when the parent snapshot is visible (snapshots RLS -> repositories RLS -> projects RLS).
create policy "repository_structure_analyses_select_snapshot_visible"
  on public.repository_structure_analyses for select
  to authenticated
  using (exists (
    select 1 from public.repository_snapshots s where s.id = repository_structure_analyses.snapshot_id
  ));

-- INSERT: OWNER/ADMIN of the derived organization, always as PENDING, and only for a COMPLETED snapshot
-- (a COMPLETED snapshot is sealed, so its file manifest cannot change underneath the analysis).
create policy "repository_structure_analyses_insert_admin"
  on public.repository_structure_analyses for insert
  to authenticated
  with check (
    status = 'PENDING'
    and exists (
      select 1
      from public.repository_snapshots s
      join public.repositories r on r.id = s.repository_id
      join public.projects p on p.id = r.project_id
      join public.teams t on t.id = p.team_id
      join public.departments d on d.id = t.department_id
      where s.id = repository_structure_analyses.snapshot_id
        and s.status = 'COMPLETED'
        and public.has_org_role(d.organization_id, array['OWNER', 'ADMIN'])
    )
  );

-- UPDATE: OWNER/ADMIN, and only while the EXISTING row is not COMPLETED. COMPLETED is terminal, so a completed
-- analysis cannot be changed in any column; the only way to remove one is to delete it. USING is evaluated
-- against the old row, so PROCESSING -> COMPLETED still works. WITH CHECK is unchanged.
create policy "repository_structure_analyses_update_admin"
  on public.repository_structure_analyses for update
  to authenticated
  using (
    status <> 'COMPLETED'
    and exists (
      select 1
      from public.repository_snapshots s
      join public.repositories r on r.id = s.repository_id
      join public.projects p on p.id = r.project_id
      join public.teams t on t.id = p.team_id
      join public.departments d on d.id = t.department_id
      where s.id = repository_structure_analyses.snapshot_id
        and public.has_org_role(d.organization_id, array['OWNER', 'ADMIN'])
    )
  )
  with check (exists (
    select 1
    from public.repository_snapshots s
    join public.repositories r on r.id = s.repository_id
    join public.projects p on p.id = r.project_id
    join public.teams t on t.id = p.team_id
    join public.departments d on d.id = t.department_id
    where s.id = repository_structure_analyses.snapshot_id
      and public.has_org_role(d.organization_id, array['OWNER', 'ADMIN'])
  ));

-- DELETE: OWNER/ADMIN, any status. Deleting an analysis removes its symbols and relationships (cascade) and is
-- the explicit way to run a fresh analysis of a snapshot whose analysis is COMPLETED.
create policy "repository_structure_analyses_delete_admin"
  on public.repository_structure_analyses for delete
  to authenticated
  using (exists (
    select 1
    from public.repository_snapshots s
    join public.repositories r on r.id = s.repository_id
    join public.projects p on p.id = r.project_id
    join public.teams t on t.id = p.team_id
    join public.departments d on d.id = t.department_id
    where s.id = repository_structure_analyses.snapshot_id
      and public.has_org_role(d.organization_id, array['OWNER', 'ADMIN'])
  ));

-- Privileges: deny by default. id, snapshot_id and created_at are immutable for clients; a new analysis can only
-- be inserted with (snapshot_id, status), so every metric starts at its default of 0.
revoke all on public.repository_structure_analyses from anon, authenticated;
grant select on public.repository_structure_analyses to authenticated;
grant insert (snapshot_id, status) on public.repository_structure_analyses to authenticated;
grant update (status, started_at, completed_at, error_message, files_total, files_analyzed, files_unsupported,
              files_failed, symbols_count, relationships_count) on public.repository_structure_analyses to authenticated;
grant delete on public.repository_structure_analyses to authenticated;

-- Symbols -------------------------------------------------------------------

create table public.repository_symbols (
  id             uuid primary key default gen_random_uuid(),
  analysis_id    uuid not null references public.repository_structure_analyses (id) on delete cascade,
  file_id        uuid not null references public.repository_files (id) on delete cascade,
  name           text not null check (char_length(btrim(name)) between 1 and 500),
  kind           text not null check (kind in ('CLASS', 'INTERFACE', 'FUNCTION', 'METHOD', 'CONSTRUCTOR',
                                               'VARIABLE', 'CONSTANT', 'ENUM', 'TYPE', 'MODULE')),
  -- only when deterministically available (scope chain, plus the Java package); otherwise NULL, never invented.
  qualified_name text check (char_length(qualified_name) between 1 and 1000),
  -- parser-derived, whitespace-normalized; NULL when it cannot be extracted reliably.
  signature      text check (char_length(signature) between 1 and 2000),
  start_line     integer not null check (start_line >= 0),
  start_column   integer not null check (start_column >= 0),
  end_line       integer not null check (end_line >= 0),
  end_column     integer not null check (end_column >= 0),
  visibility     text check (visibility in ('PUBLIC', 'PRIVATE', 'PROTECTED', 'INTERNAL', 'PACKAGE', 'UNKNOWN')),
  created_at     timestamptz not null default now(),
  constraint repository_symbols_position_order check (
    end_line > start_line or (end_line = start_line and end_column >= start_column)
  )
);

create index repository_symbols_analysis_id_idx on public.repository_symbols (analysis_id);
create index repository_symbols_file_id_idx     on public.repository_symbols (file_id);
create index repository_symbols_kind_idx        on public.repository_symbols (kind);
create index repository_symbols_name_idx        on public.repository_symbols (name);

-- Idempotency: the same symbol cannot be inserted twice into one analysis, so a retry can never duplicate rows.
create unique index repository_symbols_dedupe_key
  on public.repository_symbols (analysis_id, file_id, kind, name, start_line, start_column);

-- SNAPSHOT ISOLATION (database-enforced): a symbol's file must belong to the same snapshot as its analysis.
-- A forged "analysis of snapshot A + file of snapshot B" is rejected here, whatever the application does.
-- SECURITY INVOKER: both lookups run under the caller's RLS; anything the caller cannot see is treated as a mismatch.
create or replace function public.enforce_symbol_snapshot_isolation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_analysis_snapshot uuid;
  v_file_snapshot uuid;
begin
  select a.snapshot_id into v_analysis_snapshot from public.repository_structure_analyses a where a.id = new.analysis_id;
  select f.snapshot_id into v_file_snapshot from public.repository_files f where f.id = new.file_id;
  if v_analysis_snapshot is null or v_file_snapshot is null or v_analysis_snapshot <> v_file_snapshot then
    raise exception 'A symbol file must belong to the snapshot of its analysis' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger repository_symbols_enforce_snapshot_isolation
  before insert or update of analysis_id, file_id on public.repository_symbols
  for each row execute function public.enforce_symbol_snapshot_isolation();

alter table public.repository_symbols enable row level security;

-- SELECT: exactly when the parent analysis is visible.
create policy "repository_symbols_select_analysis_visible"
  on public.repository_symbols for select
  to authenticated
  using (exists (
    select 1 from public.repository_structure_analyses a where a.id = repository_symbols.analysis_id
  ));

-- INSERT/DELETE: OWNER/ADMIN of the derived organization, and only while the analysis is PROCESSING. A PENDING,
-- FAILED or COMPLETED analysis never has its structure edited directly (a retry clears it inside PROCESSING).
create policy "repository_symbols_insert_admin"
  on public.repository_symbols for insert
  to authenticated
  with check (exists (
    select 1
    from public.repository_structure_analyses a
    join public.repository_snapshots s on s.id = a.snapshot_id
    join public.repositories r on r.id = s.repository_id
    join public.projects p on p.id = r.project_id
    join public.teams t on t.id = p.team_id
    join public.departments d on d.id = t.department_id
    where a.id = repository_symbols.analysis_id
      and a.status = 'PROCESSING'
      and public.has_org_role(d.organization_id, array['OWNER', 'ADMIN'])
  ));

create policy "repository_symbols_delete_admin"
  on public.repository_symbols for delete
  to authenticated
  using (exists (
    select 1
    from public.repository_structure_analyses a
    join public.repository_snapshots s on s.id = a.snapshot_id
    join public.repositories r on r.id = s.repository_id
    join public.projects p on p.id = r.project_id
    join public.teams t on t.id = p.team_id
    join public.departments d on d.id = t.department_id
    where a.id = repository_symbols.analysis_id
      and a.status = 'PROCESSING'
      and public.has_org_role(d.organization_id, array['OWNER', 'ADMIN'])
  ));

-- Symbols are immutable once written: there is deliberately NO update grant and NO update policy.
revoke all on public.repository_symbols from anon, authenticated;
grant select on public.repository_symbols to authenticated;
grant insert (id, analysis_id, file_id, name, kind, qualified_name, signature, start_line, start_column,
              end_line, end_column, visibility) on public.repository_symbols to authenticated;
grant delete on public.repository_symbols to authenticated;

-- Relationships ---------------------------------------------------------------

create table public.repository_symbol_relationships (
  id                uuid primary key default gen_random_uuid(),
  analysis_id       uuid not null references public.repository_structure_analyses (id) on delete cascade,
  source_symbol_id  uuid not null references public.repository_symbols (id) on delete cascade,
  target_symbol_id  uuid not null references public.repository_symbols (id) on delete cascade,
  relationship_type text not null check (relationship_type in ('CONTAINS', 'IMPORTS', 'CALLS', 'EXTENDS', 'IMPLEMENTS', 'REFERENCES')),
  created_at        timestamptz not null default now(),
  -- a symbol never contains/imports/extends/implements itself; only CALLS (recursion) and REFERENCES may be reflexive.
  constraint repository_symbol_relationships_no_self check (
    source_symbol_id <> target_symbol_id or relationship_type in ('CALLS', 'REFERENCES')
  ),
  constraint repository_symbol_relationships_dedupe_key unique (analysis_id, source_symbol_id, target_symbol_id, relationship_type)
);

create index repository_symbol_relationships_analysis_id_idx on public.repository_symbol_relationships (analysis_id);
create index repository_symbol_relationships_source_idx      on public.repository_symbol_relationships (source_symbol_id);
create index repository_symbol_relationships_target_idx      on public.repository_symbol_relationships (target_symbol_id);
create index repository_symbol_relationships_type_idx        on public.repository_symbol_relationships (relationship_type);

-- RELATIONSHIP ISOLATION (database-enforced): relationship.analysis_id = source.analysis_id = target.analysis_id.
-- SECURITY INVOKER; symbols the caller cannot see count as a mismatch.
create or replace function public.enforce_relationship_analysis_isolation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_source_analysis uuid;
  v_target_analysis uuid;
begin
  select s.analysis_id into v_source_analysis from public.repository_symbols s where s.id = new.source_symbol_id;
  select s.analysis_id into v_target_analysis from public.repository_symbols s where s.id = new.target_symbol_id;
  if v_source_analysis is null or v_target_analysis is null
     or v_source_analysis <> new.analysis_id or v_target_analysis <> new.analysis_id then
    raise exception 'Relationship symbols must both belong to the relationship analysis' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger repository_symbol_relationships_enforce_isolation
  before insert or update of analysis_id, source_symbol_id, target_symbol_id on public.repository_symbol_relationships
  for each row execute function public.enforce_relationship_analysis_isolation();

alter table public.repository_symbol_relationships enable row level security;

create policy "repository_symbol_relationships_select_analysis_visible"
  on public.repository_symbol_relationships for select
  to authenticated
  using (exists (
    select 1 from public.repository_structure_analyses a where a.id = repository_symbol_relationships.analysis_id
  ));

create policy "repository_symbol_relationships_insert_admin"
  on public.repository_symbol_relationships for insert
  to authenticated
  with check (exists (
    select 1
    from public.repository_structure_analyses a
    join public.repository_snapshots s on s.id = a.snapshot_id
    join public.repositories r on r.id = s.repository_id
    join public.projects p on p.id = r.project_id
    join public.teams t on t.id = p.team_id
    join public.departments d on d.id = t.department_id
    where a.id = repository_symbol_relationships.analysis_id
      and a.status = 'PROCESSING'
      and public.has_org_role(d.organization_id, array['OWNER', 'ADMIN'])
  ));

create policy "repository_symbol_relationships_delete_admin"
  on public.repository_symbol_relationships for delete
  to authenticated
  using (exists (
    select 1
    from public.repository_structure_analyses a
    join public.repository_snapshots s on s.id = a.snapshot_id
    join public.repositories r on r.id = s.repository_id
    join public.projects p on p.id = r.project_id
    join public.teams t on t.id = p.team_id
    join public.departments d on d.id = t.department_id
    where a.id = repository_symbol_relationships.analysis_id
      and a.status = 'PROCESSING'
      and public.has_org_role(d.organization_id, array['OWNER', 'ADMIN'])
  ));

revoke all on public.repository_symbol_relationships from anon, authenticated;
grant select on public.repository_symbol_relationships to authenticated;
grant insert (analysis_id, source_symbol_id, target_symbol_id, relationship_type)
  on public.repository_symbol_relationships to authenticated;
grant delete on public.repository_symbol_relationships to authenticated;

-- RPCs ------------------------------------------------------------------------
-- SECURITY INVOKER throughout: the policies above are the authorization boundary.

-- A new analysis is always PENDING with zeroed metrics (only snapshot_id and status are insertable).
create or replace function public.create_structure_analysis(p_snapshot_id uuid)
returns table (id uuid, snapshot_id uuid, status text, created_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  insert into public.repository_structure_analyses as a (snapshot_id, status)
  values (p_snapshot_id, 'PENDING')
  returning a.id into v_id;

  return query
    select a.id, a.snapshot_id, a.status, a.created_at
    from public.repository_structure_analyses a
    where a.id = v_id;
end;
$$;

-- ATOMIC persistence. One function call is one transaction: clear any previous structure, insert every symbol,
-- insert every relationship, record the metrics and mark the analysis COMPLETED. If anything fails (including
-- the completion integrity trigger), everything rolls back and the analysis is left as it was (PROCESSING),
-- for the caller to mark FAILED. Rebuilding replaces rather than appends, so retries never duplicate rows.
--
-- p_symbols:       [{file_id, name, kind, qualified_name, signature, start_line, start_column, end_line, end_column, visibility}]
-- p_relationships: [{source_index, target_index, relationship_type}] where the indexes are 0-based positions in p_symbols.
-- The caller never supplies ids; they are generated here, so a relationship can only point inside this batch.
create or replace function public.persist_structure_analysis(
  p_analysis_id       uuid,
  p_symbols           jsonb,
  p_relationships     jsonb,
  p_files_total       integer,
  p_files_analyzed    integer,
  p_files_unsupported integer,
  p_files_failed      integer
)
returns table (id uuid, status text, symbols_count integer, relationships_count integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status text;
  v_symbol_total int;
  v_ids uuid[];
  v_symbols int;
  v_relationships int;
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if jsonb_typeof(p_symbols) is distinct from 'array' or jsonb_typeof(p_relationships) is distinct from 'array' then
    raise exception 'symbols and relationships must be JSON arrays' using errcode = '22023';
  end if;

  select a.status into v_status
  from public.repository_structure_analyses a
  where a.id = p_analysis_id
  for update;
  if v_status is null then
    raise exception 'Analysis not found' using errcode = '42501';
  end if;
  if v_status <> 'PROCESSING' then
    raise exception 'Analysis is not PROCESSING (it is %)', v_status using errcode = '55000';
  end if;

  v_symbol_total := jsonb_array_length(p_symbols);
  v_ids := array(select gen_random_uuid() from generate_series(1, v_symbol_total));

  delete from public.repository_symbol_relationships where analysis_id = p_analysis_id;
  delete from public.repository_symbols where analysis_id = p_analysis_id;

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

  return query
    select a.id, a.status, a.symbols_count, a.relationships_count
    from public.repository_structure_analyses a
    where a.id = p_analysis_id;
end;
$$;

revoke all on function public.create_structure_analysis(uuid) from public, anon;
grant execute on function public.create_structure_analysis(uuid) to authenticated;
revoke all on function public.persist_structure_analysis(uuid, jsonb, jsonb, integer, integer, integer, integer) from public, anon;
grant execute on function public.persist_structure_analysis(uuid, jsonb, jsonb, integer, integer, integer, integer) to authenticated;
