import { useState, useRef } from 'react';
import StudentSidebar from './StudentSidebar';
import './StudentDashboard.css';

const StudentDashboard = () => {
  const student = { name: 'Sarah', avatar: 'SJ' };

  // Upload modal state
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadFile, setUploadFile] = useState(null);
  const [activeExamTitle, setActiveExamTitle] = useState('');
  const uploadRef = useRef(null);

  const openUploadModal = (examTitle) => {
    setActiveExamTitle(examTitle);
    setShowUploadModal(true);
  };

  const closeUploadModal = () => {
    setShowUploadModal(false);
    setUploadFile(null);
    setActiveExamTitle('');
  };

  const handleSubmitAutoGrade = () => {
    console.log('Submitting for auto-grade:', uploadFile);
    closeUploadModal();
  };

  const pendingExams = [
    { id: 1, title: 'Algebra Midterm Exam', due: 'Due: Tomorrow, 11:59 PM', status: 'Not submitted', statusClass: 'status-pending', hasQuiz: true },
    { id: 2, title: 'World History - Chapter 5', due: 'Due: Friday, 11:59 PM', statusClass: 'status-overdue', status: 'Overdue', hasQuiz: true },
  ];

  const leaderboard = [
    { rank: 1, name: 'Mike Chen',          avg: '96%', isMe: false },
    { rank: 2, name: 'Sarah Johnson (You)', avg: '90%', isMe: true  },
    { rank: 3, name: 'Emma Davis',          avg: '88%', isMe: false },
    { rank: 4, name: 'James Wilson',        avg: '82%', isMe: false },
    { rank: 5, name: 'Olivia Brown',        avg: '78%', isMe: false },
  ];

  return (
    <div className="student-page-layout">
      <StudentSidebar />
      <div className="student-main">
        {/* Header */}
        <header className="student-dash-header">
          <div>
            <p className="student-dash-label">student / student view</p>
            <h1>Welcome back, {student.name}!</h1>
          </div>
          <div className="student-avatar-circle">{student.avatar}</div>
        </header>

        {/* Pending Quizzes & Exams */}
        <section className="student-card">
          <h3 className="student-section-title">📋 Pending Quizzes & Exams</h3>
          <div className="exam-list">
            {pendingExams.map(exam => (
              <div className="exam-row" key={exam.id}>
                <div className="exam-info">
                  <span className="exam-title">{exam.title}</span>
                  <span className="exam-due">{exam.due}</span>
                  <span className={`exam-status ${exam.statusClass}`}>{exam.status}</span>
                </div>
                <div className="exam-actions">
                  {exam.status === 'Overdue'
                    ? <button className="btn-submit-late">Submit</button>
                    : <>
                        <button className="btn-take-quiz">Take Quiz</button>
                        <button className="btn-upload-paper" onClick={() => openUploadModal(exam.title)}>📷 Upload Paper Photo</button>
                      </>
                  }
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Class Leaderboard */}
        <section className="student-card">
          <h3 className="student-section-title">🏆 Class Leaderboard</h3>
          <table className="leaderboard-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Student</th>
                <th>Avg. Score</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.map(entry => (
                <tr key={entry.rank} className={entry.isMe ? 'leaderboard-me' : ''}>
                  <td className="rank-cell">
                    {entry.rank === 1 ? '🥇' : entry.rank === 2 ? '🥈' : entry.rank === 3 ? '🥉' : entry.rank}
                  </td>
                  <td className="leaderboard-name">
                    {entry.name}
                    {entry.isMe && <span className="you-badge">You</span>}
                  </td>
                  <td>
                    <span className={`avg-badge ${entry.avg >= '90%' ? 'avg-high' : entry.avg >= '80%' ? 'avg-mid' : 'avg-low'}`}>
                      {entry.avg}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      {/* ===== UPLOAD ANSWER SHEET MODAL ===== */}
      {showUploadModal && (
        <div className="upload-modal-overlay" onClick={closeUploadModal}>
          <div className="upload-modal-content" onClick={(e) => e.stopPropagation()}>
            {/* Header bar */}
            <div className="upload-modal-header">
              <span className="upload-prof-label">student</span>
            </div>

            <div className="upload-title-banner">
              <span>📷 Upload Answer Sheet</span>
              <button className="upload-close-btn" onClick={closeUploadModal}>×</button>
            </div>

            {/* Exam label */}
            <div className="upload-exam-info">
              <h4 className="upload-exam-title">Exam: {activeExamTitle}</h4>
              <p className="upload-exam-sub">Take a photo or upload your answered paper</p>
            </div>

            {/* Drop / Camera zone */}
            <div
              className="upload-drop-zone"
              onClick={() => uploadRef.current.click()}
            >
              <input
                type="file"
                ref={uploadRef}
                accept=".jpg,.jpeg,.png,.pdf"
                style={{ display: 'none' }}
                onChange={(e) => { if (e.target.files[0]) setUploadFile(e.target.files[0]); }}
              />
              <div className="upload-camera-icon">📷</div>
              <p className="upload-take-photo">
                {uploadFile ? uploadFile.name : 'Take Photo'}
              </p>
              <p className="upload-or">or</p>
              <p className="upload-gallery-link">📱 Upload from Gallery</p>
              <p className="upload-supported">Supported: JPG, PNG, PDF (max 10MB)</p>
            </div>

            {/* Submit */}
            <div className="upload-modal-footer">
              <button className="upload-submit-btn" onClick={handleSubmitAutoGrade}>
                Submit for Auto-Grading
              </button>
              <p className="upload-submit-hint">ScanMine will automatically grade and record your score</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StudentDashboard;
