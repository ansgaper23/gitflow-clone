-- Ejecuta esto en el SQL Editor de Supabase (tu proyecto de GitFlow).
-- Permite que la IA proponga subir imágenes al repo (GitHub) o a Supabase Storage,
-- con el mismo flujo de aprobación manual que el resto de cambios.

create table if not exists proposed_asset_changes (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  repo_full_name text not null,
  target text not null check (target in ('github', 'storage')),
  path text not null,
  bucket text,
  filename text not null,
  mime_type text not null,
  size_bytes integer not null,
  file_base64 text not null,
  summary text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'applied')),
  result text,
  commit_url text,
  public_url text,
  created_at timestamptz not null default now()
);

create index if not exists idx_asset_changes_conversation on proposed_asset_changes(conversation_id);
