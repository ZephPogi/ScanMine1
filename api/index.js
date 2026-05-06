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
app.get('/api/submissions/:examId', async (req, res) => {
  try {
    const { examId } = req.params;
    
    // Grabs the submissions and joins the Users table so your frontend knows the student's name!
    const query = `
      SELECT sub.*, u.name as student_name, u.email
      FROM student_submissions sub
      JOIN Users u ON sub.student_id = u.id
      WHERE sub.exam_id = $1
      ORDER BY sub.created_at DESC;
    `;
    
    const result = await db.query(query, [examId]);
    res.json(result.rows);
    
  } catch (error) {
    console.error("Fetch submissions error:", error);
    res.status(500).json({ error: "Failed to fetch submissions" });
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

module.exports = app;

if (require.main === module) {
  app.listen(port, () => console.log(`ScanMine running on ${port}`));
}