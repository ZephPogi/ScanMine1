-- Migration to add image_url columns for Supabase storage integration

-- Add image_url to Exams table (for lesson files)
ALTER TABLE Exams ADD COLUMN IF NOT EXISTS file_path TEXT;

-- Add image_url to Answer_Keys table (for answer key images)
ALTER TABLE Answer_Keys ADD COLUMN IF NOT EXISTS image_url TEXT;

-- Add image_url to Student_Submissions table (for student paper images)
ALTER TABLE Student_Submissions ADD COLUMN IF NOT EXISTS image_url TEXT;
