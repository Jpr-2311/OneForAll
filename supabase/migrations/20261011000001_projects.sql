-- Phase 2D: projects.
-- A project belongs to exactly one team (project -> team -> department -> organization), so projects
-- carry no organization_id and there is no project_members table: normal-member access is inherited
-- from team membership. Authorization reuses has_org_role() from Phase 2A.
-- No new security-definer functions: policies read `teams`, `departments` and `team_members` under the
-- caller's own RLS, which only returns rows for organization members. No policy on those tables
-- references `projects`, so there is no recursion.

create table public.projects (
  id           uuid primary key default gen_random_uuid(),
  team_id      uuid not null references public.teams (id) on delete cascade,
  name         text not null check (char_length(btrim(name)) between 1 and 150),
  slug         text not null check (
                 char_length(slug) between 1 and 63
                 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
               ),
  description  text check (char_length(description) <= 1000),
  project_type text not null check (project_type in ('GREENFIELD', 'BROWNFIELD')),
  status       text not null default 'DRAFT' check (status in ('DRAFT', 'ACTIVE', 'ARCHIVED')),
  created_by   uuid not null references auth.users (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint projects_team_slug_key unique (team_id, slug)
);

-- One logical project name per team (case/whitespace-insensitive); other teams may reuse it.
create unique index projects_team_name_key
  on public.projects (team_id, lower(btrim(name)));

create index projects_created_by_idx on public.projects (created_by);

create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- Lifecycle: DRAFT -> ACTIVE, DRAFT -> ARCHIVED, ACTIVE -> ARCHIVED, ARCHIVED -> ACTIVE.
-- Everything else (ACTIVE -> DRAFT, ARCHIVED -> DRAFT) is rejected. Same-status updates are no-ops.
-- SECURITY INVOKER: pure validation, needs no privileges.
create or replace function public.enforce_project_status_transition()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not (
    (old.status = 'DRAFT'    and new.status in ('ACTIVE', 'ARCHIVED')) or
    (old.status = 'ACTIVE'   and new.status = 'ARCHIVED') or
    (old.status = 'ARCHIVED' and new.status = 'ACTIVE')
  ) then
    raise exception 'Invalid project status transition: % -> %', old.status, new.status
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger projects_enforce_status_transition
  before update of status on public.projects
  for each row
  when (old.status is distinct from new.status)
  execute function public.enforce_project_status_transition();

alter table public.projects enable row level security;

-- SELECT: OWNER/ADMIN of the project's organization, OR a member of the project's team.
-- The joined `teams`/`departments` rows are themselves RLS-filtered to organization members,
-- so a user outside the organization can never satisfy either branch.
create policy "projects_select_admin_or_team_member"
  on public.projects for select
  to authenticated
  using (exists (
    select 1
    from public.teams t
    join public.departments d on d.id = t.department_id
    where t.id = projects.team_id
      and (
        public.has_org_role(d.organization_id, array['OWNER', 'ADMIN'])
        or exists (
          select 1 from public.team_members tm
          where tm.team_id = t.id
            and tm.user_id = (select auth.uid())
        )
      )
  ));

-- INSERT: OWNER/ADMIN only, as themselves, and always as DRAFT.
create policy "projects_insert_admin"
  on public.projects for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and status = 'DRAFT'
    and exists (
      select 1
      from public.teams t
      join public.departments d on d.id = t.department_id
      where t.id = projects.team_id
        and public.has_org_role(d.organization_id, array['OWNER', 'ADMIN'])
    )
  );

create policy "projects_update_admin"
  on public.projects for update
  to authenticated
  using (exists (
    select 1
    from public.teams t
    join public.departments d on d.id = t.department_id
    where t.id = projects.team_id
      and public.has_org_role(d.organization_id, array['OWNER', 'ADMIN'])
  ))
  with check (exists (
    select 1
    from public.teams t
    join public.departments d on d.id = t.department_id
    where t.id = projects.team_id
      and public.has_org_role(d.organization_id, array['OWNER', 'ADMIN'])
  ));

create policy "projects_delete_admin"
  on public.projects for delete
  to authenticated
  using (exists (
    select 1
    from public.teams t
    join public.departments d on d.id = t.department_id
    where t.id = projects.team_id
      and public.has_org_role(d.organization_id, array['OWNER', 'ADMIN'])
  ));

-- Privileges: deny by default, then grant only what clients need.
-- team_id (no transfer between teams), slug, project_type, created_by and id are immutable for clients.
revoke all on public.projects from anon, authenticated;
grant select on public.projects to authenticated;
grant insert (team_id, name, slug, description, project_type, status, created_by) on public.projects to authenticated;
grant update (name, description, status) on public.projects to authenticated;
grant delete on public.projects to authenticated;

-- Project creation with slug generation. SECURITY INVOKER: the insert policy above is the
-- authorization boundary, so a forged team id is rejected by RLS (42501). Always creates a DRAFT.
create or replace function public.create_project(
  p_team_id      uuid,
  p_name         text,
  p_description  text default null,
  p_project_type text default 'GREENFIELD'
)
returns table (
  id uuid, team_id uuid, name text, slug text, description text, project_type text, status text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id    uuid := (select auth.uid());
  v_name       text := btrim(p_name);
  v_desc       text := nullif(btrim(p_description), '');
  v_base       text;
  v_slug       text;
  v_id         uuid;
  v_constraint text;
  v_attempt    int := 0;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if v_name is null or char_length(v_name) not between 1 and 150 then
    raise exception 'Project name must be 1-150 characters' using errcode = '22023';
  end if;

  v_base := public.slugify(v_name, 'project');
  v_slug := v_base;

  loop
    begin
      insert into public.projects as p (team_id, name, slug, description, project_type, status, created_by)
      values (p_team_id, v_name, v_slug, v_desc, p_project_type, 'DRAFT', v_user_id)
      returning p.id into v_id;
      exit;
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint is distinct from 'projects_team_slug_key' then
        raise exception 'A project with this name already exists' using errcode = '23505';
      end if;
      v_attempt := v_attempt + 1;
      if v_attempt > 5 then
        raise exception 'Could not allocate a unique slug' using errcode = '23505';
      end if;
      v_slug := v_base || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 6);
    end;
  end loop;

  return query
    select p.id, p.team_id, p.name, p.slug, p.description, p.project_type, p.status
    from public.projects p
    where p.id = v_id;
end;
$$;

revoke all on function public.create_project(uuid, text, text, text) from public, anon;
grant execute on function public.create_project(uuid, text, text, text) to authenticated;
