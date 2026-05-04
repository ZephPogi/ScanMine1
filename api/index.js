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

// --- AUTHENTICATION ---[cite: 1]
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

// --- CLASSES & STUDENTS ---[cite: 1]
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

    // 1. Find the user ID based on the email provided
    const userRes = await db.query('SELECT id FROM Users WHERE email = $1 AND role = $2', [email, 'student']);
    
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: "No student account found with that email." });
    }

    const userId = userRes.rows[0].id;

    // 2. Insert the student into the specific class
    const result = await db.query(
      'INSERT INTO Students (class_id, user_id) VALUES ($1, $2) RETURNING *',
      [classId, userId]
    );

    res.json({ message: "Student added successfully", student: result.rows[0] });
  } catch (error) {
    console.error('ADD STUDENT ERROR:', error);
    if (error.code === '23505') { // Unique violation error code in Postgres
      return res.status(400).json({ error: "This student is already in this class." });
    }
    res.status(500).json({ error: 'Failed to add student to class' });
  }
});

// --- ADDED ROUTES FOR DASHBOARD FUNCTIONALITY ---

// 1. Get all students globally
app.get('/api/all-students', async (req, res) => {
  try {
    const query = `
      SELECT Students.id AS enrollment_id, Users.id AS user_id, Users.name, Users.email, Classes.name AS class_name
      FROM Students
      JOIN Users ON Students.user_id = Users.id
      JOIN Classes ON Students.class_id = Classes.id
      WHERE Users.role = 'student';`;
    const result = await db.query(query); 
    res.status(200).json(result.rows);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch students" });
  }
});

// 2. Get exams/quizzes for a specific class (Fixes SectionDetails.jsx:48)
app.get('/api/exams', async (req, res) => {
  try {
    const { classId } = req.query;
    const result = await db.query('SELECT * FROM Exams WHERE class_id = $1', [classId]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch exams" });
  }
});

// 3. Get students for a specific class
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

// --- TEACHER: GENERATE QUIZ ---[cite: 1]
app.post('/api/generate-quiz', upload.single('lessonFile'), async (req, res) => {
  try {
    const file = req.file;
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

// --- STUDENT: UPLOAD PAPER ---[cite: 1]
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

module.exports = app;

if (require.main === module) {
  app.listen(port, () => console.log(`ScanMine running on ${port}`));
}