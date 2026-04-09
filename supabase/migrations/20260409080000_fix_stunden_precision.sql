-- Fix stunden precision: NUMERIC(5,2) -> NUMERIC(7,3)
-- 9.625h (9h 37min 30s) was rounded to 9.63 with only 2 decimal places
-- This caused phantom ZA overtime of 0.005h/day

ALTER TABLE public.time_entries ALTER COLUMN stunden TYPE NUMERIC(7,3);
ALTER TABLE public.disturbances ALTER COLUMN stunden TYPE NUMERIC(7,3);
