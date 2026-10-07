-- Phase 2G: repository snapshots and the file manifest (metadata only).
-- A repository can have many snapshots; a snapshot has many manifest rows. Ownership is derived through
-- the existing hierarchy only:
--   file -> snapshot -> repository -> project -> team -> department -> organization
-- so neither table carries an organization/department/team/project shortcut column, and there are no
-- members tables or credential columns.
--
-- METADATA ONLY. File contents are never stored here (no content/source columns): repository_files is a
-- manifest (path, detected language, size, content hash). Actual source snapshots are an ingestion/storage
-- concern for later phases. Nothing in this phase calls a provider, clones, parses or analyses code.
--
-- Authorization reuses Phase 2A's has_org_role() and the parent-visibility strategy of Phases 2D-2F:
--   * READ  : whoever can see the parent (snapshots read `repositories`, files read `repository_snapshots`,
--             each under the caller's own RLS, so "can see the project" stays the single source of truth).
--   * WRITE : OWNER/ADMIN of the derived organization.
-- No new security-definer functions; no policy on the parent tables references these tables, so no recursion.

-- Snapshots -----------------------------------------------------------------

create table public.repository_snapshots (
  id            uuid primary key default gen_random_uuid(),
  repository_id uuid not null references public.repositories (id) on delete cascade,
  -- full Git object id in lowercase hex (SHA-1: 40, SHA-256: 64); abbreviated ids are not accepted.
  commit_sha    text not null check (commit_sha ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'),
  -- never assume "main"; reject whitespace, control characters, git-ref metacharacters, "..", leading dash.
  branch        text not null check (
                  char_length(branch) between 1 and 255
                  and branch !~ '[[:space:][:cntrl:]~^:?*\[\\]'
                  and branch not like '-%'
                  and branch not like '%..%'
                ),
  status        text not null default 'PENDING' check (status in ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
  started_at    timestamptz,
  completed_at  timestamptz,
  error_message text check (char_length(error_message) <= 2000),
  created_at    timestamptz not null default now(),
  -- a completed snapshot must say when it completed; timestamps cannot run backwards.
  constraint repository_snapshots_completed_has_timestamp check (status <> 'COMPLETED' or completed_at is not null),
  constraint repository_snapshots_time_order check (started_at is null or completed_at is null or completed_at >= started_at)
);

create index repository_snapshots_repository_id_idx on public.repository_snapshots (repository_id);
create index repository_snapshots_status_idx        on public.repository_snapshots (status);
create index repository_snapshots_commit_sha_idx    on public.repository_snapshots (commit_sha);
create index repository_snapshots_branch_idx        on public.repository_snapshots (branch);

-- No meaningless duplicate COMPLETED snapshots of the same commit. Partial on purpose: FAILED, PENDING and
-- PROCESSING rows for a commit are unconstrained, so a failed ingestion can be retried (FAILED -> PENDING).
create unique index repository_snapshots_completed_commit_key
  on public.repository_snapshots (repository_id, commit_sha)
  where status = 'COMPLETED';

-- Lifecycle: PENDING -> PROCESSING | FAILED; PROCESSING -> COMPLETED | FAILED; FAILED -> PENDING.
-- COMPLETED is terminal. Everything else is rejected; same-status updates are no-ops (the trigger only
-- fires on a change). SECURITY INVOKER: pure validation, needs no privileges.
create or replace function public.enforce_snapshot_status_transition()
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
    raise exception 'Invalid snapshot status transition: % -> %', old.status, new.status
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger repository_snapshots_enforce_status_transition
  before update of status on public.repository_snapshots
  for each row
  when (old.status is distinct from new.status)
  execute function public.enforce_snapshot_status_transition();

alter table public.repository_snapshots enable row level security;

-- SELECT: exactly when the parent repository is visible (repositories RLS -> projects RLS).
create policy "repository_snapshots_select_repository_visible"
  on public.repository_snapshots for select
  to authenticated
  using (exists (
    select 1 from public.repositories r where r.id = repository_snapshots.repository_id
  ));

-- INSERT: OWNER/ADMIN of the project's organization, and always a fresh PENDING snapshot.
create policy "repository_snapshots_insert_admin"
  on public.repository_snapshots for insert
  to authenticated
  with check (
    status = 'PENDING'
    and started_at is null
    and completed_at is null
    and error_message is null
    and exists (
      select 1
      from public.repositories r
      join public.projects p on p.id = r.project_id
      join public.teams t on t.id = p.team_id
      join public.departments d on d.id = t.department_id
      where r.id = repository_snapshots.repository_id
        and public.has_org_role(d.organization_id, array['OWNER', 'ADMIN'])
    )
  );

-- UPDATE: OWNER/ADMIN, and only while the EXISTING row is not COMPLETED. COMPLETED is terminal, so a
-- completed snapshot cannot be changed in any column (status, started_at, completed_at, error_message);
-- the only way to remove one is to delete the whole snapshot. The USING clause is evaluated against the
-- old row, so PROCESSING -> COMPLETED still works (the old row is PROCESSING). WITH CHECK is unchanged.
-- The status-transition trigger stays as defense in depth for any path that bypasses RLS.
create policy "repository_snapshots_update_admin"
  on public.repository_snapshots for update
  to authenticated
  using (
    status <> 'COMPLETED'
    and exists (
      select 1
      from public.repositories r
      join public.projects p on p.id = r.project_id
      join public.teams t on t.id = p.team_id
      join public.departments d on d.id = t.department_id
      where r.id = repository_snapshots.repository_id
        and public.has_org_role(d.organization_id, array['OWNER', 'ADMIN'])
    )
  )
  with check (exists (
    select 1
    from public.repositories r
    join public.projects p on p.id = r.project_id
    join public.teams t on t.id = p.team_id
    join public.departments d on d.id = t.department_id
    where r.id = repository_snapshots.repository_id
      and public.has_org_role(d.organization_id, array['OWNER', 'ADMIN'])
  ));

create policy "repository_snapshots_delete_admin"
  on public.repository_snapshots for delete
  to authenticated
  using (exists (
    select 1
    from public.repositories r
    join public.projects p on p.id = r.project_id
    join public.teams t on t.id = p.team_id
    join public.departments d on d.id = t.department_id
    where r.id = repository_snapshots.repository_id
      and public.has_org_role(d.organization_id, array['OWNER', 'ADMIN'])
  ));

-- Privileges: deny by default, then grant only what clients need.
-- id, repository_id, commit_sha, branch and created_at are immutable for clients.
revoke all on public.repository_snapshots from anon, authenticated;
grant select on public.repository_snapshots to authenticated;
grant insert (repository_id, commit_sha, branch, status) on public.repository_snapshots to authenticated;
grant update (status, started_at, completed_at, error_message) on public.repository_snapshots to authenticated;
grant delete on public.repository_snapshots to authenticated;

-- Files (manifest) ----------------------------------------------------------

create table public.repository_files (
  id           uuid primary key default gen_random_uuid(),
  snapshot_id  uuid not null references public.repository_snapshots (id) on delete cascade,
  -- normalized relative repository path: '/' separators only, no leading/trailing/double slash, no
  -- backslash, no control characters, no "." / ".." segments, no Windows drive prefix.
  path         text not null check (
                 char_length(path) between 1 and 1024
                 and path ~ '^[^/\\[:cntrl:]]+(/[^/\\[:cntrl:]]+)*$'
                 and path !~ '(^|/)\.{1,2}(/|$)'
                 and path !~ '^[A-Za-z]:'
               ),
  -- detected from the file extension only (never parsed); NULL when unknown. Not a claim of language support.
  language     text check (char_length(language) between 1 and 50),
  size_bytes   bigint not null check (size_bytes >= 0),
  -- lowercase SHA-256 hex digest of the file content (the content itself is never stored).
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  created_at   timestamptz not null default now(),
  constraint repository_files_snapshot_path_key unique (snapshot_id, path)
);

create index repository_files_snapshot_id_idx  on public.repository_files (snapshot_id);
create index repository_files_path_idx         on public.repository_files (path);
create index repository_files_language_idx     on public.repository_files (language);
create index repository_files_content_hash_idx on public.repository_files (content_hash);

alter table public.repository_files enable row level security;

-- SELECT: exactly when the parent snapshot is visible.
create policy "repository_files_select_snapshot_visible"
  on public.repository_files for select
  to authenticated
  using (exists (
    select 1 from public.repository_snapshots s where s.id = repository_files.snapshot_id
  ));

-- INSERT/DELETE: OWNER/ADMIN of the derived organization, and only while the snapshot is still being
-- built (PENDING or PROCESSING). A COMPLETED manifest is frozen; a FAILED one is re-ingested after the
-- retry transition back to PENDING. Deleting the whole snapshot still removes its files (cascade).
create policy "repository_files_insert_admin"
  on public.repository_files for insert
  to authenticated
  with check (exists (
    select 1
    from public.repository_snapshots s
    join public.repositories r on r.id = s.repository_id
    join public.projects p on p.id = r.project_id
    join public.teams t on t.id = p.team_id
    join public.departments d on d.id = t.department_id
    where s.id = repository_files.snapshot_id
      and s.status in ('PENDING', 'PROCESSING')
      and public.has_org_role(d.organization_id, array['OWNER', 'ADMIN'])
  ));

create policy "repository_files_delete_admin"
  on public.repository_files for delete
  to authenticated
  using (exists (
    select 1
    from public.repository_snapshots s
    join public.repositories r on r.id = s.repository_id
    join public.projects p on p.id = r.project_id
    join public.teams t on t.id = p.team_id
    join public.departments d on d.id = t.department_id
    where s.id = repository_files.snapshot_id
      and s.status in ('PENDING', 'PROCESSING')
      and public.has_org_role(d.organization_id, array['OWNER', 'ADMIN'])
  ));

-- Manifest rows are immutable once written: there is deliberately NO update grant and NO update policy.
-- If a row is wrong, the snapshot is re-ingested rather than a row being edited.
revoke all on public.repository_files from anon, authenticated;
grant select on public.repository_files to authenticated;
grant insert (snapshot_id, path, language, size_bytes, content_hash) on public.repository_files to authenticated;
grant delete on public.repository_files to authenticated;

-- Snapshot creation RPC ---------------------------------------------------------
-- SECURITY INVOKER: the insert policy above is the authorization boundary, so a forged repository id is
-- rejected by RLS (42501). A new snapshot is always PENDING; the commit sha is normalized to lowercase.
create or replace function public.create_repository_snapshot(
  p_repository_id uuid,
  p_commit_sha    text,
  p_branch        text
)
returns table (
  id uuid, repository_id uuid, commit_sha text, branch text, status text, created_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_id      uuid;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  insert into public.repository_snapshots as s (repository_id, commit_sha, branch, status)
  values (p_repository_id, lower(btrim(p_commit_sha)), btrim(p_branch), 'PENDING')
  returning s.id into v_id;

  return query
    select s.id, s.repository_id, s.commit_sha, s.branch, s.status, s.created_at
    from public.repository_snapshots s
    where s.id = v_id;
end;
$$;

revoke all on function public.create_repository_snapshot(uuid, text, text) from public, anon;
grant execute on function public.create_repository_snapshot(uuid, text, text) to authenticated;
