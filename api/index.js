const path = require('path');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const db = require('../backend/db');

// Only load dotenv in local development. 
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config({ path: path.join(__dirname, '../backend/.env') });
}

// Fixed import for Vercel Linux compatibility
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const { extractText, generateQuizFromText } = require('../backend/scripts/generateQuestions');
const { gradeSubmission } = require('../backend/scripts/autoGradeSubmission');
const OCRSpaceService = require('../backend/scripts/ocrSpaceService');
const { parseFullQuestions } = require('../backend/scripts/ocrAnswerParser');
const { uploadFile, deleteFile } = require('../backend/supabaseClient');
const { BUCKET_NAME } = require('../backend/supabaseClient');

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// ── Startup migrations (local dev only) ──────────────────────────────────
// These idempotent ALTER TABLE statements run ONLY in local development.
// On Vercel (process.env.VERCEL === '1') or any production environment they
// are skipped entirely — each DB round-trip during a cold start adds latency
// that compounds towards the 45-second serverless timeout.
// To apply schema changes in production, run `node backend/run_migration.js`
// or execute the SQL directly in the Supabase dashboard.
async function runStartupMigrations() {
  // 1. Add 'status' column to Students
  try {
    await db.query(`
      ALTER TABLE Students
      ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'pending'
    `);
    console.log('Migration OK: Students.status column ready');
  } catch (err) {
    console.error('Migration warning:', err.message);
  }

  // 2. Add 'supabase_id' column to Users
  // This UUID links the PostgreSQL profile row to the Supabase Auth user,
  // enabling password reset emails and Supabase session management.
  try {
    await db.query(`
      ALTER TABLE Users
      ADD COLUMN IF NOT EXISTS supabase_id UUID UNIQUE
    `);
    console.log('Migration OK: Users.supabase_id column ready');
  } catch (err) {
    console.error('Migration warning (supabase_id):', err.message);
  }

  // 3. Make password_hash nullable
  // New users registered via Supabase Auth don't have a local password hash;
  // Supabase owns the credential. Existing users are unaffected.
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

  // 4. Add raw score columns to Student_Submissions
  try {
    await db.query(`
      ALTER TABLE Student_Submissions 
      ADD COLUMN IF NOT EXISTS points_earned INTEGER,
      ADD COLUMN IF NOT EXISTS total_items INTEGER
    `);
    console.log('Migration OK: Student_Submissions points/total columns ready');
  } catch (err) {
    console.error('Migration warning (raw scores):', err.message);
  }

  // 5a. Add class_code column to Classes (check information_schema first to
  //     avoid a table lock if the column is already present)
  try {
    const { rows } = await db.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'classes' AND column_name = 'class_code'
    `);
    if (rows.length === 0) {
      await db.query(`ALTER TABLE Classes ADD COLUMN class_code VARCHAR(10) UNIQUE`);
      console.log('Migration OK: Classes.class_code column added');
    } else {
      console.log('Migration OK: Classes.class_code already exists — skipping ALTER');
    }
  } catch (err) {
    console.error('Migration warning (class_code add):', err.message);
  }

  // 5b. Backfill class_code for existing rows (WHERE guard makes this a no-op
  //     once all rows have a code)
  try {
    await db.query(`
      UPDATE Classes
      SET class_code = UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 6))
      WHERE class_code IS NULL
    `);
    console.log('Migration OK: Classes.class_code backfill complete');
  } catch (err) {
    console.error('Migration warning (class_code backfill):', err.message);
  }

  // 5c. Enforce NOT NULL on class_code (only after backfill; checks
  //     is_nullable so repeated runs don't re-acquire the lock)
  try {
    const { rows } = await db.query(`
      SELECT is_nullable FROM information_schema.columns
      WHERE table_name = 'classes' AND column_name = 'class_code'
    `);
    if (rows.length > 0 && rows[0].is_nullable === 'YES') {
      await db.query(`ALTER TABLE Classes ALTER COLUMN class_code SET NOT NULL`);
      console.log('Migration OK: Classes.class_code set NOT NULL');
    } else {
      console.log('Migration OK: Classes.class_code NOT NULL already enforced — skipping');
    }
  } catch (err) {
    console.error('Migration warning (class_code not null):', err.message);
  }

  // 6. Add first_name, middle_initial, last_name columns to Users
  try {
    await db.query(`
      ALTER TABLE Users
        ADD COLUMN IF NOT EXISTS first_name    VARCHAR(100),
        ADD COLUMN IF NOT EXISTS middle_initial CHAR(1),
        ADD COLUMN IF NOT EXISTS last_name     VARCHAR(100)
    `);
    console.log('Migration OK: Users first_name / middle_initial / last_name columns ready');
  } catch (err) {
    console.error('Migration warning (name columns):', err.message);
  }

  // 6b. Backfill first_name / last_name from composite name column
  try {
    await db.query(`
      UPDATE Users
      SET
        first_name = TRIM(SPLIT_PART(name, ' ', 1)),
        last_name  = TRIM(SUBSTRING(name FROM POSITION(' ' IN name) + 1))
      WHERE first_name IS NULL AND name IS NOT NULL AND POSITION(' ' IN name) > 0
    `);
    console.log('Migration OK: Users first_name/last_name backfill complete');
  } catch (err) {
    console.error('Migration warning (name backfill):', err.message);
  }
}

// Guard: NEVER run migrations during a Vercel serverless cold start.
// process.env.VERCEL is set to '1' automatically by the Vercel runtime.
if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  runStartupMigrations();
}


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
    const { supabaseId, name, firstName, middleInitial, lastName, email, role } = req.body;

    // Build the composite full_name (supports both old and new callers)
    const computedFullName = firstName
      ? [firstName.trim(), middleInitial ? `${middleInitial.trim().toUpperCase()}.` : '', lastName ? lastName.trim() : ''].filter(Boolean).join(' ')
      : name;

    if (!computedFullName || !email || !role) {
      return res.status(400).json({ error: 'Missing required fields: name, email, role' });
    }

    let result;

    if (supabaseId) {
      // ── New flow: Supabase Auth manages the password ──────────────────────
      result = await db.query(
        `INSERT INTO Users (name, first_name, middle_initial, last_name, email, role, supabase_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (email) DO UPDATE
           SET supabase_id    = EXCLUDED.supabase_id,
               name           = EXCLUDED.name,
               first_name     = EXCLUDED.first_name,
               middle_initial = EXCLUDED.middle_initial,
               last_name      = EXCLUDED.last_name,
               role           = EXCLUDED.role
         RETURNING id, name, first_name, middle_initial, last_name, email, role, supabase_id`,
        [computedFullName, firstName ? firstName.trim() : null, middleInitial ? middleInitial.trim().toUpperCase() : null, lastName ? lastName.trim() : null, email, role, supabaseId]
      );
    } else {
      // ── Legacy fallback: no Supabase ID provided ──────────────────────────
      const { password } = req.body;
      if (!password) return res.status(400).json({ error: 'Missing password for legacy registration' });
      const hashedPassword = await bcrypt.hash(password, 10);
      result = await db.query(
        `INSERT INTO Users (name, first_name, middle_initial, last_name, email, password_hash, role)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, name, first_name, middle_initial, last_name, email, role`,
        [computedFullName, firstName ? firstName.trim() : null, middleInitial ? middleInitial.trim().toUpperCase() : null, lastName ? lastName.trim() : null, email, hashedPassword, role]
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
    const { email, password, isSupabaseAuth, supabaseId } = req.body;
    let result;

    if (isSupabaseAuth && supabaseId) {
      // Find by Supabase UUID
      result = await db.query('SELECT * FROM Users WHERE supabase_id = $1', [supabaseId]);
    } else {
      // Standard find by email
      result = await db.query('SELECT * FROM Users WHERE email = $1', [email]);
    }

    if (result.rows.length === 0) return res.status(401).json({ error: 'User not found' });
    
    let user = result.rows[0];
    
    // If authenticated via Supabase on the frontend, skip local password check
    if (!isSupabaseAuth) {
      if (!user.password_hash) {
        return res.status(401).json({ error: 'Please use the unified login (Supabase) for this account.' });
      }
      const match = await bcrypt.compare(password, user.password_hash);
      if (!match) return res.status(401).json({ error: 'Invalid password' });
    }

    // If first_name or last_name is missing in DB but provided in request (e.g. immediately after signup)
    const { firstName, middleInitial, lastName } = req.body;
    if ((!user.first_name || !user.last_name) && (firstName || lastName)) {
      try {
        const fn = firstName ? firstName.trim() : user.first_name;
        const mi = middleInitial ? middleInitial.trim().toUpperCase().slice(0, 1) : user.middle_initial;
        const ln = lastName ? lastName.trim() : user.last_name;
        const compName = [fn, mi ? `${mi}.` : '', ln].filter(Boolean).join(' ') || user.name;
        const updated = await db.query(
          `UPDATE Users SET first_name = $1, middle_initial = $2, last_name = $3, name = $4 WHERE id = $5 RETURNING *`,
          [fn, mi, ln, compName, user.id]
        );
        if (updated.rows.length > 0) {
          user = updated.rows[0];
        }
      } catch (patchErr) {
        console.warn('Non-fatal: could not backfill user name fields during login:', patchErr.message);
      }
    }
    
    res.json({ user: { id: user.id, name: user.name, first_name: user.first_name, middle_initial: user.middle_initial, last_name: user.last_name, role: user.role, email: user.email, supabase_id: user.supabase_id } });
  } catch (error) {
    console.error('LOGIN ERROR:', error);
    res.status(500).json({ error: 'Server error during login' });
  }
});

// --- CLASSES & STUDENTS ---

// ── Class code generator ──────────────────────────────────────────────────
// Generates a unique 6-character alphanumeric code (uppercase).
// Retries up to 10 times to avoid (extremely rare) collisions.
const CLASS_CODE_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
async function generateUniqueClassCode() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = Array.from({ length: 6 }, () =>
      CLASS_CODE_CHARSET[Math.floor(Math.random() * CLASS_CODE_CHARSET.length)]
    ).join('');
    const { rows } = await db.query(
      'SELECT 1 FROM Classes WHERE class_code = $1', [code]
    );
    if (rows.length === 0) return code;
  }
  throw new Error('Could not generate a unique class code after 10 attempts');
}

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
    const classCode = await generateUniqueClassCode();
    const result = await db.query(
      'INSERT INTO Classes (teacher_id, name, subject, class_code) VALUES ($1, $2, $3, $4) RETURNING *',
      [teacherId, name, subject, classCode]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error('CREATE CLASS ERROR:', error);
    res.status(500).json({ error: 'Failed to create class' });
  }
});

// POST /api/classes/join  { code, userId }
// Students join a class using a 6-character code.
// Placed BEFORE DELETE /api/classes/:id so Express doesn't match 'join' as :id.
app.post('/api/classes/join', async (req, res) => {
  try {
    const { code, userId } = req.body;
    if (!code || !userId) return res.status(400).json({ error: 'Missing code or userId' });

    const codeUpper = code.trim().toUpperCase();

    // 1. Resolve the class by code
    const classRes = await db.query(
      'SELECT id, name, subject FROM Classes WHERE class_code = $1', [codeUpper]
    );
    if (classRes.rows.length === 0) {
      return res.status(404).json({ error: 'No class found with that code. Please check and try again.' });
    }
    const cls = classRes.rows[0];

    // 2. Check for an existing enrollment record (graceful duplicate handling)
    const existing = await db.query(
      'SELECT status FROM Students WHERE class_id = $1 AND user_id = $2',
      [cls.id, userId]
    );
    if (existing.rows.length > 0) {
      const status = existing.rows[0].status;
      if (status === 'enrolled') {
        return res.status(409).json({ error: 'You are already enrolled in this class.' });
      }
      // Pending invite exists — upgrade to enrolled immediately
      await db.query(
        "UPDATE Students SET status = 'enrolled' WHERE class_id = $1 AND user_id = $2",
        [cls.id, userId]
      );
      return res.json({ message: 'Enrollment confirmed!', class: cls });
    }

    // 3. Fresh enrollment — insert as enrolled directly
    await db.query(
      "INSERT INTO Students (class_id, user_id, status) VALUES ($1, $2, 'enrolled')",
      [cls.id, userId]
    );
    res.json({ message: `Successfully joined ${cls.name}!`, class: cls });
  } catch (error) {
    console.error('JOIN CLASS ERROR:', error);
    if (error.code === '23505') {
      return res.status(409).json({ error: 'You are already enrolled in this class.' });
    }
    res.status(500).json({ error: 'Failed to join class' });
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
      'SELECT u.name as student_name, e.title as subject, sub.score, sub.created_at, sub.points_earned, sub.total_items FROM Student_Submissions sub JOIN Users u ON sub.student_id = u.id JOIN Exams e ON sub.exam_id = e.id WHERE e.teacher_id = $1 ORDER BY sub.created_at DESC LIMIT 5',
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

// --- TEACHER: GRADE MANUALLY ---
app.post('/api/grade-manual', async (req, res) => {
  try {
    const { studentId, examId, answers } = req.body;
    if (!studentId || !examId || !answers) {
      return res.status(400).json({ error: 'Missing studentId, examId, or answers' });
    }

    // 1. Get Answer Keys
    let keysRes = await db.query('SELECT * FROM Answer_Keys WHERE exam_id = $1 ORDER BY id ASC', [examId]);
    let answerKeys = keysRes.rows;

    if (answerKeys.length === 0) {
      const genRes = await db.query('SELECT id, correct_answer as answer_text FROM Generated_Questions WHERE exam_id = $1 ORDER BY id ASC', [examId]);
      answerKeys = genRes.rows;
    }

    if (answerKeys.length === 0) {
      return res.status(400).json({ error: 'No answer key found for this exam' });
    }

    // 2. Parse manual answers (comma separated)
    const studentAnswers = {};
    const answerList = answers.split(',').map(a => a.trim());
    answerList.forEach((val, idx) => {
      studentAnswers[idx + 1] = val;
    });

    let correctCount = 0;
    const feedbackLines = [];

    // 3. Grade
    for (let i = 0; i < answerKeys.length; i++) {
      const qNum = i + 1;
      const correctAnswer = answerKeys[i].answer_text?.toString().trim();
      const studentAnswer = (studentAnswers[qNum] || '').trim();
      
      const isCorrect = studentAnswer && correctAnswer && studentAnswer.toLowerCase() === correctAnswer.toLowerCase();
      if (isCorrect) correctCount++;
      
      feedbackLines.push(`Q${qNum}: Student answered "${studentAnswer}" | Correct: "${correctAnswer}" | ${isCorrect ? '✅ Correct' : '❌ Wrong'}`);
    }

    const totalScore = correctCount;
    const maxScore = answerKeys.length;
    const percentage = maxScore > 0 ? (totalScore / maxScore) * 100 : 0;
    const feedback = feedbackLines.join('\n');

    // 4. Save
    await db.query(
      `INSERT INTO Student_Submissions (student_id, exam_id, score, feedback, points_earned, total_items)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (student_id, exam_id)
       DO UPDATE SET score = EXCLUDED.score, feedback = EXCLUDED.feedback, points_earned = EXCLUDED.points_earned, total_items = EXCLUDED.total_items, created_at = NOW()`,
      [studentId, examId, percentage, feedback, totalScore, maxScore]
    );

    const subRes = await db.query('SELECT id FROM Student_Submissions WHERE student_id = $1 AND exam_id = $2', [studentId, examId]);

    res.json({
      message: 'Graded successfully',
      result: {
        submission_id: subRes.rows[0]?.id,
        totalScore,
        maxScore,
        feedback
      }
    });

  } catch (error) {
    console.error('MANUAL GRADING ERROR:', error);
    res.status(500).json({ error: 'Server error during manual grading' });
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

// --- GET SUBMISSIONS FOR SPECIFIC EXAM ---
app.get('/api/exams/:examId/submissions', async (req, res) => {
  try {
    const { examId } = req.params;
    const query = `
      SELECT sub.*, u.name as student_name 
      FROM student_submissions sub 
      JOIN Users u ON sub.student_id = u.id 
      WHERE sub.exam_id = $1
    `;
    const result = await db.query(query, [examId]);
    res.json(result.rows);
  } catch (error) {
    console.error("Fetch exam submissions error:", error);
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
              sub.points_earned, sub.total_items,
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
              sub.points_earned, sub.total_items,
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
      'SELECT id, name, first_name, middle_initial, last_name, email, role FROM Users WHERE id = $1',
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
    const { userId, firstName, middleInitial, lastName } = req.body;
    if (!userId || !firstName || !lastName) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const mi = (middleInitial || '').trim().toUpperCase().slice(0, 1);
    const newName = [firstName.trim(), mi ? `${mi}.` : '', lastName.trim()].filter(Boolean).join(' ');
    const result = await db.query(
      `UPDATE Users
       SET name = $1, first_name = $2, middle_initial = $3, last_name = $4
       WHERE id = $5
       RETURNING id, name, first_name, middle_initial, last_name, email, role`,
      [newName, firstName.trim(), mi || null, lastName.trim(), userId]
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