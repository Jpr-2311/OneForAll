-- Phase 2B: departments and department membership.
-- Authorization reuses the Phase 2A helper has_org_role(). No new security-definer helpers:
-- department policies read `departments` / `organization_members` under the caller's own RLS,
-- which is enough because only org members (and for writes, OWNER/ADMIN) can pass those reads.
-- No policy on `departments` references `department_members`, so there is no recursion.

-- Pure helper shared by slug-bearing tables (departments now, teams/projects later).
create or replace function public.slugify(p_input text, p_fallback text default 'item')
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    nullif(left(btrim(regexp_replace(lower(p_input), '[^a-z0-9]+', '-', 'g'), '-'), 48), ''),
    p_fallback
  );
$$;

create table public.departments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name            text not null check (char_length(btrim(name)) between 1 and 100),
  slug            text not null check (
                    char_length(slug) between 1 and 63
                    and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
                  ),
  description     text check (char_length(description) <= 500),
  created_by      uuid not null references auth.users (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint departments_org_slug_key unique (organization_id, slug)
);

-- One logical department name per organization (case/whitespace-insensitive), never global.
create unique index departments_org_name_key
  on public.departments (organization_id, lower(btrim(name)));

create index departments_created_by_idx on public.departments (created_by);

create trigger departments_set_updated_at
  before update on public.departments
  for each row execute function public.set_updated_at();

create table public.department_members (
  id            uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  created_at    timestamptz not null default now(),
  constraint department_members_dept_user_key unique (department_id, user_id)
);

-- (department_id, user_id) is covered by the unique constraint; this serves "my departments".
create index department_members_user_id_idx on public.department_members (user_id);

alter table public.departments enable row level security;
alter table public.department_members enable row level security;

-- Departments ---------------------------------------------------------------

create policy "departments_select_org_member"
  on public.departments for select
  to authenticated
  using (public.is_org_member(organization_id));

create policy "departments_insert_admin"
  on public.departments for insert
  to authenticated
  with check (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN'])
    and created_by = (select auth.uid())
  );

create policy "departments_update_admin"
  on public.departments for update
  to authenticated
  using (public.has_org_role(organization_id, array['OWNER', 'ADMIN']))
  with check (public.has_org_role(organization_id, array['OWNER', 'ADMIN']));

create policy "departments_delete_admin"
  on public.departments for delete
  to authenticated
  using (public.has_org_role(organization_id, array['OWNER', 'ADMIN']));

-- Department members --------------------------------------------------------

-- Visible exactly when the department is visible (departments RLS limits it to org members).
create policy "department_members_select_org_member"
  on public.department_members for select
  to authenticated
  using (exists (
    select 1 from public.departments d where d.id = department_members.department_id
  ));

-- OWNER/ADMIN of the department's organization may add a user who belongs to the SAME organization.
create policy "department_members_insert_admin"
  on public.department_members for insert
  to authenticated
  with check (
    exists (
      select 1 from public.departments d
      where d.id = department_members.department_id
        and public.has_org_role(d.organization_id, array['OWNER', 'ADMIN'])
        and exists (
          select 1 from public.organization_members om
          where om.organization_id = d.organization_id
            and om.user_id = department_members.user_id
        )
    )
  );

create policy "department_members_delete_admin"
  on public.department_members for delete
  to authenticated
  using (exists (
    select 1 from public.departments d
    where d.id = department_members.department_id
      and public.has_org_role(d.organization_id, array['OWNER', 'ADMIN'])
  ));

-- Privileges: deny by default, then grant only what clients need.
-- organization_id, slug, created_by and ids are immutable for clients; membership rows have no UPDATE.
revoke all on public.departments, public.department_members from anon, authenticated;
grant select on public.departments, public.department_members to authenticated;
grant insert (organization_id, name, slug, description, created_by) on public.departments to authenticated;
grant update (name, description) on public.departments to authenticated;
grant delete on public.departments to authenticated;
grant insert (department_id, user_id) on public.department_members to authenticated;
grant delete on public.department_members to authenticated;

-- Department creation with slug generation. SECURITY INVOKER: the insert policy above
-- is the authorization boundary, so a forged organization id is rejected by RLS (42501).
create or replace function public.create_department(
  p_organization_id uuid,
  p_name            text,
  p_description     text default null
)
returns table (id uuid, organization_id uuid, name text, slug text, description text)
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
    raise exception 'Department name must be 1-100 characters' using errcode = '22023';
  end if;

  v_base := public.slugify(v_name, 'department');
  v_slug := v_base;

  loop
    begin
      insert into public.departments as d (organization_id, name, slug, description, created_by)
      values (p_organization_id, v_name, v_slug, v_desc, v_user_id)
      returning d.id into v_id;
      exit;
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint is distinct from 'departments_org_slug_key' then
        raise exception 'A department with this name already exists' using errcode = '23505';
      end if;
      v_attempt := v_attempt + 1;
      if v_attempt > 5 then
        raise exception 'Could not allocate a unique slug' using errcode = '23505';
      end if;
      v_slug := v_base || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 6);
    end;
  end loop;

  return query
    select d.id, d.organization_id, d.name, d.slug, d.description
    from public.departments d
    where d.id = v_id;
end;
$$;

revoke all on function public.create_department(uuid, text, text) from public, anon;
grant execute on function public.create_department(uuid, text, text) to authenticated;
