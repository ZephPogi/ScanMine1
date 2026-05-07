import { useState, useRef, useEffect } from 'react';
import { Camera } from 'lucide-react';
import StudentSidebar from './StudentSidebar';
import './StudentDashboard.css';

const StudentDashboard = () => {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const student = { name: user.name || 'Student', avatar: (user.name || 'S').substring(0, 2).toUpperCase() };

  // Upload modal state
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadFile, setUploadFile] = useState(null);
  const [activeExam, setActiveExam] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const uploadRef = useRef(null);

  const [pendingExams, setPendingExams] = useState([]);

  useEffect(() => {
    fetchPendingExams();
  }, []);

  const fetchPendingExams = async () => {
    try {
      // In a full app, we'd fetch based on student's classes. 
      // For now, we fetch all exams to make testing easier for the user.
      const response = await fetch('/api/exams'); 
      if (response.ok) {
        const data = await response.json();
        setPendingExams(data.map(e => ({
          id: e.id,
          title: e.title,
          due: 'Active',
          status: 'Not submitted',
          statusClass: 'status-pending'
        })));
      }
    } catch (error) {
      console.error('Error fetching exams:', error);
    }
  };

  const openUploadModal = (exam) => {
    setActiveExam(exam);
    setShowUploadModal(true);
  };

  const closeUploadModal = () => {
    setShowUploadModal(false);
    setUploadFile(null);
    setActiveExam(null);
  };

  const handleSubmitAutoGrade = async () => {
    if (!uploadFile || !activeExam) return alert('Please select a file');
    
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('studentPaper', uploadFile);
      formData.append('studentId', user.id);
      formData.append('examId', activeExam.id);

      const response = await fetch('/api/upload-paper', {
        method: 'POST',
        body: formData
      });

      const data = await response.json();
      if (response.ok) {
        const total = data.result.totalScore || 0;
        const max = data.result.maxScore || 1;
        const perc = ((total / max) * 100).toFixed(0);
        alert(`Grading Complete! Your Score: ${perc}%`);
        console.log('Feedback:', data.result.feedback);
      } else {
        alert('Grading failed: ' + data.error);
      }
    } catch (error) {
      console.error('Upload error:', error);
      alert('Error uploading paper');
    } finally {
      setIsUploading(false);
      closeUploadModal();
    }
  };

  const leaderboard = [
    { rank: 1, name: 'Mike Chen',          avg: '96%', isMe: false },
    { rank: 2, name: `${student.name} (You)`, avg: '90%', isMe: true  },
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
            {pendingExams.length === 0 && <p style={{padding: '10px'}}>No pending exams found.</p>}
            {pendingExams.map(exam => (
              <div className="exam-row" key={exam.id}>
                <div className="exam-info">
                  <span className="exam-title">{exam.title}</span>
                  <span className="exam-due">{exam.due}</span>
                  <span className={`exam-status ${exam.statusClass}`}>{exam.status}</span>
                </div>
                <div className="exam-actions">
                  <button className="btn-upload-paper" onClick={() => openUploadModal(exam)}>
                    <Camera size={16} />
                    <span>Upload Paper Photo</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Class Leaderboard */}
        <section className="student-card">
          <h3 className="student-section-title">🏆 Class Leaderboard</h3>
          <div className="table-responsive-wrapper">
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
          </div>
        </section>
      </div>

      {/* ===== UPLOAD ANSWER SHEET MODAL ===== */}
      {showUploadModal && (
        <div className="upload-modal-overlay" onClick={closeUploadModal}>
          <div className="upload-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="upload-modal-header">
              <span className="upload-prof-label">student</span>
            </div>

            <div className="upload-title-banner">
              <Camera size={20} />
              <span>Upload Answer Sheet</span>
              <button className="upload-close-btn" onClick={closeUploadModal}>×</button>
            </div>

            <div className="upload-exam-info">
              <h4 className="upload-exam-title">Exam: {activeExam?.title}</h4>
              <p className="upload-exam-sub">Take a photo or upload your answered paper</p>
            </div>

            <div
              className="upload-drop-zone"
              onClick={() => !isUploading && uploadRef.current.click()}
            >
              <input
                type="file"
                ref={uploadRef}
                accept=".jpg,.jpeg,.png,.pdf"
                style={{ display: 'none' }}
                onChange={(e) => { if (e.target.files[0]) setUploadFile(e.target.files[0]); }}
              />
              <div className="upload-camera-icon"><Camera size={32} /></div>
              <p className="upload-take-photo">
                {uploadFile ? uploadFile.name : 'Take Photo'}
              </p>
              <p className="upload-or">or</p>
              <p className="upload-gallery-link">📱 Upload from Gallery</p>
              <p className="upload-supported">Supported: JPG, PNG, PDF (max 10MB)</p>
            </div>

            <div className="upload-modal-footer">
              <button 
                className="upload-submit-btn" 
                onClick={handleSubmitAutoGrade}
                disabled={isUploading || !uploadFile}
              >
                {isUploading ? 'Processing...' : 'Submit for Auto-Grading'}
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
