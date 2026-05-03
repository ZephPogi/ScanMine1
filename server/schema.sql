-- PostgreSQL Schema for ScanMine

CREATE TABLE IF NOT EXISTS Users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('teacher', 'student')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Classes (
    id SERIAL PRIMARY KEY,
    teacher_id INTEGER REFERENCES Users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    subject VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Students (
    id SERIAL PRIMARY KEY,
    class_id INTEGER REFERENCES Classes(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES Users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(class_id, user_id)
);

CREATE TABLE IF NOT EXISTS Exams (
    id SERIAL PRIMARY KEY,
    class_id INTEGER REFERENCES Classes(id) ON DELETE CASCADE,
    teacher_id INTEGER REFERENCES Users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    raw_text_content TEXT,
    file_path TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Rules (
    id SERIAL PRIMARY KEY,
    rule_name VARCHAR(255) NOT NULL,
    description TEXT,
    keyword VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Generated_Questions (
    id SERIAL PRIMARY KEY,
    exam_id INTEGER REFERENCES Exams(id) ON DELETE CASCADE,
    rule_id INTEGER REFERENCES Rules(id) ON DELETE SET NULL,
    question_text TEXT NOT NULL,
    correct_answer TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Answer_Keys (
    id SERIAL PRIMARY KEY,
    exam_id INTEGER REFERENCES Exams(id) ON DELETE CASCADE,
    answer_text TEXT NOT NULL,
    question_text TEXT,
    image_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Student_Submissions (
    id SERIAL PRIMARY KEY,
    student_id INTEGER REFERENCES Users(id) ON DELETE CASCADE,
    exam_id INTEGER REFERENCES Exams(id) ON DELETE CASCADE,
    extracted_text TEXT,
    score NUMERIC(5,2),
    feedback TEXT,
    image_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Password_Resets (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES Users(id) ON DELETE CASCADE,
    token VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert Default Rules
INSERT INTO Rules (rule_name, description, keyword) VALUES 
('Definition Rule', 'If a sentence has "is defined as", make it a question.', 'is defined as'),
('Importance Rule', 'If a sentence has "is important because", make it a question.', 'is important because')
ON CONFLICT DO NOTHING;
