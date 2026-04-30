import { useNavigate } from 'react-router-dom';
import StudentSidebar from './StudentSidebar';
import './StudentViewClass.css';

const StudentViewClass = () => {
  const navigate = useNavigate();

  const classInfo = {
    title: 'Algebra 101',
    professor: 'Dr. Sarah Johnson',
    schedule: 'Monday & Wednesday, 10:00 AM – 11:30 AM',
  };

  const upcomingExams = [
    { id: 1, title: 'Algebra Midterm Exam', due: 'Due: Tomorrow, 11:59 PM', urgent: true },
    { id: 2, title: 'Algebra Weekly Quiz 5', due: 'Due: Friday, 11:59 PM', urgent: false },
  ];

  const grades = [
    { id: 1, assessment: 'Algebra Quiz 1', score: '15/20', grade: '75%', gradeClass: 'vc-grade-c', status: 'C', statusClass: 'vc-st-c' },
    { id: 2, assessment: 'Algebra Quiz 2', score: '18/20', grade: '90%', gradeClass: 'vc-grade-a', status: 'A', statusClass: 'vc-st-a' },
  ];

  return (
    <div className="student-page-layout">
      <StudentSidebar />
      <div className="student-main">
        {/* Header */}
        <header className="svc-header">
          <div>
            <p className="svc-label">student view class</p>
            <h1>📐 {classInfo.title}</h1>
            <button className="svc-back-btn" onClick={() => navigate('/student-classes')}>
              ← Back to My Classes
            </button>
          </div>
          <div className="student-avatar-circle">SJ</div>
        </header>

        {/* Class Information */}
        <div className="svc-card svc-info-card">
          <h3 className="svc-card-title">Class Information</h3>
          <p className="svc-info-text">Professor: {classInfo.professor}</p>
          <p className="svc-info-text">Schedule: {classInfo.schedule}</p>
        </div>

        {/* Upcoming Exams */}
        <div className="svc-card">
          <h3 className="svc-card-title">📋 Upcoming Exams</h3>
          <div className="svc-exam-list">
            {upcomingExams.map(exam => (
              <div className="svc-exam-row" key={exam.id}>
                <div className="svc-exam-info">
                  <span className="svc-exam-title">{exam.title}</span>
                  <span className={`svc-exam-due ${exam.urgent ? 'svc-due-urgent' : ''}`}>
                    {exam.due}
                  </span>
                </div>
                <div className="svc-exam-actions">
                  <button className="svc-btn svc-take">Take Exam</button>
                  <button className="svc-btn svc-upload">Upload Paper</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* My Grades */}
        <div className="svc-card">
          <h3 className="svc-card-title">🏆 My Grades – {classInfo.title}</h3>
          <table className="svc-grades-table">
            <thead>
              <tr>
                <th>Assessment</th>
                <th>Score</th>
                <th>Grade</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {grades.map(g => (
                <tr key={g.id}>
                  <td className="svc-assessment-name">{g.assessment}</td>
                  <td>{g.score}</td>
                  <td><span className={`svc-grade-pct ${g.gradeClass}`}>{g.grade}</span></td>
                  <td><span className={`svc-status-letter ${g.statusClass}`}>{g.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default StudentViewClass;
