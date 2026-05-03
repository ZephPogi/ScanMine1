const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const db = require('./db');
// dotenv loaded at top

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

// Use memory storage for Supabase uploads
const storage = multer.memoryStorage();

// Limit file size to 5MB and only accept images
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|bmp|tiff|webp|pdf/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (extname && mimetype) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files (JPEG, PNG, GIF, BMP, TIFF, WebP) and PDFs are allowed'));
    }
  }
});

// --- AUTHENTICATION (Example implementation for hashed passwords) ---

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
    console.error(error);
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
    
    // Make sure the role matches what they selected on the frontend
    if (user.role !== req.body.role) {
       return res.status(401).json({ error: `Account registered as ${user.role}, not ${req.body.role}` });
    }

    res.json({ id: user.id, name: user.name, role: user.role });
  } catch (error) {
    console.error('LOGIN ERROR:', error);
    res.status(500).json({ error: 'Server error during login' });
  }
});

app.post('/api/forgot-password', async (req, res) => {
  try {
    const { email, role } = req.body;
    
    // Find user
    const result = await db.query('SELECT * FROM Users WHERE email = $1 AND role = $2', [email, role]);
    
    if (result.rows.length > 0) {
      const user = result.rows[0];
      
      // Generate secure token
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 3600000); // 1 hour from now
      
      await db.query(
        'INSERT INTO Password_Resets (user_id, token, expires_at) VALUES ($1, $2, $3)',
        [user.id, token, expiresAt]
      );

      const resetLink = `http://localhost:3000/reset-password/${token}`;

      // Use Gmail SMTP to send real emails
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.EMAIL_USER, // Your Gmail address
          pass: process.env.EMAIL_PASS, // Your Gmail App Password
        },
      });

      await transporter.sendMail({
        from: `"ScanMine System" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: "ScanMine Password Reset Request",
        html: `
          <h2>Password Reset</h2>
          <p>You requested a password reset. Click the link below to securely reset your password:</p>
          <a href="${resetLink}">${resetLink}</a>
          <p>This link will expire in 1 hour.</p>
        `,
      });

      console.log(`[REAL EMAIL] Password reset link sent directly to ${email}!`);
    }

    res.json({ message: 'If an account matches, a reset link was sent.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error during password reset request' });
  }
});

app.post('/api/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    
    // Find valid token
    const result = await db.query(
      'SELECT * FROM Password_Resets WHERE token = $1 AND expires_at > NOW()',
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    const resetRecord = result.rows[0];
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update user password
    await db.query('UPDATE Users SET password_hash = $1 WHERE id = $2', [hashedPassword, resetRecord.user_id]);

    // Delete token
    await db.query('DELETE FROM Password_Resets WHERE token = $1', [token]);

    res.json({ message: 'Password has been successfully reset.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error during password reset' });
  }
});

// --- CLASSES & STUDENTS ---

app.get('/api/classes', async (req, res) => {
  try {
    const { teacherId } = req.query;
    if (!teacherId || teacherId === 'undefined' || teacherId === 'null') {
      return res.json([]);
    }
    const result = await db.query('SELECT * FROM Classes WHERE teacher_id = $1', [teacherId]);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
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
    console.error(error);
    res.status(500).json({ error: 'Failed to create class' });
  }
});

app.get('/api/classes/:classId/students', async (req, res) => {
  try {
    const { classId } = req.params;
    const result = await db.query(`
      SELECT u.id, u.name, u.email 
      FROM Users u 
      JOIN Students s ON u.id = s.user_id 
      WHERE s.class_id = $1
    `, [classId]);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch class students' });
  }
});

app.get('/api/all-students', async (req, res) => {
  try {
    const result = await db.query("SELECT id, name, email FROM Users WHERE role = 'student'");
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch all students' });
  }
});

app.post('/api/classes/:classId/students', async (req, res) => {
  try {
    const { classId } = req.params;
    const { studentId } = req.body;
    await db.query(
      'INSERT INTO Students (class_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [classId, studentId]
    );
    res.json({ message: 'Student added to class successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to add student to class' });
  }
});

// --- TEACHER: GENERATE QUIZ ---

app.post('/api/generate-quiz', upload.single('lessonFile'), async (req, res) => {
  try {
    const file = req.file;
    const { title, teacherId, classId } = req.body;

    let text = '';
    let fileUrl = null;

    if (file) {
      // Upload to Supabase storage
      const { publicUrl } = await uploadFile(file.buffer, file.originalname, file.mimetype);
      fileUrl = publicUrl;

      // Extract text from the file buffer
      text = await extractText(file.buffer, file.mimetype);
    }

    const examRes = await db.query(
      'INSERT INTO Exams (teacher_id, class_id, title, raw_text_content, file_path) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [teacherId, classId, title || 'Generated Quiz', text, fileUrl]
    );
    const examId = examRes.rows[0].id;

    let questions = [];
    if (text) {
      questions = await generateQuizFromText(text, examId);
    }

    res.json({ message: 'Exam created successfully', examId, questions });
  } catch (error) {
    console.error('Error generating quiz:', error);
    res.status(500).json({ error: 'Failed to create exam' });
  }
});

app.get('/api/exams', async (req, res) => {
  try {
    const { classId } = req.query;
    const result = await db.query('SELECT * FROM Exams WHERE class_id = $1', [classId]);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch exams' });
  }
});

app.get('/api/exams/:examId/questions', async (req, res) => {
  try {
    const { examId } = req.params;
    // Check both manual and generated
    const manual = await db.query('SELECT id, answer_text as correct_answer, question_text, \'Manual\' as type FROM Answer_Keys WHERE exam_id = $1', [examId]);
    const generated = await db.query('SELECT id, question_text, correct_answer, \'AI\' as type FROM Generated_Questions WHERE exam_id = $1', [examId]);
    
    res.json({
        manual: manual.rows,
        generated: generated.rows
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch exam questions' });
  }
});

app.delete('/api/exams/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // 1. Get file URLs to delete from Supabase
    const exam = await db.query('SELECT file_path FROM Exams WHERE id = $1', [id]);
    const submissions = await db.query('SELECT image_url FROM Student_Submissions WHERE exam_id = $1', [id]);
    const answerKeys = await db.query('SELECT image_url FROM Answer_Keys WHERE exam_id = $1', [id]);

    // Delete from Supabase Storage
    if (exam.rows.length > 0 && exam.rows[0].file_path) {
      try {
        const filePath = exam.rows[0].file_path.split(`/${BUCKET_NAME}/`)[1];
        if (filePath) await deleteFile(filePath);
      } catch (err) {
        console.error('Error deleting exam file from Supabase:', err);
      }
    }

    for (const sub of submissions.rows) {
      if (sub.image_url) {
        try {
          const filePath = sub.image_url.split(`/${BUCKET_NAME}/`)[1];
          if (filePath) await deleteFile(filePath);
        } catch (err) {
          console.error('Error deleting submission file from Supabase:', err);
        }
      }
    }

    for (const key of answerKeys.rows) {
      if (key.image_url) {
        try {
          const filePath = key.image_url.split(`/${BUCKET_NAME}/`)[1];
          if (filePath) await deleteFile(filePath);
        } catch (err) {
          console.error('Error deleting answer key file from Supabase:', err);
        }
      }
    }

    // 2. Delete related data
    await db.query('DELETE FROM Student_Submissions WHERE exam_id = $1', [id]);
    await db.query('DELETE FROM Generated_Questions WHERE exam_id = $1', [id]);
    await db.query('DELETE FROM Answer_Keys WHERE exam_id = $1', [id]);
    await db.query('DELETE FROM Exams WHERE id = $1', [id]);

    res.json({ message: 'Exam deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete exam' });
  }
});



// --- TEACHER: UPLOAD ANSWER KEY ---
app.post('/api/upload-answer-key', async (req, res) => {
  try {
    const { examId, answers } = req.body; 
    // If answers is a string (manual), split it. If array, use as is.
    let answerArray = [];
    if (typeof answers === 'string') {
      answerArray = answers.split(/[\s,]+/).filter(a => a.trim() !== '');
    } else {
      answerArray = answers;
    }

    // Clear existing keys for this exam if any (overwrite logic)
    await db.query('DELETE FROM Answer_Keys WHERE exam_id = $1', [examId]);

    for (let ans of answerArray) {
      await db.query('INSERT INTO Answer_Keys (exam_id, answer_text) VALUES ($1, $2)', [examId, ans]);
    }
    res.json({ message: 'Answer keys saved successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to upload answer key' });
  }
});
// --- TEACHER: FETCH SUBMISSIONS ---
app.get('/api/submissions/:classId', async (req, res) => {
  try {
    const { classId } = req.params;
    const result = await db.query(`
      SELECT ss.*, u.name as student_name, e.title as exam_title
      FROM Student_Submissions ss
      JOIN Users u ON ss.student_id = u.id
      JOIN Exams e ON ss.exam_id = e.id
      WHERE e.class_id = $1
      ORDER BY ss.created_at DESC
    `, [classId]);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch submissions' });
  }
});

app.delete('/api/submissions/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Get image URL to delete from Supabase
    const submission = await db.query('SELECT image_url FROM Student_Submissions WHERE id = $1', [id]);

    // Delete from Supabase Storage
    if (submission.rows.length > 0 && submission.rows[0].image_url) {
      try {
        const filePath = submission.rows[0].image_url.split(`/${BUCKET_NAME}/`)[1];
        if (filePath) await deleteFile(filePath);
      } catch (err) {
        console.error('Error deleting submission file from Supabase:', err);
      }
    }

    await db.query('DELETE FROM Student_Submissions WHERE id = $1', [id]);
    res.json({ message: 'Submission deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete submission' });
  }
});

// --- MANUAL GRADING ---
app.post('/api/grade-manual', async (req, res) => {
  try {
    const { studentId, examId, answers } = req.body;
    if (!studentId || !examId || !answers) {
      return res.status(400).json({ error: 'studentId, examId and answers are required' });
    }

    // Get Answer Keys
    let keysRes = await db.query('SELECT * FROM Answer_Keys WHERE exam_id = $1 ORDER BY id ASC', [examId]);
    let answerKeys = keysRes.rows;
    if (answerKeys.length === 0) {
      const genRes = await db.query('SELECT id, correct_answer as answer_text FROM Generated_Questions WHERE exam_id = $1 ORDER BY id ASC', [examId]);
      answerKeys = genRes.rows;
    }
    if (answerKeys.length === 0) {
      return res.status(400).json({ error: 'No Answer Key found for this exam.' });
    }

    // Parse student answers (comma separated, supports words AND letters)
    const studentAnswers = answers.split(',').map(a => a.trim()).filter(Boolean);

    let correctCount = 0;
    const feedbackLines = [];
    const levenshtein = require('fast-levenshtein');

    for (let i = 0; i < answerKeys.length; i++) {
      const correct = (answerKeys[i].answer_text || '').toString().trim().toLowerCase();
      const student = (studentAnswers[i] || '').trim().toLowerCase();
      
      // Allow fuzzy match: exact OR within 2 edit distance for words
      const distance = levenshtein.get(student, correct);
      const maxAllowed = correct.length <= 2 ? 0 : 2; // strict for single letters
      const isCorrect = student !== '' && distance <= maxAllowed;
      
      if (isCorrect) correctCount++;
      feedbackLines.push(`Q${i+1}: "${studentAnswers[i] || '?'}" vs "${answerKeys[i].answer_text}" → ${isCorrect ? '✅' : '❌'}`);
    }

    const maxScore = answerKeys.length;
    const totalScore = correctCount;
    const percentage = maxScore > 0 ? (totalScore / maxScore) * 100 : 0;
    const feedback = feedbackLines.join('\n');

    // Upsert result
    await db.query(
      `INSERT INTO Student_Submissions (student_id, exam_id, extracted_text, score, feedback)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (student_id, exam_id)
       DO UPDATE SET extracted_text = $3, score = $4, feedback = $5, created_at = NOW()`,
      [studentId, examId, answers, percentage, feedback]
    );
    const sub = await db.query('SELECT id FROM Student_Submissions WHERE student_id = $1 AND exam_id = $2', [studentId, examId]);

    res.json({ message: 'Graded successfully', result: { totalScore, maxScore, feedback, submission_id: sub.rows[0]?.id } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to grade manually' });
  }
});

// --- STUDENT: UPLOAD PAPER (AUTO-GRADE) ---

app.post('/api/upload-paper', upload.single('studentPaper'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No image uploaded' });

    const { studentId, examId } = req.body;

    // Upload to Supabase storage
    const { publicUrl } = await uploadFile(file.buffer, file.originalname, file.mimetype);

    // Grade using the file buffer
    const result = await gradeSubmission(examId, studentId, file.buffer, publicUrl);

    res.json({ message: 'Paper graded successfully', result });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to process and grade paper' });
  }
});

// --- TEST: OCR.space Direct Test ---
app.post('/api/test-ocr', upload.single('image'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No image uploaded' });

    const { examId } = req.body;

    // Upload to Supabase storage
    const { publicUrl } = await uploadFile(file.buffer, file.originalname, file.mimetype);

    const ocrService = new OCRSpaceService();
    const text = await ocrService.recognizeHandwritingFromBuffer(file.buffer);

    // Parse the OCR text to extract full question-answer pairs
    const parsedQuestions = parseFullQuestions(text);

    console.log('Parsed questions:', parsedQuestions);

    // If examId is provided, save the answers and question text to the database
    if (examId && parsedQuestions.length > 0) {
      // Clear existing answer keys for this exam
      await db.query('DELETE FROM Answer_Keys WHERE exam_id = $1', [examId]);

      // Insert each parsed answer with question text and image URL
      for (const item of parsedQuestions) {
        await db.query(
          'INSERT INTO Answer_Keys (exam_id, answer_text, question_text, image_url) VALUES ($1, $2, $3, $4)',
          [examId, item.answer, item.questionText, publicUrl]
        );
      }

      console.log(`Saved ${parsedQuestions.length} answers with question text to database for exam ${examId}`);
    }

    res.json({
      message: 'OCR test successful',
      extractedText: text,
      parsedQuestions: parsedQuestions,
      answersCount: parsedQuestions.length,
      examId: examId || null,
      imageUrl: publicUrl
    });
  } catch (error) {
    console.error('OCR Test Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Export for Vercel serverless deployment
module.exports = app;

// Only listen if not in serverless environment
if (require.main === module) {
  app.listen(port, () => {
    console.log(`ScanMine backend running on port ${port}`);
  });
}
