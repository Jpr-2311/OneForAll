-- Phase 2E: requirements and tasks.
-- Ownership is derived through the existing hierarchy only:
--   task -> requirement -> project -> team -> department -> organization
-- so neither table carries an organization/department/team/project shortcut column, and a task can
-- never exist without a requirement.
--
-- Authorization reuses Phase 2A's has_org_role() and the existing project visibility rule:
--   * READ  : whoever can see the parent. Requirements read `projects`, tasks read `requirements`, each
--             under the caller's own RLS, so "can see the project" (OWNER/ADMIN or team member) stays the
--             single source of truth.
--   * WRITE : OWNER/ADMIN of the derived organization.
-- No new security-definer functions. No policy on projects/teams/departments references these tables,
-- so there is no recursion.

-- Requirements --------------------------------------------------------------

create table public.requirements (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  title       text not null check (char_length(btrim(title)) between 1 and 200),
  description text check (char_length(description) <= 2000),
  status      text not null default 'DRAFT'
              check (status in ('DRAFT', 'READY', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  priority    text not null default 'MEDIUM'
              check (priority in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  created_by  uuid not null references auth.users (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index requirements_project_id_idx on public.requirements (project_id);
create index requirements_created_by_idx on public.requirements (created_by);
create index requirements_status_idx     on public.requirements (status);
create index requirements_priority_idx   on public.requirements (priority);

create trigger requirements_set_updated_at
  before update on public.requirements
  for each row execute function public.set_updated_at();

-- Lifecycle: DRAFT -> READY | CANCELLED; READY -> IN_PROGRESS | CANCELLED;
-- IN_PROGRESS -> COMPLETED | CANCELLED; COMPLETED -> IN_PROGRESS; CANCELLED -> DRAFT.
-- Everything else is rejected; same-status updates are no-ops (the trigger only fires on a change).
-- SECURITY INVOKER: pure validation, needs no privileges.
create or replace function public.enforce_requirement_status_transition()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not (
    (old.status = 'DRAFT'       and new.status in ('READY', 'CANCELLED')) or
    (old.status = 'READY'       and new.status in ('IN_PROGRESS', 'CANCELLED')) or
    (old.status = 'IN_PROGRESS' and new.status in ('COMPLETED', 'CANCELLED')) or
    (old.status = 'COMPLETED'   and new.status = 'IN_PROGRESS') or
    (old.status = 'CANCELLED'   and new.status = 'DRAFT')
  ) then
    raise exception 'Invalid requirement status transition: % -> %', old.status, new.status
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger requirements_enforce_status_transition
  before update of status on public.requirements
  for each row
  when (old.status is distinct from new.status)
  execute function public.enforce_requirement_status_transition();

alter table public.requirements enable row level security;

-- SELECT: exactly when the parent project is visible (projects RLS: OWNER/ADMIN or team member).
create policy "requirements_select_project_visible"
  on public.requirements for select
  to authenticated
  using (exists (
    select 1 from public.projects p where p.id = requirements.project_id
  ));

-- INSERT: OWNER/ADMIN of the project's organization, as themselves, and always as DRAFT.
create policy "requirements_insert_admin"
  on public.requirements for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and status = 'DRAFT'
    and exists (
      select 1
      from public.projects p
      join public.teams t on t.id = p.team_id
      join public.departments d on d.id = t.department_id
      where p.id = requirements.project_id
        and public.has_org_role(d.organization_id, array['OWNER', 'ADMIN'])
    )
  );

create policy "requirements_update_admin"
  on public.requirements for update
  to authenticated
  using (exists (
    select 1
    from public.projects p
    join public.teams t on t.id = p.team_id
    join public.departments d on d.id = t.department_id
    where p.id = requirements.project_id
      and public.has_org_role(d.organization_id, array['OWNER', 'ADMIN'])
  ))
  with check (exists (
    select 1
    from public.projects p
    join public.teams t on t.id = p.team_id
    join public.departments d on d.id = t.department_id
    where p.id = requirements.project_id
      and public.has_org_role(d.organization_id, array['OWNER', 'ADMIN'])
  ));

create policy "requirements_delete_admin"
  on public.requirements for delete
  to authenticated
  using (exists (
    select 1
    from public.projects p
    join public.teams t on t.id = p.team_id
    join public.departments d on d.id = t.department_id
    where p.id = requirements.project_id
      and public.has_org_role(d.organization_id, array['OWNER', 'ADMIN'])
  ));

-- Privileges: deny by default, then grant only what clients need.
-- id, project_id, created_by and created_at are immutable for clients.
revoke all on public.requirements from anon, authenticated;
grant select on public.requirements to authenticated;
grant insert (project_id, title, description, status, priority, created_by) on public.requirements to authenticated;
grant update (title, description, status, priority) on public.requirements to authenticated;
grant delete on public.requirements to authenticated;

-- Tasks ---------------------------------------------------------------------

create table public.tasks (
  id             uuid primary key default gen_random_uuid(),
  requirement_id uuid not null references public.requirements (id) on delete cascade,
  title          text not null check (char_length(btrim(title)) between 1 and 200),
  description    text check (char_length(description) <= 2000),
  status         text not null default 'TODO'
                 check (status in ('TODO', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  priority       text not null default 'MEDIUM'
                 check (priority in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  created_by     uuid not null references auth.users (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index tasks_requirement_id_idx on public.tasks (requirement_id);
create index tasks_created_by_idx     on public.tasks (created_by);
create index tasks_status_idx         on public.tasks (status);
create index tasks_priority_idx       on public.tasks (priority);

create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

-- Lifecycle: TODO -> IN_PROGRESS | CANCELLED; IN_PROGRESS -> COMPLETED | TODO | CANCELLED;
-- COMPLETED -> IN_PROGRESS; CANCELLED -> TODO. Everything else is rejected.
create or replace function public.enforce_task_status_transition()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not (
    (old.status = 'TODO'        and new.status in ('IN_PROGRESS', 'CANCELLED')) or
    (old.status = 'IN_PROGRESS' and new.status in ('COMPLETED', 'TODO', 'CANCELLED')) or
    (old.status = 'COMPLETED'   and new.status = 'IN_PROGRESS') or
    (old.status = 'CANCELLED'   and new.status = 'TODO')
  ) then
    raise exception 'Invalid task status transition: % -> %', old.status, new.status
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger tasks_enforce_status_transition
  before update of status on public.tasks
  for each row
  when (old.status is distinct from new.status)
  execute function public.enforce_task_status_transition();

alter table public.tasks enable row level security;

-- SELECT: exactly when the parent requirement is visible (which in turn requires the project to be visible).
create policy "tasks_select_requirement_visible"
  on public.tasks for select
  to authenticated
  using (exists (
    select 1 from public.requirements r where r.id = tasks.requirement_id
  ));

create policy "tasks_insert_admin"
  on public.tasks for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and status = 'TODO'
    and exists (
      select 1
      from public.requirements r
      join public.projects p on p.id = r.project_id
      join public.teams t on t.id = p.team_id
      join public.departments d on d.id = t.department_id
      where r.id = tasks.requirement_id
        and public.has_org_role(d.organization_id, array['OWNER', 'ADMIN'])
    )
  );

create policy "tasks_update_admin"
  on public.tasks for update
  to authenticated
  using (exists (
    select 1
    from public.requirements r
    join public.projects p on p.id = r.project_id
    join public.teams t on t.id = p.team_id
    join public.departments d on d.id = t.department_id
    where r.id = tasks.requirement_id
      and public.has_org_role(d.organization_id, array['OWNER', 'ADMIN'])
  ))
  with check (exists (
    select 1
    from public.requirements r
    join public.projects p on p.id = r.project_id
    join public.teams t on t.id = p.team_id
    join public.departments d on d.id = t.department_id
    where r.id = tasks.requirement_id
      and public.has_org_role(d.organization_id, array['OWNER', 'ADMIN'])
  ));

create policy "tasks_delete_admin"
  on public.tasks for delete
  to authenticated
  using (exists (
    select 1
    from public.requirements r
    join public.projects p on p.id = r.project_id
    join public.teams t on t.id = p.team_id
    join public.departments d on d.id = t.department_id
    where r.id = tasks.requirement_id
      and public.has_org_role(d.organization_id, array['OWNER', 'ADMIN'])
  ));

-- id, requirement_id, created_by and created_at are immutable for clients.
revoke all on public.tasks from anon, authenticated;
grant select on public.tasks to authenticated;
grant insert (requirement_id, title, description, status, priority, created_by) on public.tasks to authenticated;
grant update (title, description, status, priority) on public.tasks to authenticated;
grant delete on public.tasks to authenticated;

-- Creation RPCs ---------------------------------------------------------------
-- SECURITY INVOKER: the insert policies above are the authorization boundary, so a forged parent id is
-- rejected by RLS (42501). Identity comes from auth.uid(); created_by is never accepted from the caller.

create or replace function public.create_requirement(
  p_project_id  uuid,
  p_title       text,
  p_description text default null,
  p_priority    text default 'MEDIUM'
)
returns table (id uuid, project_id uuid, title text, description text, status text, priority text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_title   text := btrim(p_title);
  v_desc    text := nullif(btrim(p_description), '');
  v_id      uuid;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if v_title is null or char_length(v_title) not between 1 and 200 then
    raise exception 'Requirement title must be 1-200 characters' using errcode = '22023';
  end if;

  insert into public.requirements as r (project_id, title, description, status, priority, created_by)
  values (p_project_id, v_title, v_desc, 'DRAFT', p_priority, v_user_id)
  returning r.id into v_id;

  return query
    select r.id, r.project_id, r.title, r.description, r.status, r.priority
    from public.requirements r
    where r.id = v_id;
end;
$$;

create or replace function public.create_task(
  p_requirement_id uuid,
  p_title          text,
  p_description    text default null,
  p_priority       text default 'MEDIUM'
)
returns table (id uuid, requirement_id uuid, title text, description text, status text, priority text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_title   text := btrim(p_title);
  v_desc    text := nullif(btrim(p_description), '');
  v_id      uuid;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if v_title is null or char_length(v_title) not between 1 and 200 then
    raise exception 'Task title must be 1-200 characters' using errcode = '22023';
  end if;

  insert into public.tasks as k (requirement_id, title, description, status, priority, created_by)
  values (p_requirement_id, v_title, v_desc, 'TODO', p_priority, v_user_id)
  returning k.id into v_id;

  return query
    select k.id, k.requirement_id, k.title, k.description, k.status, k.priority
    from public.tasks k
    where k.id = v_id;
end;
$$;

revoke all on function public.create_requirement(uuid, text, text, text) from public, anon;
grant execute on function public.create_requirement(uuid, text, text, text) to authenticated;
revoke all on function public.create_task(uuid, text, text, text) from public, anon;
grant execute on function public.create_task(uuid, text, text, text) to authenticated;
