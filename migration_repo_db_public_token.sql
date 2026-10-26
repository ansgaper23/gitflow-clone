alter table repo_db_connections add column if not exists public_token text unique;
