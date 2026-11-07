const path = require('path');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');
const db = require('../backend/db');

// Only load dotenv in local development. 
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config({ path: path.join(__dirname, '../backend/.env') });
}

// Fixed import for Vercel Linux compatibility
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const { extractText, generateQuizFromText } = require('../backend/scripts/generateQuestions');
const { gradeSubmission } = require('../backend/scripts/autoGradeSubmission');
const OCRRouter = require('../backend/scripts/ocrRouter');
const OCRSpaceService = require('../backend/scripts/ocrSpaceService');
const { parseFullQuestions } = require('../backend/scripts/ocrAnswerParser');
const { supabase, uploadFile, deleteFile } = require('../backend/supabaseClient');

const app = express();
const port = process.env.PORT || 5000;
const MULTIPLE_CHOICE_LETTERS = ['A', 'B', 'C', 'D'];

const normalizeMultipleChoiceAnswer = (answer, options) => {
  const value = typeof answer === 'string' ? answer.trim() : String(answer ?? '').trim();
  const letterMatch = value.match(/^([A-D])(?:\s*[).:-]|\s*\(|$)/i);
  if (letterMatch) return letterMatch[1].toUpperCase();

  if (!Array.isArray(options) || !value) return null;
  const cleanOptions = options.map(option => (
    typeof option === 'string' ? option.replace(/^\s*[A-D]\s*[.)]\s*/i, '').trim() : ''
  ));
  const normalizedAnswer = value.toLowerCase();
  let index = cleanOptions.findIndex(option => option && option.toLowerCase() === normalizedAnswer);
  if (index < 0) {
    index = cleanOptions.findIndex(option => option
      && (option.toLowerCase().includes(normalizedAnswer) || normalizedAnswer.includes(option.toLowerCase())));
  }
  return index >= 0 && index < MULTIPLE_CHOICE_LETTERS.length
    ? MULTIPLE_CHOICE_LETTERS[index]
    : null;
};

const getStoragePathFromUrl = (url) => {
  if (typeof url !== 'string' || !url.trim()) return null;

  let path = url.trim();
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(path)) {
    try {
      const { pathname } = new URL(path);
      const match = pathname.match(/^\/storage\/v1\/object\/(?:public|sign|authenticated)\/scanned-quizzes\/(.+)$/);
      if (!match) return null;
      path = match[1];
    } catch (error) {
      if (error instanceof TypeError) return null;
      throw error;
    }
  } else {
    path = path.split(/[?#]/, 1)[0].replace(/^\/+/, '');
    if (path.startsWith('scanned-quizzes/')) {
      path = path.slice('scanned-quizzes/'.length);
    }
  }

  try {
    path = decodeURIComponent(path).replace(/^\/+/, '');
  } catch (error) {
    if (error instanceof URIError) return null;
    throw error;
  }

  if (!path || path.split('/').some(segment => segment === '..')) return null;
  return path;
};

app.use(cors());
app.use(express.json());

const authenticateProfileRequest = async (req, res, next) => {
  const authorization = req.headers.authorization || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  try {
    const { data: { user: authUser }, error } = await supabase.auth.getUser(token);
    if (error || !authUser) return res.status(401).json({ error: 'Invalid or expired session' });

    const result = await db.query(
      'SELECT id, name, email, role, supabase_id FROM Users WHERE supabase_id = $1',
      [authUser.id]
    );
    if (result.rows.length === 0) return res.status(403).json({ error: 'Account is not registered in ScanMine' });

    req.authenticatedUser = result.rows[0];
    next();
  } catch (error) {
    console.error('PROFILE AUTHENTICATION ERROR:', error);
    res.status(500).json({ error: 'Failed to authenticate request' });
  }
};

const verifySupabasePassword = async (email, password) => {
  const apiKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!process.env.SUPABASE_URL || !apiKey) {
    throw new Error('Supabase password authentication is not configured');
  }

  const authClient = createClient(process.env.SUPABASE_URL, apiKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const { error } = await authClient.auth.signInWithPassword({ email, password });
  if (error?.message === 'Invalid login credentials') return false;
  if (error) throw error;
  return true;
};

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

  // 4b. Track whether a submission was verified
  try {
    await db.query(`
      ALTER TABLE Student_Submissions
      ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE
    `);
    console.log('Migration OK: Student_Submissions.is_verified column ready');
  } catch (err) {
    console.error('Migration warning (submission verification):', err.message);
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

app.put('/api/exams/:id/toggle-submission', authenticateProfileRequest, async (req, res) => {
  try {
    if (req.authenticatedUser.role !== 'teacher') {
      return res.status(403).json({ error: 'Only teachers can update exam submissions' });
    }
    const { is_submission_open: isSubmissionOpen } = req.body;
    if (typeof isSubmissionOpen !== 'boolean') {
      return res.status(400).json({ error: 'is_submission_open must be a boolean' });
    }

    const result = await db.query(
      `UPDATE Exams
       SET is_submission_open = $1,
           submission_deadline = CASE
             WHEN $1 = TRUE AND submission_deadline <= NOW() THEN NULL
             ELSE submission_deadline
           END
       WHERE id = $2
         AND EXISTS (
           SELECT 1 FROM Classes
           WHERE Classes.id = Exams.class_id
             AND Classes.teacher_id = $3
         )
       RETURNING id, submission_deadline, is_submission_open`,
      [isSubmissionOpen, req.params.id, req.authenticatedUser.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Exam not found' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error('TOGGLE EXAM SUBMISSION ERROR:', error);
    res.status(500).json({ error: 'Failed to update exam submissions' });
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
    const { title, teacherId, classId, numberOfQuestions, customPrompt, submissionDurationMinutes } = req.body;
    const durationMinutes = submissionDurationMinutes === '' || submissionDurationMinutes == null
      ? null
      : Number(submissionDurationMinutes);
    if (durationMinutes !== null && ![15, 30, 60, 120].includes(durationMinutes)) {
      return res.status(400).json({ error: 'Invalid submission duration' });
    }

    // questionTypes arrives as a JSON string: '["multiple_choice","true_false"]'
    let questionTypes = ['multiple_choice', 'true_false', 'identification'];
    try {
      if (req.body.questionTypes) {
        const parsed = JSON.parse(req.body.questionTypes);
        if (Array.isArray(parsed) && parsed.length > 0) questionTypes = parsed;
      }
    } catch (_) { /* keep default if parsing fails */ }

    let questionBreakdown = null;
    if (req.body.questionBreakdown) {
      try {
        questionBreakdown = JSON.parse(req.body.questionBreakdown);
      } catch (_) {
        return res.status(400).json({ error: 'Question breakdown must be valid JSON.' });
      }
      const supportedTypes = new Set(['multiple_choice', 'true_false', 'identification']);
      if (!Array.isArray(questionBreakdown) || questionBreakdown.length === 0
        || questionBreakdown.some(section => (
          !section
          || !supportedTypes.has(section.type)
          || !Number.isInteger(section.count)
          || section.count < 1
        ))
        || new Set(questionBreakdown.map(section => section.type)).size !== questionBreakdown.length) {
        return res.status(400).json({ error: 'Question breakdown must contain unique question types with positive whole-number counts.' });
      }
      questionTypes = questionBreakdown.map(section => section.type);
    }

    const requestedQuestionCount = questionBreakdown
      ? questionBreakdown.reduce((total, section) => total + section.count, 0)
      : parseInt(numberOfQuestions, 10) || 10;

    let text = '';
    let fileUrl = null;

    if (file) {
      const { publicUrl } = await uploadFile(file.buffer, file.originalname, file.mimetype);
      fileUrl = publicUrl;
      if (file.mimetype !== 'application/pdf') {
        text = await extractText(file.buffer, file.mimetype);
      }
    }

    const examRes = await db.query(
      `INSERT INTO Exams (
         teacher_id, class_id, title, raw_text_content, file_path,
         submission_deadline, is_submission_open
       )
       VALUES (
         $1, $2, $3, $4, $5,
         CASE WHEN $6::int IS NULL THEN NULL ELSE NOW() + ($6::int * INTERVAL '1 minute') END,
         TRUE
       )
       RETURNING id`,
      [teacherId, classId, title || 'Generated Quiz', text, fileUrl, durationMinutes]
    );
    const examId = examRes.rows[0].id;

    let result = null;
    if (file?.mimetype === 'application/pdf') {
      result = await generateQuizFromText(file.buffer, requestedQuestionCount, questionTypes, customPrompt || '', file.mimetype, questionBreakdown);
    } else if (text) {
      result = await generateQuizFromText(text, requestedQuestionCount, questionTypes, customPrompt || '', '', questionBreakdown);
    }
    const questionsCandidate = Array.isArray(result)
      ? result
      : result?.items || result?.questions || result?.data || [];
    const finalQuestions = Array.isArray(questionsCandidate) ? questionsCandidate : [];

    return res.json({
      success: true,
      message: 'Exam created successfully',
      examId,
      items: finalQuestions,
      questions: finalQuestions,
      count: finalQuestions.length,
      provider: result?.provider || 'ai'
    });
  } catch (error) {
    console.error('QUIZ GENERATION ERROR:', error);
    res.status(500).json({ error: 'Failed to create exam' });
  }
});

// --- TEACHER: SAVE GENERATED QUIZ AND ASSIGN TO CLASS ---
app.post('/api/save-quiz', async (req, res) => {
  try {
    const { examId, teacherId, classId, title, questions, answers, submissionDurationMinutes } = req.body;
    const durationMinutes = submissionDurationMinutes === '' || submissionDurationMinutes == null
      ? null
      : Number(submissionDurationMinutes);
    if (durationMinutes !== null && ![15, 30, 60, 120].includes(durationMinutes)) {
      return res.status(400).json({ error: 'Invalid submission duration' });
    }
    const sourceQuestions = Array.isArray(questions) ? questions : [];
    const items = Array.isArray(answers) && answers.length
      ? answers.map((answer, index) => ({
          ...sourceQuestions[index],
          ...answer,
          type: answer.type || sourceQuestions[index]?.type,
          options: answer.options || sourceQuestions[index]?.options
        }))
      : sourceQuestions.map(q => ({
          ...q,
          questionText: q.question || q.question_text,
          correctAnswer: q.correctAnswer || q.answer_text
        }));

    if (!items.length) return res.status(400).json({ error: 'No questions to save' });

    const normalizedItems = [];
    for (const item of items) {
      let correctAnswer = item.correctAnswer || item.answer_text || item.correct_answer;
      if (item.type === 'multiple_choice') {
        correctAnswer = normalizeMultipleChoiceAnswer(correctAnswer, item.options);
        if (!correctAnswer) {
          return res.status(400).json({ error: 'A multiple-choice answer could not be mapped to A, B, C, or D.' });
        }
      }
      normalizedItems.push({ ...item, correctAnswer });
    }

    let id = examId;
    if (!id) {
      if (!teacherId || !classId) {
        return res.status(400).json({ error: 'Missing examId or teacher/class' });
      }
      const examRes = await db.query(
        `INSERT INTO Exams (teacher_id, class_id, title, submission_deadline, is_submission_open)
         VALUES (
           $1, $2, $3,
           CASE WHEN $4::int IS NULL THEN NULL ELSE NOW() + ($4::int * INTERVAL '1 minute') END,
           TRUE
         )
         RETURNING id`,
        [teacherId, classId, title || 'Generated Quiz', durationMinutes]
      );
      id = examRes.rows[0].id;
    } else if (Object.prototype.hasOwnProperty.call(req.body, 'submissionDurationMinutes')) {
      await db.query(
        `UPDATE Exams
         SET submission_deadline = CASE
               WHEN $1::int IS NULL THEN NULL
               ELSE NOW() + ($1::int * INTERVAL '1 minute')
             END,
             is_submission_open = TRUE
         WHERE id = $2`,
        [durationMinutes, id]
      );
    }

    await db.query('DELETE FROM answer_keys WHERE exam_id = $1', [id]);
    await db.query('DELETE FROM generated_questions WHERE exam_id = $1', [id]);

    const insertItems = normalizedItems.filter(item => item.correctAnswer);
    const questionCount = insertItems.length;
    if (questionCount > 0) {
      const values = [];
      const valuePlaceholders = insertItems.map((item, index) => {
        const offset = index * 3;
        values.push(
          id,
          item.correctAnswer,
          item.questionText || item.question || item.question_text || `Question ${index + 1}`
        );
        return `($${offset + 1}, $${offset + 2}, $${offset + 3})`;
      });
      await db.query(
        `INSERT INTO answer_keys (exam_id, answer_text, question_text) VALUES ${valuePlaceholders.join(', ')}`,
        values
      );
    }

    res.json({ message: 'Quiz saved and assigned to class', examId: id, questionCount });
  } catch (error) {
    console.error('SAVE QUIZ ERROR:', error);
    res.status(500).json({ error: 'Failed to save quiz' });
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

app.post('/api/quizzes/parse-pdf', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No quiz file uploaded' });

    const isPdf = file.mimetype === 'application/pdf';
    const isImage = file.mimetype.startsWith('image/');
    if (!isPdf && !isImage) {
      return res.status(400).json({ error: 'Upload a PDF or image file' });
    }
    const parseLocalQuestions = (text) => {
      const sourceLines = String(text || '').split(/\r?\n/);
      const questions = new Map();
      const answersByNumber = new Map();
      let currentQuestion = null;
      let inAnswerKey = false;
      let officialKeyStart = -1;
      let lastQuestionLine = -1;
      let manualKey = '';

      for (let lineIndex = 0; lineIndex < sourceLines.length; lineIndex += 1) {
        const line = sourceLines[lineIndex].trim();
        if (!line || /^--\s*\d+\s+of\s+\d+\s+--$/i.test(line)) continue;

        const manualKeyMatch = line.match(/Manual String Key:\s*([A-Za-z0-9,\s]+)/i);
        if (manualKeyMatch) {
          manualKey = manualKeyMatch[1];
          if (!manualKey.trim() && sourceLines[lineIndex + 1]) {
            manualKey = sourceLines[lineIndex + 1].trim();
          }
          currentQuestion = null;
          continue;
        }

        const inlineAnswerKey = line.match(/^(?:answer\s*key|answer\s*sheet)\s*:\s*(.+)$/i);
        if (inlineAnswerKey) {
          inAnswerKey = true;
          currentQuestion = null;
          const numberedKeys = [...inlineAnswerKey[1].matchAll(/(?:Q\s*)?(\d+)\s*[.):]\s*([A-Za-z0-9]+)/gi)];
          if (numberedKeys.length) {
            numberedKeys.forEach(([, number, answer]) => answersByNumber.set(Number(number), answer));
          } else {
            manualKey = inlineAnswerKey[1];
          }
          continue;
        }

        if (/OFFICIAL ANSWER KEY REFERENCE/i.test(line)) {
          officialKeyStart = lineIndex;
          inAnswerKey = true;
          currentQuestion = null;
          continue;
        }

        if (/^(?:answer\s*key|answer\s*sheet|key)\s*:?\s*$/i.test(line)) {
          inAnswerKey = true;
          currentQuestion = null;
          continue;
        }

        const indexedAnswer = line.match(/^(?:Q\s*)?(\d+)\s*[.):]\s*(?:Answer|Key|Ans|Correct\s+Answer)\s*[:.)-]\s*(.+)$/i);
        if (indexedAnswer) {
          answersByNumber.set(Number(indexedAnswer[1]), indexedAnswer[2].trim());
          continue;
        }

        const numberedAnswer = line.match(/^(?:Q\s*)?(\d+)\s*[.):]\s*([A-D]|True|False)(?:\s*[.)])?$/i);
        if (numberedAnswer && (inAnswerKey || questions.has(Number(numberedAnswer[1])))) {
          const answer = numberedAnswer[2];
          answersByNumber.set(
            Number(numberedAnswer[1]),
            /^(?:true|false)$/i.test(answer)
              ? answer[0].toUpperCase() + answer.slice(1).toLowerCase()
              : answer.toUpperCase()
          );
          continue;
        }

        const explicitAnswer = line.match(/^(?:Answer|Key|Ans|Correct\s+Answer)\s*[:.)-]\s*(.+)$/i);
        if (explicitAnswer && currentQuestion) {
          currentQuestion.correctAnswer = explicitAnswer[1].trim();
          continue;
        }

        const questionMatch = line.match(/^(?:Question\s+)?(?:Q\s*)?(\d+)\s*[.):]\s*(.+)$/i);
        if (questionMatch && !inAnswerKey) {
          const questionNumber = Number(questionMatch[1]);
          const inlineAnswer = questionMatch[2].match(/^(.*?)\s+(?:Ans|Answer)\s*[:.)-]\s*(.+)$/i);
          currentQuestion = {
            id: questionNumber,
            questionNumber,
            questionText: (inlineAnswer ? inlineAnswer[1] : questionMatch[2]).trim(),
            correctAnswer: inlineAnswer ? inlineAnswer[2].trim() : ''
          };
          questions.set(questionNumber, currentQuestion);
          lastQuestionLine = lineIndex;
          continue;
        }

        if (currentQuestion && !/^[A-D]\s*[.)]\s*/i.test(line)) {
          currentQuestion.questionText = `${currentQuestion.questionText} ${line}`.trim();
        }
      }

      const questionNumbers = [...questions.keys()].sort((a, b) => a - b);
      const answerSequences = [];
      if (manualKey) answerSequences.push(manualKey);
      if (officialKeyStart >= 0) {
        const officialText = sourceLines.slice(officialKeyStart).join('\n');
        const officialSequence = officialText.match(/\b(?:[A-D]|TRUE|FALSE)(?:\s*,\s*(?:[A-D]|TRUE|FALSE)){1,}\b/i);
        if (officialSequence) answerSequences.push(officialSequence[0]);
      }
      if (!answerSequences.length) {
        const genericKey = sourceLines
          .slice(lastQuestionLine + 1)
          .reverse()
          .map(line => line.match(/\b(?:[A-D]|TRUE|FALSE)(?:\s*,\s*(?:[A-D]|TRUE|FALSE)){1,}\b/i)?.[0])
          .find(Boolean);
        if (genericKey) answerSequences.push(genericKey);
      }

      if (answerSequences.length) {
        const answerTokens = answerSequences[0].match(/[A-Za-z0-9]+/g) || [];
        questionNumbers.forEach((questionNumber, index) => {
          if (!answersByNumber.has(questionNumber) && answerTokens[index]) {
            answersByNumber.set(questionNumber, answerTokens[index]);
          }
        });
      }

      return questionNumbers
        .map(questionNumber => {
          const question = questions.get(questionNumber);
          question.correctAnswer = question.correctAnswer || answersByNumber.get(questionNumber) || '';
          return question;
        })
        .filter(question => question.questionText && question.correctAnswer)
        .map(question => ({
          ...question,
          questionText: question.questionText.trim(),
          correctAnswer: question.correctAnswer.trim()
        }));
    };
    let documentText = '';
    if (isPdf) {
      try {
        const pdfParse = require('pdf-parse/lib/pdf-parse.js');
        const parsedPdf = await pdfParse(file.buffer);
        documentText = typeof parsedPdf?.text === 'string' ? parsedPdf.text.trim() : '';
      } catch (error) {
        console.error('PDF text extraction Error:', error.message);
      }
    }
    let cleanText = documentText.replace(/\s+/g, ' ').trim();
    if (isPdf && cleanText.length < 50) {
      return res.status(400).json({
        success: false,
        message: 'The uploaded slide PDF contains mostly images or non-selectable text. Please upload a text-based document.'
      });
    }

    let extractedQuestions = parseLocalQuestions(documentText);
    if (extractedQuestions.length) {
      return res.json({
        success: true,
        items: extractedQuestions,
        questions: extractedQuestions,
        provider: 'local-fastpath'
      });
    }

    if (!documentText) {
      try {
        documentText = (await new OCRRouter().processAnswerKey(file.buffer, file.mimetype, file.buffer)).trim();
      } catch (error) {
        console.error('Quiz OCR Error:', error.message);
      }
    }
    extractedQuestions = parseLocalQuestions(documentText);
    if (extractedQuestions.length) {
      return res.json({
        success: true,
        items: extractedQuestions,
        questions: extractedQuestions,
        provider: 'local-fastpath'
      });
    }
    cleanText = documentText.replace(/\s+/g, ' ').trim();
    const truncatedContent = cleanText.slice(0, 12000);
    const normalizeParsedItems = (parsed) => {
      const parsedItems = Array.isArray(parsed) ? parsed : (parsed?.items || parsed?.questions);
      if (!Array.isArray(parsedItems)) throw new Error('AI response did not contain an items array.');

      return parsedItems
        .filter(item => typeof item?.questionText === 'string'
          && item.questionText.trim()
          && typeof item?.correctAnswer === 'string'
          && item.correctAnswer.trim())
        .map((item, index) => ({
          id: Number.isInteger(item.id) ? item.id : index + 1,
          questionNumber: Number.isInteger(item.questionNumber) ? item.questionNumber : index + 1,
          questionText: item.questionText.trim(),
          correctAnswer: item.correctAnswer.trim()
        }));
    };
    const parseJsonContent = (content) => {
      if (typeof content !== 'string' || !content.trim()) {
        throw new Error('AI returned an empty response.');
      }
      const jsonText = content.trim().replace(/^```(?:json)?\s*|\s*```$/gi, '');
      return normalizeParsedItems(JSON.parse(jsonText));
    };
    const aiSystemPrompt = 'You are a quiz parsing system. Output ONLY a valid JSON array of objects with keys: questionNumber (number), questionText (string), correctAnswer (string). No markdown formatting or extra commentary.';
    const groqModels = [
      process.env.GROQ_QUIZ_PARSE_MODEL,
      'llama-3.3-70b-versatile',
      'llama3-70b-8192',
      'llama-3.1-8b-instant'
    ].filter(Boolean);
    try {
      if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY is not configured.');
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      try {
        for (const model of groqModels) {
          try {
            const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                model,
                messages: [
                  { role: 'system', content: aiSystemPrompt },
                  { role: 'user', content: `Extract questions and answers from this text:\n${truncatedContent}` }
                ],
                response_format: { type: 'json_object' }
              }),
              signal: controller.signal
            });

            if (!groqResponse.ok) {
              const errorPayload = await groqResponse.text();
              console.error(`Groq HTTP ${groqResponse.status} for ${model}: ${errorPayload}`);
              continue;
            }

            const groqResult = await groqResponse.json();
            const questions = parseJsonContent(groqResult.choices?.[0]?.message?.content);

            return res.json({ success: true, items: questions, questions, provider: 'groq' });
          } catch (groqError) {
            console.error(`Groq Error for ${model}:`, groqError.message);
            if (controller.signal.aborted) break;
          }
        }
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (groqError) {
      console.error('Groq Error:', groqError.message);
    }

    const geminiApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (geminiApiKey) {
      const geminiModels = [
        process.env.GEMINI_QUIZ_PARSE_MODEL,
        'gemini-1.5-flash-latest',
        'gemini-1.5-flash',
        'gemini-2.5-flash',
        'gemini-3.5-flash-lite'
      ].filter(Boolean);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      try {
        for (const model of geminiModels) {
          try {
            const geminiResponse = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(geminiApiKey)}`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  contents: [{
                    parts: [{
                      text: `Extract quiz questions and correct answers into JSON format: [{"questionNumber": 1, "questionText": "...", "correctAnswer": "..."}]. Text:\n${truncatedContent}`
                    }]
                  }],
                  generationConfig: { responseMimeType: 'application/json' }
                }),
                signal: controller.signal
              }
            );
            if (!geminiResponse.ok) {
              const errorPayload = await geminiResponse.text();
              console.error(`Gemini HTTP ${geminiResponse.status} for ${model}: ${errorPayload}`);
              continue;
            }

            const result = await geminiResponse.json();
            const content = result.candidates?.[0]?.content?.parts
              ?.map(part => part.text || '')
              .join('');
            const items = parseJsonContent(content);
            return res.json({ success: true, items, questions: items, provider: 'gemini' });
          } catch (geminiError) {
            console.error(`Gemini Error for ${model}:`, geminiError.message);
            if (controller.signal.aborted) break;
          }
        }
      } finally {
        clearTimeout(timeoutId);
      }
    } else {
      console.error('Gemini Error:', 'GEMINI_API_KEY and GOOGLE_API_KEY are not configured.');
    }

    extractedQuestions = parseLocalQuestions(documentText);
    return res.json({
      success: true,
      items: extractedQuestions || [],
      provider: 'fallback'
    });
  } catch (error) {
    console.error('QUIZ FILE PARSING ERROR:', error);
    res.status(500).json({ error: error.message || 'Failed to parse quiz file' });
  }
});

// --- STUDENT: UPLOAD PAPER ---
app.post('/api/upload-paper', authenticateProfileRequest, (req, res, next) => {
  upload.fields([
    { name: 'pages', maxCount: 3 },
    { name: 'studentPaper', maxCount: 3 }
  ])(req, res, error => {
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.message || 'Failed to upload paper'
      });
    }
    next();
  });
}, async (req, res) => {
  try {
    req.body.role = req.authenticatedUser.role;
    const files = [
      ...(req.files?.pages || []),
      ...(req.files?.studentPaper || [])
    ];
    if (files.length === 0) {
      return res.status(400).json({ success: false, message: 'No image uploaded' });
    }
    if (files.length > 3) {
      return res.status(400).json({ success: false, message: 'A paper can contain at most 3 pages' });
    }
    
    // Ensure these IDs are integers
    const studentId = parseInt(req.body.studentId);
    const examId = parseInt(req.body.examId);

    if (isNaN(studentId) || isNaN(examId)) {
      return res.status(400).json({ success: false, message: 'Invalid Student or Exam ID' });
    }

    if (req.authenticatedUser.role === 'student') {
      const examResult = await db.query(
        'SELECT submission_deadline, is_submission_open FROM Exams WHERE id = $1',
        [examId]
      );
      if (examResult.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Exam not found' });
      }
      const { submission_deadline: submissionDeadline, is_submission_open: isSubmissionOpen } = examResult.rows[0];
      const isExpired = submissionDeadline && new Date() > new Date(submissionDeadline);
      if (!isSubmissionOpen || isExpired) {
        return res.status(403).json({ error: 'Submissions for this exam are closed.' });
      }
    } else if (req.authenticatedUser.role !== 'teacher') {
      return res.status(403).json({ error: 'Only students and teachers can submit exam papers' });
    }

    const publicUrls = [];
    for (const file of files) {
      const { publicUrl } = await uploadFile(file.buffer, file.originalname, file.mimetype);
      publicUrls.push(publicUrl);
    }

    const result = await gradeSubmission(
      examId,
      studentId,
      null,
      files.map(file => file.buffer),
      publicUrls[0],
      req.body
    );
    
    res.json({ message: 'Paper graded successfully', result });
  } catch (error) {
    console.error('CRITICAL GRADING ERROR:', error);
    if (error.code === 'VISION_FALLBACK_TIMEOUT') {
      return res.status(504).json({
        success: false,
        error: 'Processing timed out. Please try again.'
      });
    }
    if (error.code === 'NAME_MISMATCH') {
      return res.status(400).json({
        success: false,
        code: 'NAME_MISMATCH',
        message: error.message
      });
    }
    // This ensures we send JSON even if the server crashes
    res.status(500).json({
      success: false,
      message: 'Internal Server Error: ' + error.message
    });
  }
});

// --- TEACHER: GRADE MANUALLY ---
app.post('/api/grade-manual', async (req, res) => {
  try {
    const { studentId, examId, answers, manualAnswers } = req.body;
    const manualInput = answers ?? manualAnswers;
    if (!studentId || !examId || manualInput === undefined || manualInput === null || manualInput === '') {
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
    const normalizeAnswer = answer => String(answer ?? '')
      .replace(/^(?:Answer|Ans)\s*:\s*/i, '')
      .replace(/^Option\s+/i, '')
      .replace(/^[^a-zA-Z0-9]+/, '')
      .replace(/[.]+$/, '')
      .trim()
      .toUpperCase();
    const studentAnswers = (Array.isArray(manualInput) ? manualInput : String(manualInput).split(','))
      .map(normalizeAnswer);
    const keys = answerKeys.map(key => ({
      ...key,
      answer_text: normalizeAnswer(key.answer_text)
    }));
    console.log("GRADED COMPARISON:", studentAnswers.map((student, i) => ({
      student,
      correct: keys[i]?.answer_text,
      isMatch: student === keys[i]?.answer_text
    })));

    let correctCount = 0;
    const feedbackLines = [];

    // 3. Grade
    for (let i = 0; i < answerKeys.length; i++) {
      const qNum = i + 1;
      const correctAnswer = keys[i].answer_text;
      const studentAnswer = studentAnswers[i] || '';
      
      const isCorrect = studentAnswer && correctAnswer && studentAnswer === correctAnswer;
      if (isCorrect) correctCount++;
      
      feedbackLines.push(`Q${qNum}: Student answered "${studentAnswer}" | Correct: "${correctAnswer}" | ${isCorrect ? 'Correct' : 'Wrong'}`);
    }

    const totalScore = correctCount;
    const maxScore = answerKeys.length;
    const percentage = maxScore > 0 ? (totalScore / maxScore) * 100 : 0;
    const feedback = feedbackLines.join('\n');

    // 4. Save
    await db.query(
      `INSERT INTO Student_Submissions (student_id, exam_id, score, feedback, points_earned, total_items, is_verified)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (student_id, exam_id)
       DO UPDATE SET score = EXCLUDED.score, feedback = EXCLUDED.feedback, points_earned = EXCLUDED.points_earned, total_items = EXCLUDED.total_items, is_verified = EXCLUDED.is_verified, created_at = NOW()`,
      [studentId, examId, percentage, feedback, totalScore, maxScore, true]
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

app.put('/api/exams/:examId/scores', authenticateProfileRequest, async (req, res) => {
  try {
    if (req.authenticatedUser.role !== 'teacher') {
      return res.status(403).json({ error: 'Only teachers can update student scores' });
    }

    const { submissions } = req.body;
    if (!Array.isArray(submissions) || submissions.length === 0) {
      return res.status(400).json({ error: 'At least one submission score is required' });
    }

    const submissionIds = new Set();
    for (const submission of submissions) {
      if (!Number.isSafeInteger(submission?.submissionId) || submission.submissionId <= 0
        || !Number.isSafeInteger(submission?.pointsEarned) || submission.pointsEarned < 0
        || submissionIds.has(submission.submissionId)) {
        return res.status(400).json({ error: 'Submission scores must contain unique IDs and non-negative whole-number scores' });
      }
      submissionIds.add(submission.submissionId);
    }

    const result = await db.query(
      `WITH requested AS MATERIALIZED (
         SELECT
           (item->>'submissionId')::INTEGER AS id,
           (item->>'pointsEarned')::INTEGER AS points_earned
         FROM jsonb_array_elements($1::JSONB) AS entries(item)
       ),
       eligible AS MATERIALIZED (
         SELECT sub.id, requested.points_earned, sub.total_items
         FROM requested
         JOIN student_submissions sub ON sub.id = requested.id AND sub.exam_id = $2
         JOIN Exams exam ON exam.id = sub.exam_id
         JOIN Classes class ON class.id = exam.class_id AND class.teacher_id = $3
         WHERE sub.total_items IS NOT NULL
           AND requested.points_earned BETWEEN 0 AND sub.total_items
       ),
       all_valid AS (
         SELECT COUNT(*) = (SELECT COUNT(*) FROM requested) AS valid
         FROM eligible
       ),
       updated AS (
         UPDATE student_submissions sub
         SET points_earned = eligible.points_earned,
             score = CASE
               WHEN eligible.total_items > 0
                 THEN ROUND((eligible.points_earned::NUMERIC / eligible.total_items) * 100, 2)
               ELSE 0
             END
         FROM eligible
         WHERE sub.id = eligible.id
           AND (SELECT valid FROM all_valid)
         RETURNING sub.id, sub.points_earned, sub.total_items, sub.score
       )
       SELECT * FROM updated`,
      [JSON.stringify(submissions), req.params.examId, req.authenticatedUser.id]
    );

    if (result.rows.length !== submissions.length) {
      return res.status(400).json({ error: 'One or more scores are invalid or the submissions are unavailable' });
    }
    res.json({ scores: result.rows });
  } catch (error) {
    console.error('UPDATE STUDENT SCORES ERROR:', error);
    res.status(500).json({ error: 'Failed to update student scores' });
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

    const normalizedAnswers = Array.isArray(answers)
      ? answers.map(item => {
        if (item?.type !== 'multiple_choice') return item;
        const correctAnswer = normalizeMultipleChoiceAnswer(
          item.correctAnswer ?? item.correct_answer ?? item.answer_text,
          item.options
        );
        return correctAnswer ? { ...item, correctAnswer } : null;
      })
      : answers;
    if (Array.isArray(normalizedAnswers) && normalizedAnswers.some((item, index) => (
      answers[index]?.type === 'multiple_choice' && !item
    ))) {
      return res.status(400).json({ error: 'A multiple-choice answer could not be mapped to A, B, C, or D.' });
    }

    // 1. Clear old keys for this exam (prevent duplicates)
    await db.query('DELETE FROM answer_keys WHERE exam_id = $1', [examId]);
    await db.query('DELETE FROM generated_questions WHERE exam_id = $1', [examId]);

    let questionCount = 0;

    // 2. CHECK: If the frontend sent a structured array (OCR Data)
    if (Array.isArray(normalizedAnswers)) {
      console.log(`Processing array of ${normalizedAnswers.length} answers...`);
      for (const item of normalizedAnswers) {
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

const removeExamStorageFiles = async (filePaths) => {
  const pathsToDelete = [...new Set(filePaths.map(getStoragePathFromUrl).filter(Boolean))];
  if (pathsToDelete.length === 0) return;

  const { error } = await supabase.storage.from('scanned-quizzes').remove(pathsToDelete);
  if (error) throw error;
};

const deleteSingleExam = async (examId) => {
  const { data: exam, error: examError } = await supabase
    .from('exams')
    .select('id, file_path')
    .eq('id', examId)
    .maybeSingle();
  if (examError) throw examError;
  if (!exam) return false;

  const { data: submissions, error: submissionsError } = await supabase
    .from('student_submissions')
    .select('image_url')
    .eq('exam_id', examId);
  if (submissionsError) throw submissionsError;

  await removeExamStorageFiles([
    exam.file_path,
    ...submissions.map(submission => submission.image_url),
  ]);

  const { error: deleteError } = await supabase
    .from('exams')
    .delete()
    .eq('id', examId);
  if (deleteError) throw deleteError;
  return true;
};

const deleteMultipleExams = async (examIds) => {
  const { data: exams, error: examsError } = await supabase
    .from('exams')
    .select('file_path')
    .in('id', examIds);
  if (examsError) throw examsError;

  const { data: submissions, error: submissionsError } = await supabase
    .from('student_submissions')
    .select('image_url')
    .in('exam_id', examIds);
  if (submissionsError) throw submissionsError;

  await removeExamStorageFiles([
    ...exams.map(exam => exam.file_path),
    ...submissions.map(submission => submission.image_url),
  ]);

  const { error: deleteError } = await supabase
    .from('exams')
    .delete()
    .in('id', examIds);
  if (deleteError) throw deleteError;
};

app.delete('/api/quizzes/:id', async (req, res) => {
  try {
    const quizId = Number(req.params.id);
    if (!Number.isSafeInteger(quizId) || quizId <= 0) {
      return res.status(400).json({ error: 'Invalid quiz ID' });
    }

    const deleted = await deleteSingleExam(quizId);
    if (!deleted) {
      return res.status(404).json({ error: 'Quiz not found' });
    }

    res.json({ success: true, message: 'Deleted exam and storage files successfully' });
  } catch (error) {
    console.error('DELETE QUIZ ERROR:', error);
    res.status(500).json({ error: 'Failed to delete quiz and related records' });
  }
});

app.post('/api/quizzes/bulk-delete', async (req, res) => {
  try {
    const { quizIds } = req.body;
    if (!Array.isArray(quizIds) || quizIds.length === 0) {
      return res.status(400).json({ error: 'quizIds must be a non-empty array' });
    }

    const uniqueQuizIds = [...new Set(quizIds.map(Number))];
    if (uniqueQuizIds.some(id => !Number.isSafeInteger(id) || id <= 0)) {
      return res.status(400).json({ error: 'quizIds must contain valid positive IDs' });
    }

    await deleteMultipleExams(uniqueQuizIds);
    res.json({ success: true, count: uniqueQuizIds.length });
  } catch (error) {
    console.error('BULK DELETE QUIZZES ERROR:', error);
    res.status(500).json({ error: 'Failed to delete quizzes and related records' });
  }
});

app.delete('/api/exams/:id', async (req, res) => {
  try {
    const quizId = Number(req.params.id);
    if (!Number.isSafeInteger(quizId) || quizId <= 0) {
      return res.status(400).json({ error: 'Invalid exam ID' });
    }
    const deleted = await deleteSingleExam(quizId);
    if (!deleted) {
      return res.status(404).json({ error: 'Exam not found' });
    }
    res.json({ success: true, message: 'Deleted exam and storage files successfully' });
  } catch (error) {
    console.error('DELETE EXAM ERROR:', error);
    res.status(500).json({ error: 'Failed to delete exam and related records' });
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

// PUT /api/user/update-name (teachers may edit their own name; students cannot edit names)
app.put('/api/user/update-name', authenticateProfileRequest, async (req, res) => {
  try {
    const { firstName, middleInitial, lastName } = req.body;
    if (req.authenticatedUser.role !== 'teacher') {
      return res.status(403).json({ error: 'Only a teacher can update profile names' });
    }
    if (
      typeof firstName !== 'string' || !firstName.trim() ||
      typeof lastName !== 'string' || !lastName.trim()
    ) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const mi = typeof middleInitial === 'string' ? middleInitial.trim().toUpperCase().slice(0, 1) : '';
    const newName = [firstName.trim(), mi ? `${mi}.` : '', lastName.trim()].filter(Boolean).join(' ');
    const result = await db.query(
      `UPDATE Users
       SET name = $1, first_name = $2, middle_initial = $3, last_name = $4
       WHERE id = $5 AND role = 'teacher'
       RETURNING id, name, first_name, middle_initial, last_name, email, role`,
      [newName, firstName.trim(), mi || null, lastName.trim(), req.authenticatedUser.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Teacher not found' });
    }
    res.json({ success: true, user: result.rows[0] });
  } catch (error) {
    console.error('UPDATE NAME ERROR:', error);
    res.status(500).json({ error: 'Failed to update name' });
  }
});

// PUT /api/students/:studentId/name — teacher edits a student enrolled in their class
app.put('/api/students/:studentId/name', authenticateProfileRequest, async (req, res) => {
  try {
    if (req.authenticatedUser.role !== 'teacher') {
      return res.status(403).json({ error: 'Only teachers can update student names' });
    }

    const { classId, firstName, middleInitial, lastName } = req.body;
    const studentId = req.params.studentId;
    const normalizedFirstName = typeof firstName === 'string' ? firstName.trim().replace(/\s+/g, ' ') : '';
    const normalizedMiddleInitial = typeof middleInitial === 'string'
      ? middleInitial.trim().replace(/\.$/, '').toUpperCase()
      : '';
    const normalizedLastName = typeof lastName === 'string' ? lastName.trim().replace(/\s+/g, ' ') : '';
    if (!classId || !studentId || !normalizedFirstName || !normalizedLastName) {
      return res.status(400).json({ error: 'Class, student, first name, and last name are required' });
    }
    if (normalizedMiddleInitial && !/^[A-Z]$/.test(normalizedMiddleInitial)) {
      return res.status(400).json({ error: 'Middle initial must be a single letter' });
    }

    const classResult = await db.query(
      'SELECT id FROM Classes WHERE id = $1 AND teacher_id = $2',
      [classId, req.authenticatedUser.id]
    );
    if (classResult.rows.length === 0) {
      return res.status(403).json({ error: 'You can only edit students in your own class' });
    }

    const enrollmentResult = await db.query(
      'SELECT id FROM Students WHERE class_id = $1 AND user_id = $2',
      [classId, studentId]
    );
    if (enrollmentResult.rows.length === 0) {
      return res.status(403).json({ error: 'Student is not enrolled in this class' });
    }

    const normalizedName = [
      normalizedFirstName,
      normalizedMiddleInitial ? `${normalizedMiddleInitial}.` : '',
      normalizedLastName
    ].filter(Boolean).join(' ');
    const result = await db.query(
      `UPDATE Users
       SET name = $1, first_name = $2, middle_initial = $3, last_name = $4
       WHERE id = $5 AND role = 'student'
       RETURNING id, name, first_name, middle_initial, last_name, email, role`,
      [normalizedName, normalizedFirstName, normalizedMiddleInitial || null, normalizedLastName, studentId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Student not found' });

    res.json({ success: true, user: result.rows[0] });
  } catch (error) {
    console.error('UPDATE STUDENT NAME ERROR:', error);
    res.status(500).json({ error: 'Failed to update student name' });
  }
});

// PUT /api/user/update-password
app.put('/api/user/update-password', authenticateProfileRequest, async (req, res) => {
  try {
    const allowedFields = new Set(['userId', 'currentPassword', 'newPassword', 'password']);
    if (Object.keys(req.body).some((field) => !allowedFields.has(field))) {
      return res.status(403).json({ error: 'Only password fields may be updated' });
    }

    const { currentPassword } = req.body;
    const newPassword = req.body.newPassword || req.body.password;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (req.body.userId && String(req.body.userId) !== String(req.authenticatedUser.id)) {
      return res.status(403).json({ error: 'You can only update your own password' });
    }
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
      return res.status(400).json({ error: 'Password values must be strings' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }
    const result = await db.query(
      'SELECT password_hash, supabase_id FROM Users WHERE id = $1',
      [req.authenticatedUser.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (result.rows[0].supabase_id) {
      const passwordMatches = await verifySupabasePassword(req.authenticatedUser.email, currentPassword);
      if (!passwordMatches) return res.status(401).json({ error: 'Current password is incorrect' });

      const { error } = await supabase.auth.admin.updateUserById(
        result.rows[0].supabase_id,
        { password: newPassword }
      );
      if (error) throw error;
    } else {
      const passwordHash = result.rows[0].password_hash;
      const passwordMatches = passwordHash && await bcrypt.compare(currentPassword, passwordHash);
      if (!passwordMatches) return res.status(401).json({ error: 'Current password is incorrect' });

      const newHash = await bcrypt.hash(newPassword, 10);
      await db.query('UPDATE Users SET password_hash = $1 WHERE id = $2', [newHash, req.authenticatedUser.id]);
    }

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