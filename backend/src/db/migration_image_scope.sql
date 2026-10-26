alter table ai_accounts drop constraint if exists ai_accounts_scope_check;
alter table ai_accounts add constraint ai_accounts_scope_check check (scope in ('agent', 'app', 'image'));
