const express = require('express');
const cors = require('cors');
const multer = require('multer');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const db = require('./db');
require('dotenv').config();

const { extractText, generateQuizFromText } = require('./scripts/generateQuestions');
const { extractTextFromImage, gradeSubmission } = require('./scripts/autoGradeSubmission');

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const upload = multer({ dest: 'uploads/' });

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
    console.error(error);
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

// --- TEACHER: GENERATE QUIZ ---

app.post('/api/generate-quiz', upload.single('lessonFile'), async (req, res) => {
  try {
    // 1. Get file
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No file uploaded' });
    
    const { title, teacherId } = req.body;

    // 2. Extract Text
    const text = await extractText(file.path, file.mimetype);

    // 3. Save Exam
    const examRes = await db.query(
      'INSERT INTO Exams (teacher_id, title, raw_text_content) VALUES ($1, $2, $3) RETURNING id',
      [teacherId, title || 'Generated Quiz', text]
    );
    const examId = examRes.rows[0].id;

    // 4. Apply Rules & Generate Questions
    const questions = await generateQuizFromText(text, examId);

    res.json({ message: 'Quiz generated successfully', examId, questions });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to generate quiz' });
  }
});

// --- TEACHER: UPLOAD ANSWER KEY ---
app.post('/api/upload-answer-key', async (req, res) => {
  try {
    const { examId, answers } = req.body; // answers is an array of strings
    for (let ans of answers) {
      await db.query('INSERT INTO Answer_Keys (exam_id, answer_text) VALUES ($1, $2)', [examId, ans]);
    }
    res.json({ message: 'Answer keys saved successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to upload answer key' });
  }
});

// --- STUDENT: UPLOAD PAPER (AUTO-GRADE) ---

app.post('/api/upload-paper', upload.single('studentPaper'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No image uploaded' });

    const { studentId, examId } = req.body;

    // 1. Extract text from picture
    const studentText = await extractTextFromImage(file.path);

    // 2. Compare and Grade
    const result = await gradeSubmission(examId, studentId, studentText);

    res.json({ message: 'Paper graded successfully', result });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to process and grade paper' });
  }
});

app.listen(port, () => {
  console.log(`ScanMine backend running on port ${port}`);
});
