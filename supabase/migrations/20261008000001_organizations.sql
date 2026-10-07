-- Phase 2A: organizations and organization membership.
-- Tenant boundary: every later tenant table will key its RLS off organization membership.

create table public.organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(btrim(name)) between 1 and 100),
  slug       text not null unique check (
               char_length(slug) between 1 and 63
               and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
             ),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index organizations_created_by_idx on public.organizations (created_by);

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

create table public.organization_members (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  role            text not null check (role in ('OWNER', 'ADMIN', 'MEMBER')),
  created_at      timestamptz not null default now(),
  constraint organization_members_org_user_key unique (organization_id, user_id)
);

-- (organization_id, user_id) is covered by the unique constraint; this serves "my organizations".
create index organization_members_user_id_idx on public.organization_members (user_id);

-- RLS helpers. SECURITY DEFINER bypasses RLS inside the function, which is what
-- prevents infinite recursion when a policy on organization_members needs to
-- look at organization_members. They only ever answer about auth.uid().
create or replace function public.is_org_member(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = p_org_id
      and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.has_org_role(p_org_id uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = p_org_id
      and m.user_id = (select auth.uid())
      and m.role = any (p_roles)
  );
$$;

revoke all on function public.is_org_member(uuid) from public, anon;
revoke all on function public.has_org_role(uuid, text[]) from public, anon;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.has_org_role(uuid, text[]) to authenticated;

-- Row Level Security: deny by default.
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;

-- Organizations: visible to members only.
create policy "organizations_select_member"
  on public.organizations for select
  to authenticated
  using (public.is_org_member(id));

-- Owners and admins may rename; only owners may delete.
create policy "organizations_update_admin"
  on public.organizations for update
  to authenticated
  using (public.has_org_role(id, array['OWNER', 'ADMIN']))
  with check (public.has_org_role(id, array['OWNER', 'ADMIN']));

create policy "organizations_delete_owner"
  on public.organizations for delete
  to authenticated
  using (public.has_org_role(id, array['OWNER']));

-- Members: visible to members of the same organization.
-- No insert/update/delete policies yet: membership changes arrive with invitations in a later phase.
create policy "organization_members_select_member"
  on public.organization_members for select
  to authenticated
  using (public.is_org_member(organization_id));

-- Table privileges: clients cannot insert organizations or touch membership directly.
-- Creation goes through create_organization(), which is the only way to get an OWNER row.
revoke all on public.organizations, public.organization_members from anon, authenticated;
grant select on public.organizations, public.organization_members to authenticated;
grant update (name) on public.organizations to authenticated;
grant delete on public.organizations to authenticated;

-- Atomic creation: organization + OWNER membership in one transaction, for the caller only.
create or replace function public.create_organization(p_name text)
returns table (id uuid, name text, slug text, role text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_name    text := btrim(p_name);
  v_base    text;
  v_slug    text;
  v_org_id  uuid;
  v_attempt int := 0;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if v_name is null or char_length(v_name) not between 1 and 100 then
    raise exception 'Organization name must be 1-100 characters' using errcode = '22023';
  end if;

  v_base := left(btrim(regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'), '-'), 48);
  if v_base = '' then
    v_base := 'org';
  end if;
  v_slug := v_base;

  loop
    begin
      insert into public.organizations as o (name, slug, created_by)
      values (v_name, v_slug, v_user_id)
      returning o.id into v_org_id;
      exit;
    exception when unique_violation then
      v_attempt := v_attempt + 1;
      if v_attempt > 5 then
        raise exception 'Could not allocate a unique slug' using errcode = '23505';
      end if;
      v_slug := v_base || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 6);
    end;
  end loop;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_org_id, v_user_id, 'OWNER');

  return query select v_org_id, v_name, v_slug, 'OWNER'::text;
end;
$$;

revoke all on function public.create_organization(text) from public, anon;
grant execute on function public.create_organization(text) to authenticated;
