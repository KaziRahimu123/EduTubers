-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: drop overloaded uuid-typed quota functions
--
-- The add_quota_and_security.sql migration created these functions with
-- p_user_id uuid. The add_brand_kit_and_fix_quota.sql migration added text
-- versions, leaving both in the database. PostgREST (PGRST203) cannot resolve
-- the overload when called via REST. This migration drops the old uuid versions
-- so only the text versions remain.
-- ═══════════════════════════════════════════════════════════════════════════════

drop function if exists public.increment_gen_quota(p_user_id uuid);
drop function if exists public.count_gen_quota_3days(p_user_id uuid);
drop function if exists public.record_pro_usage(p_user_id uuid);
drop function if exists public.count_pro_usage_3days(p_user_id uuid);
