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
    const { name, email, password, role } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await db.query(
      'INSERT INTO Users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role',
      [name, email, hashedPassword, role]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error('REGISTRATION ERROR:', error);
    res.status(500).json({ error: 'Server error during registration' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await db.query('SELECT * FROM Users WHERE email = $1', [email]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'User not found' });
    
    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid password' });
    
    if (user.role !== req.body.role) {
       return res.status(401).json({ error: `Account registered as ${user.role}, not ${req.body.role}` });
    }
    res.json({ id: user.id, name: user.name, role: user.role });
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

app.post('/api/students', async (req, res) => {
  try {
    const { email, classId } = req.body;

    const userRes = await db.query('SELECT id FROM Users WHERE email = $1 AND role = $2', [email, 'student']);
    
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: "No student account found with that email." });
    }

    const userId = userRes.rows[0].id;

    const result = await db.query(
      'INSERT INTO Students (class_id, user_id) VALUES ($1, $2) RETURNING *',
      [classId, userId]
    );

    res.json({ message: "Student added successfully", student: result.rows[0] });
  } catch (error) {
    console.error('ADD STUDENT ERROR:', error);
    if (error.code === '23505') { 
      return res.status(400).json({ error: "This student is already in this class." });
    }
    res.status(500).json({ error: 'Failed to add student to class' });
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
      SELECT Students.id AS enrollment_id, Users.id AS user_id, Users.name, Users.email
      FROM Students
      JOIN Users ON Students.user_id = Users.id
      WHERE Students.class_id = $1;`;
    const result = await db.query(query, [req.params.id]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch class students" });
  }
});

// --- TEACHER: GENERATE QUIZ ---
app.post('/api/generate-quiz', upload.single('lessonFile'), async (req, res) => {
  try {
    const file = req.file;
    // Keys match your frontend FormData
    const { title, teacherId, classId } = req.body; 
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
    if (text) questions = await generateQuizFromText(text, examId);
    res.json({ message: 'Exam created successfully', examId, questions });
  } catch (error) {
    console.error('QUIZ GENERATION ERROR:', error);
    res.status(500).json({ error: 'Failed to create exam' });
  }
});

// --- STUDENT: UPLOAD PAPER ---
app.post('/api/upload-paper', upload.single('studentPaper'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No image uploaded' });
    const { studentId, examId } = req.body;
    const { publicUrl } = await uploadFile(file.buffer, file.originalname, file.mimetype);
    const result = await gradeSubmission(examId, studentId, file.buffer, publicUrl);
    res.json({ message: 'Paper graded successfully', result });
  } catch (error) {
    console.error('GRADING ERROR:', error);
    res.status(500).json({ error: 'Failed to process paper' });
  }
});

// --- MISSING OCR & QUESTION ROUTES ADDED HERE ---

// 1. Get Questions for a specific exam
app.get('/api/exams/:id/questions', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query('SELECT * FROM generated_questions WHERE exam_id = $1 ORDER BY id ASC', [id]);
    res.json(result.rows);
  } catch (error) {
    console.error("Fetch questions error:", error);
    res.status(500).json({ error: "Failed to fetch questions" });
  }
});

// 2. OCR Extraction Endpoint
app.post('/api/test-ocr', upload.any(), async (req, res) => {
  try {
    // upload.any() catches the file safely no matter what your frontend named it
    const file = req.files && req.files.length > 0 ? req.files[0] : null;
    if (!file) return res.status(400).json({ error: 'No file uploaded' });
    
    // Uses the extractText function we already have imported at the top!
    const text = await extractText(file.buffer, file.mimetype);
    
    // Returns clean JSON so your frontend stops throwing the '<' error
    res.json({ text: text, message: "OCR Extracted Successfully" });
  } catch (error) {
    console.error('OCR ERROR:', error);
    res.status(500).json({ error: 'Failed to extract text' });
  }
});

module.exports = app;

if (require.main === module) {
  app.listen(port, () => console.log(`ScanMine running on ${port}`));
}