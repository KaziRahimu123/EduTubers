-- Migration: add task_config column to courses table
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run
--
-- This adds the task_config column required by the Practice Tasks feature.

alter table public.courses
  add column if not exists task_config jsonb;
