-- Phase 2F: repository connection foundation (metadata only).
-- A project has zero or one primary repository (UNIQUE(project_id)). Ownership is derived through the
-- existing hierarchy only: repository -> project -> team -> department -> organization, so the table
-- carries no organization/department/team shortcut columns and there is no repository_members table.
--
-- This phase stores METADATA ONLY. There is no provider API call, no cloning, no analysis, and
-- deliberately NO credential columns of any kind (no tokens, passwords, keys, secrets). The URL check
-- below also refuses URLs that embed credentials (https://user:token@host/...), query strings or fragments,
-- so a secret cannot be smuggled into repository_url.
--
-- Authorization reuses Phase 2A's has_org_role() and the existing project visibility rule:
--   * READ  : whoever can see the parent project (OWNER/ADMIN or team member), via projects' own RLS.
--   * WRITE : OWNER/ADMIN of the derived organization.
-- No new security-definer functions; no policy on projects/teams/departments references this table,
-- so there is no recursion.

create table public.repositories (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects (id) on delete cascade,
  provider       text not null check (provider in ('GITHUB', 'GITLAB', 'BITBUCKET', 'GENERIC_GIT')),
  -- https only; no userinfo (@), query (?) or fragment (#); no whitespace.
  repository_url text not null check (
                   char_length(repository_url) <= 2048
                   and repository_url ~ '^https://[^/@?#[:space:]]+(/[^?#[:space:]]*)?$'
                 ),
  -- owner may contain '/' for nested groups (GitLab subgroups); name may not.
  owner          text not null check (char_length(owner) between 1 and 100 and owner ~ '^[A-Za-z0-9._/-]+$'),
  name           text not null check (char_length(name) between 1 and 100 and name ~ '^[A-Za-z0-9._-]+$'),
  -- never assume "main"; reject whitespace, git-ref metacharacters, "..", and a leading dash.
  default_branch text not null check (
                   char_length(default_branch) between 1 and 255
                   and default_branch !~ '[[:space:]~^:?*\[\\]'
                   and default_branch not like '-%'
                   and default_branch not like '%..%'
                 ),
  visibility     text not null default 'UNKNOWN' check (visibility in ('PUBLIC', 'PRIVATE', 'INTERNAL', 'UNKNOWN')),
  status         text not null default 'PENDING' check (status in ('PENDING', 'CONNECTED', 'DISCONNECTED', 'ERROR')),
  created_by     uuid not null references auth.users (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint repositories_project_key unique (project_id)
);

create index repositories_project_id_idx on public.repositories (project_id);
create index repositories_created_by_idx on public.repositories (created_by);
create index repositories_provider_idx   on public.repositories (provider);
create index repositories_status_idx     on public.repositories (status);

create trigger repositories_set_updated_at
  before update on public.repositories
  for each row execute function public.set_updated_at();

-- Lifecycle: PENDING -> CONNECTED | ERROR; CONNECTED -> DISCONNECTED | ERROR;
-- DISCONNECTED -> PENDING; ERROR -> PENDING. Everything else is rejected;
-- same-status updates are no-ops (the trigger only fires on a change).
-- SECURITY INVOKER: pure validation, needs no privileges.
create or replace function public.enforce_repository_status_transition()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not (
    (old.status = 'PENDING'      and new.status in ('CONNECTED', 'ERROR')) or
    (old.status = 'CONNECTED'    and new.status in ('DISCONNECTED', 'ERROR')) or
    (old.status = 'DISCONNECTED' and new.status = 'PENDING') or
    (old.status = 'ERROR'        and new.status = 'PENDING')
  ) then
    raise exception 'Invalid repository status transition: % -> %', old.status, new.status
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger repositories_enforce_status_transition
  before update of status on public.repositories
  for each row
  when (old.status is distinct from new.status)
  execute function public.enforce_repository_status_transition();

alter table public.repositories enable row level security;

-- SELECT: exactly when the parent project is visible (projects RLS: OWNER/ADMIN or team member).
create policy "repositories_select_project_visible"
  on public.repositories for select
  to authenticated
  using (exists (
    select 1 from public.projects p where p.id = repositories.project_id
  ));

-- INSERT: OWNER/ADMIN of the project's organization, as themselves, and always as PENDING.
create policy "repositories_insert_admin"
  on public.repositories for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and status = 'PENDING'
    and exists (
      select 1
      from public.projects p
      join public.teams t on t.id = p.team_id
      join public.departments d on d.id = t.department_id
      where p.id = repositories.project_id
        and public.has_org_role(d.organization_id, array['OWNER', 'ADMIN'])
    )
  );

create policy "repositories_update_admin"
  on public.repositories for update
  to authenticated
  using (exists (
    select 1
    from public.projects p
    join public.teams t on t.id = p.team_id
    join public.departments d on d.id = t.department_id
    where p.id = repositories.project_id
      and public.has_org_role(d.organization_id, array['OWNER', 'ADMIN'])
  ))
  with check (exists (
    select 1
    from public.projects p
    join public.teams t on t.id = p.team_id
    join public.departments d on d.id = t.department_id
    where p.id = repositories.project_id
      and public.has_org_role(d.organization_id, array['OWNER', 'ADMIN'])
  ));

create policy "repositories_delete_admin"
  on public.repositories for delete
  to authenticated
  using (exists (
    select 1
    from public.projects p
    join public.teams t on t.id = p.team_id
    join public.departments d on d.id = t.department_id
    where p.id = repositories.project_id
      and public.has_org_role(d.organization_id, array['OWNER', 'ADMIN'])
  ));

-- Privileges: deny by default, then grant only what clients need.
-- Identity (provider, repository_url, owner, name), project_id, created_by, created_at and id are immutable
-- for clients: to point a project at a different repository, disconnect (delete) and connect again.
revoke all on public.repositories from anon, authenticated;
grant select on public.repositories to authenticated;
grant insert (project_id, provider, repository_url, owner, name, default_branch, visibility, status, created_by)
  on public.repositories to authenticated;
grant update (default_branch, visibility, status) on public.repositories to authenticated;
grant delete on public.repositories to authenticated;

-- Creation RPC. SECURITY INVOKER: the insert policy above is the authorization boundary, so a forged
-- project id is rejected by RLS (42501). Identity comes from auth.uid(); created_by is never accepted from
-- the caller, and a new repository is always PENDING.
create or replace function public.create_repository(
  p_project_id     uuid,
  p_provider       text,
  p_repository_url text,
  p_owner          text,
  p_name           text,
  p_default_branch text,
  p_visibility     text default 'UNKNOWN'
)
returns table (
  id uuid, project_id uuid, provider text, repository_url text, owner text, name text,
  default_branch text, visibility text, status text
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

  insert into public.repositories as r
    (project_id, provider, repository_url, owner, name, default_branch, visibility, status, created_by)
  values
    (p_project_id, p_provider, btrim(p_repository_url), btrim(p_owner), btrim(p_name),
     btrim(p_default_branch), p_visibility, 'PENDING', v_user_id)
  returning r.id into v_id;

  return query
    select r.id, r.project_id, r.provider, r.repository_url, r.owner, r.name,
           r.default_branch, r.visibility, r.status
    from public.repositories r
    where r.id = v_id;
end;
$$;

revoke all on function public.create_repository(uuid, text, text, text, text, text, text) from public, anon;
grant execute on function public.create_repository(uuid, text, text, text, text, text, text) to authenticated;
