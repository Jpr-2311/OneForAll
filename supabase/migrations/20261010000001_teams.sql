-- Phase 2C: teams and team membership.
-- A team belongs to exactly one department; the organization is derived (team -> department -> organization),
-- so teams carry no organization_id. Authorization reuses has_org_role() from Phase 2A.
-- No new security-definer functions: policies read `departments`, `department_members` and
-- `organization_members` under the caller's own RLS, which is sufficient because only organization
-- members (and, for writes, OWNER/ADMIN) can pass those reads. No policy on `departments` or
-- `department_members` references `teams`/`team_members`, so there is no recursion.

create table public.teams (
  id            uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments (id) on delete cascade,
  name          text not null check (char_length(btrim(name)) between 1 and 100),
  slug          text not null check (
                  char_length(slug) between 1 and 63
                  and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
                ),
  description   text check (char_length(description) <= 500),
  created_by    uuid not null references auth.users (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint teams_department_slug_key unique (department_id, slug)
);

-- One logical team name per department (case/whitespace-insensitive); other departments may reuse it.
create unique index teams_department_name_key
  on public.teams (department_id, lower(btrim(name)));

create index teams_created_by_idx on public.teams (created_by);

create trigger teams_set_updated_at
  before update on public.teams
  for each row execute function public.set_updated_at();

create table public.team_members (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint team_members_team_user_key unique (team_id, user_id)
);

-- (team_id, user_id) is covered by the unique constraint; this serves "my teams".
create index team_members_user_id_idx on public.team_members (user_id);

alter table public.teams enable row level security;
alter table public.team_members enable row level security;

-- Teams ---------------------------------------------------------------------

-- Visible exactly when the parent department is visible (departments RLS limits it to org members).
create policy "teams_select_org_member"
  on public.teams for select
  to authenticated
  using (exists (
    select 1 from public.departments d where d.id = teams.department_id
  ));

create policy "teams_insert_admin"
  on public.teams for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and exists (
      select 1 from public.departments d
      where d.id = teams.department_id
        and public.has_org_role(d.organization_id, array['OWNER', 'ADMIN'])
    )
  );

create policy "teams_update_admin"
  on public.teams for update
  to authenticated
  using (exists (
    select 1 from public.departments d
    where d.id = teams.department_id
      and public.has_org_role(d.organization_id, array['OWNER', 'ADMIN'])
  ))
  with check (exists (
    select 1 from public.departments d
    where d.id = teams.department_id
      and public.has_org_role(d.organization_id, array['OWNER', 'ADMIN'])
  ));

create policy "teams_delete_admin"
  on public.teams for delete
  to authenticated
  using (exists (
    select 1 from public.departments d
    where d.id = teams.department_id
      and public.has_org_role(d.organization_id, array['OWNER', 'ADMIN'])
  ));

-- Team members --------------------------------------------------------------

-- Visible exactly when the team is visible.
create policy "team_members_select_org_member"
  on public.team_members for select
  to authenticated
  using (exists (
    select 1 from public.teams t where t.id = team_members.team_id
  ));

-- OWNER/ADMIN of the team's organization may add a user who belongs to BOTH the organization
-- and the team's department (User -> Organization -> Department -> Team).
create policy "team_members_insert_admin"
  on public.team_members for insert
  to authenticated
  with check (exists (
    select 1
    from public.teams t
    join public.departments d on d.id = t.department_id
    where t.id = team_members.team_id
      and public.has_org_role(d.organization_id, array['OWNER', 'ADMIN'])
      and exists (
        select 1 from public.organization_members om
        where om.organization_id = d.organization_id
          and om.user_id = team_members.user_id
      )
      and exists (
        select 1 from public.department_members dm
        where dm.department_id = d.id
          and dm.user_id = team_members.user_id
      )
  ));

create policy "team_members_delete_admin"
  on public.team_members for delete
  to authenticated
  using (exists (
    select 1
    from public.teams t
    join public.departments d on d.id = t.department_id
    where t.id = team_members.team_id
      and public.has_org_role(d.organization_id, array['OWNER', 'ADMIN'])
  ));

-- Privileges: deny by default, then grant only what clients need.
-- department_id (a team cannot be moved), created_by and ids are immutable for clients;
-- membership rows have no UPDATE.
revoke all on public.teams, public.team_members from anon, authenticated;
grant select on public.teams, public.team_members to authenticated;
grant insert (department_id, name, slug, description, created_by) on public.teams to authenticated;
grant update (name, description) on public.teams to authenticated;
grant delete on public.teams to authenticated;
grant insert (team_id, user_id) on public.team_members to authenticated;
grant delete on public.team_members to authenticated;

-- Keep the hierarchy invariant when someone leaves a department: their memberships in that
-- department's teams go with it. SECURITY INVOKER on purpose: the caller (an OWNER/ADMIN removing
-- the department member) already has DELETE on team_members through the policy above, so no
-- privilege escalation is needed, and the trigger cannot remove memberships the caller could not.
create or replace function public.remove_team_memberships_on_department_leave()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.team_members tm
  using public.teams t
  where tm.team_id = t.id
    and t.department_id = old.department_id
    and tm.user_id = old.user_id;
  return old;
end;
$$;

create trigger department_members_remove_team_memberships
  after delete on public.department_members
  for each row execute function public.remove_team_memberships_on_department_leave();

-- Team creation with slug generation. SECURITY INVOKER: the insert policy above is the
-- authorization boundary, so a forged department id is rejected by RLS (42501).
create or replace function public.create_team(
  p_department_id uuid,
  p_name          text,
  p_description   text default null
)
returns table (id uuid, department_id uuid, name text, slug text, description text)
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

  if v_name is null or char_length(v_name) not between 1 and 100 then
    raise exception 'Team name must be 1-100 characters' using errcode = '22023';
  end if;

  v_base := public.slugify(v_name, 'team');
  v_slug := v_base;

  loop
    begin
      insert into public.teams as t (department_id, name, slug, description, created_by)
      values (p_department_id, v_name, v_slug, v_desc, v_user_id)
      returning t.id into v_id;
      exit;
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint is distinct from 'teams_department_slug_key' then
        raise exception 'A team with this name already exists' using errcode = '23505';
      end if;
      v_attempt := v_attempt + 1;
      if v_attempt > 5 then
        raise exception 'Could not allocate a unique slug' using errcode = '23505';
      end if;
      v_slug := v_base || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 6);
    end;
  end loop;

  return query
    select t.id, t.department_id, t.name, t.slug, t.description
    from public.teams t
    where t.id = v_id;
end;
$$;

revoke all on function public.create_team(uuid, text, text) from public, anon;
grant execute on function public.create_team(uuid, text, text) to authenticated;
