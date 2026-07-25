-- Migration to add question_text column to Answer_Keys table
-- Run this to update existing databases

ALTER TABLE answer_keys ADD COLUMN IF NOT EXISTS question_text TEXT;
