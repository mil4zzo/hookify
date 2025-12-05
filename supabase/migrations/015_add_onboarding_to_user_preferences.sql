-- Migration: Add onboarding fields to user_preferences
-- Safe to run multiple times

alter table public.user_preferences
  add column if not exists has_completed_onboarding boolean default false;

-- Column used by frontend hooks to store structured validation rules.
-- Some environments may already have this column; guard with IF NOT EXISTS.
alter table public.user_preferences
  add column if not exists validation_criteria jsonb;



