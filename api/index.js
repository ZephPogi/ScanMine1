const path = require('path');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const db = require('./db');

// Only load dotenv in local development. 
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

// Fixed import for Vercel Linux compatibility
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const { extractText, generateQuizFromText } = require('./scripts/generateQuestions');
const { gradeSubmission } = require('./scripts/autoGradeSubmission');
const OCRSpaceService = require('./scripts/ocrSpaceService');
const { parseFullQuestions } = require('./scripts/ocrAnswerParser');
const { uploadFile, deleteFile } = require('./supabaseClient');
const { BUCKET_NAME } = require('./supabaseClient');

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// ── Idempotent migration: add 'status' column to Students if missing ──────
(async () => {
  try {
    await db.query(`
      ALTER TABLE Students
      ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'pending'
    `);
    console.log('Migration OK: Students.status column ready');
  } catch (err) {
    console.error('Migration warning:', err.message);
  }
})();

// ── Idempotent migration: add 'supabase_id' column to Users if missing ────
// This UUID links the PostgreSQL profile row to the Supabase Auth user,
// enabling password reset emails and Supabase session management.
(async () => {
  try {
    await db.query(`
      ALTER TABLE Users
      ADD COLUMN IF NOT EXISTS supabase_id UUID UNIQUE
    `);
    console.log('Migration OK: Users.supabase_id column ready');
  } catch (err) {
    console.error('Migration warning (supabase_id):', err.message);
  }
})();

// ── Idempotent migration: make password_hash nullable ─────────────────────
// New users registered via Supabase Auth don't have a local password hash;
// Supabase owns the credential. Existing users are unaffected.
(async () => {
  try {
    await db.query(`
      ALTER TABLE Users
      ALTER COLUMN password_hash DROP NOT NULL
    `);
    console.log('Migration OK: Users.password_hash is now nullable');
  } catch (err) {
    // Postgres throws if the column is already nullable — that's fine.
    console.log('Migration note (password_hash):', err.message);
  }
})();


const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|bmp|tiff|webp|pdf/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) return cb(null, true);
    cb(new Error('Only image files and PDFs are allowed'));
  }
});

// --- AUTHENTICATION ---
app.post('/api/register', async (req, res) => {
  try {
    const { supabaseId, name, email, role } = req.body;

    if (!name || !email || !role) {
      return res.status(400).json({ error: 'Missing required fields: name, email, role' });
    }

    let result;

    if (supabaseId) {
      // ── New flow: Supabase Auth manages the password ──────────────────────
      // We insert the profile using the Supabase UUID as the primary key so
      // both systems reference the same user ID. The id column must accept
      // UUIDs — if it's currently SERIAL/integer, see note below.
      //
      // NOTE: If your Users table uses a SERIAL integer id, you may need to
      // run this migration in Supabase SQL editor first:
      //   ALTER TABLE Users ADD COLUMN IF NOT EXISTS supabase_id UUID UNIQUE;
      //   UPDATE Users SET supabase_id = gen_random_uuid() WHERE supabase_id IS NULL;
      //
      // For new projects, change the id column to UUID:
      //   ALTER TABLE Users ALTER COLUMN id TYPE UUID USING id::text::uuid;
      //
      // For now, we store supabaseId in a separate column if the id is SERIAL:
      result = await db.query(
        `INSERT INTO Users (name, email, role, supabase_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO UPDATE
           SET supabase_id = EXCLUDED.supabase_id,
               name = EXCLUDED.name,
               role = EXCLUDED.role
         RETURNING id, name, email, role, supabase_id`,
        [name, email, role, supabaseId]
      );
    } else {
      // ── Legacy fallback: no Supabase ID provided ──────────────────────────
      const { password } = req.body;
      if (!password) return res.status(400).json({ error: 'Missing password for legacy registration' });
      const hashedPassword = await bcrypt.hash(password, 10);
      result = await db.query(
        'INSERT INTO Users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role',
        [name, email, hashedPassword, role]
      );
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('REGISTRATION ERROR:', error);
    if (error.code === '23505') {
      return res.status(400).json({ error: 'An account with this email already exists.' });
    }
    res.status(500).json({ error: 'Server error during registration' });
  }
});


app.post('/api/login', async (req, res) => {
  try {
    const { email, password, role, isSupabaseAuth } = req.body;
    const result = await db.query('SELECT * FROM Users WHERE email = $1', [email]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'User not found' });
    
    const user = result.rows[0];
    
    // If authenticated via Supabase on the frontend, skip local password check
    if (!isSupabaseAuth) {
      if (!user.password_hash) {
        return res.status(401).json({ error: 'Please use the unified login (Supabase) for this account.' });
      }
      const match = await bcrypt.compare(password, user.password_hash);
      if (!match) return res.status(401).json({ error: 'Invalid password' });
    }
    
    // Role check
    if (user.role !== role) {
       return res.status(401).json({ error: `Account registered as ${user.role}, not ${role}` });
    }
    
    res.json({ id: user.id, name: user.name, role: user.role, email: user.email });
  } catch (error) {
    console.error('LOGIN ERROR:', error);
    res.status(500).json({ error: 'Server error during login' });
  }
});

// --- CLASSES & STUDENTS ---
app.get('/api/classes', async (req, res) => {
  try {
    const { teacherId } = req.query;
    if (!teacherId || teacherId === 'undefined' || teacherId === 'null') return res.json([]);
    const result = await db.query('SELECT * FROM Classes WHERE teacher_id = $1', [teacherId]);
    res.json(result.rows);
  } catch (error) {
    console.error('FETCH CLASSES ERROR:', error);
    res.status(500).json({ error: 'Failed to fetch classes' });
  }
});

app.post('/api/classes', async (req, res) => {
  try {
    const { teacherId, name, subject } = req.body;
    const result = await db.query(
      'INSERT INTO Classes (teacher_id, name, subject) VALUES ($1, $2, $3) RETURNING *',
      [teacherId, name, subject]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error('CREATE CLASS ERROR:', error);
    res.status(500).json({ error: 'Failed to create class' });
  }
});

app.delete('/api/classes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM Classes WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    console.error('DELETE CLASS ERROR:', error);
    res.status(500).json({ error: 'Failed to delete class' });
  }
});

// Kept for backwards-compat; prefer /api/class/invite going forward
app.post('/api/students', async (req, res) => {
  try {
    const { email, classId } = req.body;
    const userRes = await db.query('SELECT id FROM Users WHERE email = $1 AND role = $2', [email, 'student']);
    if (userRes.rows.length === 0) return res.status(404).json({ error: 'No student account found with that email.' });
    const userId = userRes.rows[0].id;
    const result = await db.query(
      "INSERT INTO Students (class_id, user_id, status) VALUES ($1, $2, 'enrolled') RETURNING *",
      [classId, userId]
    );
    res.json({ message: 'Student added successfully', student: result.rows[0] });
  } catch (error) {
    console.error('ADD STUDENT ERROR:', error);
    if (error.code === '23505') return res.status(400).json({ error: 'This student is already in this class.' });
    res.status(500).json({ error: 'Failed to add student to class' });
  }
});

// ── INVITATION SYSTEM ────────────────────────────────────────────────────

// GET /api/students/search?q=...&classId=...
// Returns users (students) matching q by name or email, excluding already-in-class
app.get('/api/students/search', async (req, res) => {
  try {
    const { q, classId } = req.query;
    if (!q || q.trim().length < 2) return res.json([]);
    const search = `%${q.trim().toLowerCase()}%`;
    const query = `
      SELECT u.id, u.name, u.email
      FROM Users u
      WHERE u.role = 'student'
        AND (LOWER(u.name) LIKE $1 OR LOWER(u.email) LIKE $1)
        AND u.id NOT IN (
          SELECT user_id FROM Students WHERE class_id = $2
        )
      LIMIT 10
    `;
    const result = await db.query(query, [search, classId || 0]);
    res.json(result.rows);
  } catch (error) {
    console.error('STUDENT SEARCH ERROR:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// POST /api/class/invite  { classId, userId }
app.post('/api/class/invite', async (req, res) => {
  try {
    const { classId, userId } = req.body;
    if (!classId || !userId) return res.status(400).json({ error: 'Missing classId or userId' });
    const result = await db.query(
      "INSERT INTO Students (class_id, user_id, status) VALUES ($1, $2, 'pending') RETURNING *",
      [classId, userId]
    );
    res.json({ message: 'Invitation sent', student: result.rows[0] });
  } catch (error) {
    console.error('INVITE ERROR:', error);
    if (error.code === '23505') return res.status(400).json({ error: 'This student already has a pending invite or is enrolled.' });
    res.status(500).json({ error: 'Failed to send invite' });
  }
});

// PUT /api/class/accept-invite  { classId, userId }
app.put('/api/class/accept-invite', async (req, res) => {
  try {
    const { classId, userId } = req.body;
    if (!classId || !userId) return res.status(400).json({ error: 'Missing classId or userId' });
    const result = await db.query(
      "UPDATE Students SET status = 'enrolled' WHERE class_id = $1 AND user_id = $2 RETURNING *",
      [classId, userId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Invite not found' });
    res.json({ message: 'Invitation accepted', student: result.rows[0] });
  } catch (error) {
    console.error('ACCEPT INVITE ERROR:', error);
    res.status(500).json({ error: 'Failed to accept invite' });
  }
});

// DELETE /api/class/decline-invite  ?classId=&userId=
// Used for both decline (by student) and kick (by teacher)
app.delete('/api/class/decline-invite', async (req, res) => {
  try {
    const { classId, userId } = req.query;
    if (!classId || !userId) return res.status(400).json({ error: 'Missing classId or userId' });
    const result = await db.query(
      'DELETE FROM Students WHERE class_id = $1 AND user_id = $2 RETURNING *',
      [classId, userId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Enrollment record not found' });
    res.json({ message: 'Student removed from class' });
  } catch (error) {
    console.error('DECLINE/KICK ERROR:', error);
    res.status(500).json({ error: 'Failed to remove student' });
  }
});

app.get('/api/dashboard', async (req, res) => {
  try {
    const teacherId = req.query.teacherId;
    if (!teacherId || teacherId === 'undefined') {
      return res.status(401).json({ error: "Unauthorized or missing teacher ID" });
    }

    const totalStudentsResult = await db.query(
      'SELECT COUNT(DISTINCT s.user_id) FROM Students s JOIN Classes c ON s.class_id = c.id WHERE c.teacher_id = $1',
      [teacherId]
    );

    const quizzesCheckedResult = await db.query(
      'SELECT COUNT(*) FROM Student_Submissions sub JOIN Exams e ON sub.exam_id = e.id WHERE e.teacher_id = $1',
      [teacherId]
    );

    const classAverageResult = await db.query(
      'SELECT COALESCE(AVG(score), 0) as average FROM Student_Submissions sub JOIN Exams e ON sub.exam_id = e.id WHERE e.teacher_id = $1',
      [teacherId]
    );

    const recentActivityResult = await db.query(
      'SELECT u.name as student_name, e.title as subject, sub.score, sub.created_at FROM Student_Submissions sub JOIN Users u ON sub.student_id = u.id JOIN Exams e ON sub.exam_id = e.id WHERE e.teacher_id = $1 ORDER BY sub.created_at DESC LIMIT 5',
      [teacherId]
    );

    const average = parseFloat(classAverageResult.rows[0].average).toFixed(1);

    res.json({
      totalStudents: parseInt(totalStudentsResult.rows[0].count, 10) || 0,
      quizzesChecked: parseInt(quizzesCheckedResult.rows[0].count, 10) || 0,
      classAverage: average,
      recentActivity: recentActivityResult.rows
    });

  } catch (error) {
    console.error('DASHBOARD DATA ERROR:', error);
    res.status(500).json({ error: "Failed to fetch dashboard data" });
  }
});

// --- ADDED ROUTES FOR DASHBOARD FUNCTIONALITY ---
app.get('/api/all-students', async (req, res) => {
  try {
    const result = await db.query("SELECT id, name, email FROM Users WHERE role = 'student'");
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get('/api/exams', async (req, res) => {
  try {
    const { classId } = req.query;
    const result = await db.query('SELECT * FROM Exams WHERE class_id = $1', [classId]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch exams" });
  }
});

app.get('/api/classes/:id/students', async (req, res) => {
  try {
    const query = `
      SELECT Students.id AS enrollment_id, Students.status,
             Users.id AS user_id, Users.name, Users.email
      FROM Students
      JOIN Users ON Students.user_id = Users.id
      WHERE Students.class_id = $1
      ORDER BY Students.status ASC, Users.name ASC;`;
    const result = await db.query(query, [req.params.id]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch class students' });
  }
});

app.get('/api/student-classes', async (req, res) => {
  try {
    const { studentId } = req.query;
    if (!studentId || studentId === 'undefined' || studentId === 'null') return res.json([]);
    const query = `
      SELECT c.*, u.name as professor, s.status
      FROM Classes c
      JOIN Students s ON c.id = s.class_id
      JOIN Users u ON c.teacher_id = u.id
      WHERE s.user_id = $1
      ORDER BY s.status ASC, c.name ASC;
    `;
    const result = await db.query(query, [studentId]);
    res.json(result.rows);
  } catch (error) {
    console.error('FETCH STUDENT CLASSES ERROR:', error);
    res.status(500).json({ error: 'Failed to fetch student classes' });
  }
});

// --- TEACHER: GENERATE QUIZ ---
app.post('/api/generate-quiz', upload.single('lessonFile'), async (req, res) => {
  try {
    const file = req.file;
    // Keys match your frontend FormData
    const { title, teacherId, classId, numberOfQuestions } = req.body;
    let text = '';
    let fileUrl = null;

    if (file) {
      const { publicUrl } = await uploadFile(file.buffer, file.originalname, file.mimetype);
      fileUrl = publicUrl;
      text = await extractText(file.buffer, file.mimetype);
    }

    const examRes = await db.query(
      'INSERT INTO Exams (teacher_id, class_id, title, raw_text_content, file_path) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [teacherId, classId, title || 'Generated Quiz', text, fileUrl]
    );
    const examId = examRes.rows[0].id;

    let questions = [];
    if (text) questions = await generateQuizFromText(text, examId, parseInt(numberOfQuestions) || 10);
    res.json({ message: 'Exam created successfully', examId, questions });
  } catch (error) {
    console.error('QUIZ GENERATION ERROR:', error);
    res.status(500).json({ error: 'Failed to create exam' });
  }
});

// --- UPLOAD ANSWER KEY FILE ---
app.post('/api/upload-answer-key-file', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No file uploaded' });

    const { publicUrl } = await uploadFile(file.buffer, file.originalname, file.mimetype);
    res.json({ publicUrl });
  } catch (error) {
    console.error('FILE UPLOAD ERROR:', error);
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

// --- STUDENT: UPLOAD PAPER ---
app.post('/api/upload-paper', upload.single('studentPaper'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No image uploaded' });
    
    // Ensure these IDs are integers
    const studentId = parseInt(req.body.studentId);
    const examId = parseInt(req.body.examId);

    if (isNaN(studentId) || isNaN(examId)) {
      return res.status(400).json({ error: 'Invalid Student or Exam ID' });
    }

    const { publicUrl } = await uploadFile(file.buffer, file.originalname, file.mimetype);

    // This is where the crash likely happens.
    // We wrap it to see exactly what goes wrong.
    // FIX: Pass file.buffer as imageBuffer (4th param), not as imagePath (3rd param)
    const result = await gradeSubmission(examId, studentId, null, file.buffer, publicUrl);
    
    res.json({ message: 'Paper graded successfully', result });
  } catch (error) {
    console.error('CRITICAL GRADING ERROR:', error);
    // This ensures we send JSON even if the server crashes
    res.status(500).json({ error: 'Internal Server Error: ' + error.message });
  }
});

// --- MISSING OCR & QUESTION ROUTES ADDED HERE ---

// 1. Get Questions for a specific exam
app.get('/api/exams/:id/questions', async (req, res) => {
  try {
    const { id } = req.params;
    
    // This query now looks in BOTH tables and combines the results
    const query = `
      SELECT id, question_text, correct_answer FROM generated_questions WHERE exam_id = $1
      UNION ALL
      SELECT id, question_text, answer_text as correct_answer FROM answer_keys WHERE exam_id = $1
      ORDER BY id ASC;
    `;
    
    const result = await db.query(query, [id]);
    
    // We format it so the frontend thinks they are all 'manual' answers for now
    res.json({ manual: result.rows, generated: [] });
  } catch (error) {
    console.error("Fetch questions error:", error);
    res.status(500).json({ error: "Failed to fetch questions" });
  }
});

// 2. OCR Extraction Endpoint
app.post('/api/test-ocr', upload.any(), async (req, res) => {
  try {
    const file = req.files && req.files.length > 0 ? req.files[0] : null;
    if (!file) return res.status(400).json({ error: 'No file uploaded' });
    
    const rawText = await extractText(file.buffer, file.mimetype);
    
    // --- USE YOUR PARSER HERE ---
    // This function should be designed to separate questions from answers
    const parsedData = parseFullQuestions(rawText); 
    
    // Return the cleaned version to the frontend
    res.json({ 
      text: rawText, 
      parsedQuestions: parsedData, 
      message: "OCR Extracted and Parsed" 
    });
  } catch (error) {
    console.error('OCR ERROR:', error);
    res.status(500).json({ error: 'Failed to extract text' });
  }
});

// --- GET AUTO-GRADING RESULTS ---
app.get('/api/submissions/:classId', async (req, res) => {
  try {
    const { classId } = req.params;

    // Grabs the submissions for a class by joining with Exams table
    const query = `
      SELECT sub.*, u.name as student_name, u.email, e.title as exam_title
      FROM student_submissions sub
      JOIN Users u ON sub.student_id = u.id
      JOIN Exams e ON sub.exam_id = e.id
      WHERE e.class_id = $1
      ORDER BY sub.created_at DESC;
    `;

    const result = await db.query(query, [classId]);
    res.json(result.rows);

  } catch (error) {
    console.error("Fetch submissions error:", error);
    res.status(500).json({ error: "Failed to fetch submissions" });
  }
});

// --- DELETE SUBMISSION ---
app.delete('/api/submissions/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM student_submissions WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    console.error("Delete submission error:", error);
    res.status(500).json({ error: "Failed to delete submission" });
  }
});

// --- UPLOAD MANUAL OR OCR ANSWER KEY ---
// --- UPLOAD MANUAL OR OCR ANSWER KEY ---
app.post('/api/upload-answer-key', async (req, res) => {
  try {
    const { examId, answers, pdfUrl } = req.body;
    if (!examId || !answers) return res.status(400).json({ error: 'Missing data' });

    // 1. Clear old keys for this exam (prevent duplicates)
    await db.query('DELETE FROM answer_keys WHERE exam_id = $1', [examId]);
    await db.query('DELETE FROM generated_questions WHERE exam_id = $1', [examId]);

    let questionCount = 0;

    // 2. CHECK: If the frontend sent a structured array (OCR Data)
    if (Array.isArray(answers)) {
      console.log(`Processing array of ${answers.length} answers...`);
      for (const item of answers) {
        if (item.correctAnswer && item.correctAnswer !== '?') {
          questionCount++;
          await db.query(
            'INSERT INTO answer_keys (exam_id, answer_text, question_text) VALUES ($1, $2, $3)',
            [examId, item.correctAnswer, item.questionText || `Question ${questionCount}`]
          );
        }
      }
    } 
    // 3. FALLBACK: If the frontend sent a raw string (OCR or Manual definition)
    else if (typeof answers === 'string') {
      console.log("================\nRAW OCR TEXT:\n", answers, "\n================");

      let currentCandidate = null;
      const parsedQuestions = [];
      const lines = answers.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // 1. Filter out Multiple Choice options and Headers so they don't corrupt the data
        if (line.match(/^[A-D]\)/) || line.startsWith('PART') || line.startsWith('Note:')) {
          continue;
        }

        // 2. The Anchor Split: Hunt for the Number + Dot anywhere in the line
        const anchorMatch = line.match(/(\d+)\s*\.\s*(.*)/);

        if (anchorMatch) {
          const questionNum = parseInt(anchorMatch[1], 10);
          const questionText = anchorMatch[2].trim();

          // 3. Slice the string: grab everything to the left of the number
          const leftSideText = line.substring(0, anchorMatch.index).trim();

          parsedQuestions.push({
            answer_text: leftSideText ? leftSideText : (currentCandidate || "?"),
            question_number: questionNum,
            question_text: questionText
          });

          currentCandidate = null; // Reset state for the next pair
          continue;
        }

        // 4. If no number is found, it's a floating answer waiting for a question
        currentCandidate = line;
      }

      console.log("====== FINAL PARSED ARRAY ======\n", parsedQuestions);

      // Insert parsed questions into database
      for (const q of parsedQuestions) {
        questionCount++;
        await db.query(
          'INSERT INTO answer_keys (exam_id, answer_text, question_text) VALUES ($1, $2, $3)',
          [examId, q.answer_text, q.question_text]
        );
      }
    }

    // Update exams table with PDF URL if provided
    if (pdfUrl) {
      await db.query('UPDATE Exams SET file_path = $1 WHERE id = $2', [pdfUrl, examId]);
    }

    res.json({ success: true, message: `Successfully saved ${questionCount} answers to database!` });
  } catch (error) {
    console.error("DATABASE SAVE ERROR:", error);
    res.status(500).json({ error: "Failed to save key to database" });
  }
});

app.delete('/api/exams/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // 1. Delete associated answer keys first (Foreign Key constraint)
    await db.query('DELETE FROM answer_keys WHERE exam_id = $1', [id]);

    // 2. Delete associated generated questions
    await db.query('DELETE FROM generated_questions WHERE exam_id = $1', [id]);

    // 3. Delete associated student submissions
    await db.query('DELETE FROM student_submissions WHERE exam_id = $1', [id]);

    // 4. Finally, delete the exam record itself
    const result = await db.query('DELETE FROM Exams WHERE id = $1 RETURNING *', [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Exam not found" });
    }

    res.json({ message: "Exam and all related data deleted successfully" });
  } catch (error) {
    console.error("DELETE EXAM ERROR:", error);
    res.status(500).json({ error: "Failed to delete exam and related records" });
  }
});

// --- STUDENT DASHBOARD STATS ---
app.get('/api/student/dashboard', async (req, res) => {
  try {
    const { studentId } = req.query;
    if (!studentId || studentId === 'undefined' || studentId === 'null') {
      return res.status(400).json({ error: 'Missing studentId' });
    }

    const activeClassesRes = await db.query(
      'SELECT COUNT(*) FROM Students WHERE user_id = $1',
      [studentId]
    );

    const avgGradeRes = await db.query(
      'SELECT COALESCE(AVG(score), 0) as average FROM Student_Submissions WHERE student_id = $1',
      [studentId]
    );

    const totalSubRes = await db.query(
      'SELECT COUNT(*) FROM Student_Submissions WHERE student_id = $1',
      [studentId]
    );

    const recentRes = await db.query(
      `SELECT sub.id, e.title as exam_title, sub.score, sub.created_at,
              (SELECT COUNT(*) FROM answer_keys ak WHERE ak.exam_id = e.id) as total_questions
       FROM Student_Submissions sub
       JOIN Exams e ON sub.exam_id = e.id
       WHERE sub.student_id = $1
       ORDER BY sub.created_at DESC
       LIMIT 5`,
      [studentId]
    );

    res.json({
      activeClasses: parseInt(activeClassesRes.rows[0].count, 10),
      averageGrade: parseFloat(avgGradeRes.rows[0].average).toFixed(1),
      totalSubmissions: parseInt(totalSubRes.rows[0].count, 10),
      recentSubmissions: recentRes.rows
    });
  } catch (error) {
    console.error('STUDENT DASHBOARD ERROR:', error);
    res.status(500).json({ error: 'Failed to fetch student dashboard data' });
  }
});

// --- STUDENT GRADES BY CLASS (strict student_id filter) ---
app.get('/api/student/:studentId/grades/:classId', async (req, res) => {
  try {
    const { studentId, classId } = req.params;

    const result = await db.query(
      `SELECT sub.id, e.title as exam_title, sub.score, sub.created_at,
              (SELECT COUNT(*) FROM answer_keys ak WHERE ak.exam_id = e.id) as total_questions
       FROM Student_Submissions sub
       JOIN Exams e ON sub.exam_id = e.id
       WHERE sub.student_id = $1 AND e.class_id = $2
       ORDER BY sub.created_at DESC`,
      [studentId, classId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('STUDENT GRADES ERROR:', error);
    res.status(500).json({ error: 'Failed to fetch student grades' });
  }
});

// --- USER PROFILE ---
// GET /api/user/profile?userId=...
app.get('/api/user/profile', async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId || userId === 'undefined') {
      return res.status(400).json({ error: 'Missing userId' });
    }
    const result = await db.query(
      'SELECT id, name, email, role FROM Users WHERE id = $1',
      [userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('FETCH PROFILE ERROR:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// PUT /api/user/update-name
app.put('/api/user/update-name', async (req, res) => {
  try {
    const { userId, firstName, lastName } = req.body;
    if (!userId || !firstName || !lastName) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const newName = `${firstName.trim()} ${lastName.trim()}`;
    const result = await db.query(
      'UPDATE Users SET name = $1 WHERE id = $2 RETURNING id, name, email, role',
      [newName, userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    // Update the name in localStorage-friendly response
    res.json({ success: true, user: result.rows[0] });
  } catch (error) {
    console.error('UPDATE NAME ERROR:', error);
    res.status(500).json({ error: 'Failed to update name' });
  }
});

// PUT /api/user/update-password
app.put('/api/user/update-password', async (req, res) => {
  try {
    const { userId, currentPassword, newPassword } = req.body;
    if (!userId || !currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }
    // Fetch current hash
    const result = await db.query('SELECT password_hash FROM Users WHERE id = $1', [userId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    // Verify current password
    const match = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    // Hash and save new password
    const newHash = await bcrypt.hash(newPassword, 10);
    await db.query('UPDATE Users SET password_hash = $1 WHERE id = $2', [newHash, userId]);
    res.json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    console.error('UPDATE PASSWORD ERROR:', error);
    res.status(500).json({ error: 'Failed to update password' });
  }
});

module.exports = app;

if (require.main === module) {
  app.listen(port, () => console.log(`ScanMine running on ${port}`));
}