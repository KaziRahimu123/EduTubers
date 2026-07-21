-- Migration: add generate_images column to courses
-- Run in: Supabase Dashboard → SQL Editor → New query → Run

alter table public.courses
  add column if not exists generate_images boolean default null;
