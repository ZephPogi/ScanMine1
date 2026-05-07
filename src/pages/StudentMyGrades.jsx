import { useNavigate } from 'react-router-dom';
import StudentSidebar from './StudentSidebar';
import './StudentMyGrades.css';

const StudentMyGrades = () => {
  const navigate = useNavigate();

  const assessments = [
    { id: 1, name: 'Algebra Quiz 1',        date: 'Feb 10, 2025', totalScore: '15/20', grade: '75%',  gradeClass: 'grade-c',  status: 'Done',    statusClass: 'st-done'    },
    { id: 2, name: 'Algebra Quiz 2',        date: 'Feb 24, 2025', totalScore: '18/20', grade: '90%',  gradeClass: 'grade-a',  status: 'Done',    statusClass: 'st-done'    },
    { id: 3, name: 'Algebra Quiz 3',        date: 'Mar 5, 2025',  totalScore: '17/20', grade: '85%',  gradeClass: 'grade-b',  status: 'Done',    statusClass: 'st-done'    },
    { id: 4, name: 'Algebra Midterm Exam',  date: 'Mar 19, 2025', totalScore: '34/40', grade: '85%',  gradeClass: 'grade-b',  status: 'Pending', statusClass: 'st-pending', isHighlighted: true },
    { id: 5, name: 'Algebra Quiz 4',        date: 'Apr 22, 2025', totalScore: '08/20', grade: '40%',  gradeClass: 'grade-f',  status: 'Done',    statusClass: 'st-done'    },
    { id: 6, name: 'Algebra Weekly Quiz 5', date: 'Due Mar 28, 2025', totalScore: '—',   grade: '—',    gradeClass: '',         status: 'Pending', statusClass: 'st-pending' },
  ];

  const overallGrade = '85%';

  return (
    <div className="student-page-layout">
      <StudentSidebar />
      <div className="student-main">
        {/* Header */}
        <header className="smg-header">
          <div>
            <p className="smg-label">student / my grades</p>
            <h1>🏆 My Grades</h1>
            <button className="smg-back-btn" onClick={() => navigate('/student-classes')}>
              ← Back to Algebra 101
            </button>
          </div>
          <div className="student-avatar-circle">SJ</div>
        </header>

        {/* Class Selector */}
        <div className="smg-class-selector">
          <select className="smg-select">
            <option>Algebra 101</option>
            <option>World History</option>
            <option>Biology Basics</option>
          </select>
        </div>

        {/* Overall Grade Summary */}
        <div className="smg-summary-card">
          <h3 className="smg-summary-title">Overall Grade Summary</h3>
          <div className="smg-summary-body">
            <div className="smg-donut-wrapper">
              <svg viewBox="0 0 100 100" className="smg-donut">
                <circle cx="50" cy="50" r="40" fill="none" stroke="#e2e8f0" strokeWidth="12" />
                <circle cx="50" cy="50" r="40" fill="none" stroke="#4483f2" strokeWidth="12"
                  strokeDasharray={`${85 * 2.51} ${100 * 2.51 - 85 * 2.51}`}
                  strokeLinecap="round"
                  transform="rotate(-90 50 50)" />
                <text x="50" y="55" textAnchor="middle" fontSize="18" fontWeight="800" fill="#1e293b">{overallGrade}</text>
              </svg>
            </div>
            <div className="smg-summary-stats">
              <div className="smg-stat-row">
                <span className="smg-stat-label">Latest Score:</span>
                <span className="smg-stat-val">34 / 38</span>
              </div>
              <div className="smg-stat-row">
                <span className="smg-stat-label">Total Assessments:</span>
                <span className="smg-stat-val">6</span>
              </div>
            </div>
            <div className="smg-grade-dist">
              <div className="smg-dist-item grade-a-bg">A: 1</div>
              <div className="smg-dist-item grade-b-bg">B: 2</div>
              <div className="smg-dist-item grade-c-bg">C: 1</div>
              <div className="smg-dist-item grade-f-bg">F: 1</div>
            </div>
          </div>
        </div>

        {/* Detailed Assessment Results */}
        <div className="smg-table-card">
          <h3 className="smg-table-title">Detailed Assessment Results</h3>
          <div className="table-responsive-wrapper">
            <table className="smg-table">
            <thead>
              <tr>
                <th>Assessment</th>
                <th>Date</th>
                <th>Total Score</th>
                <th>Grade</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {assessments.map(a => (
                <tr key={a.id} className={a.isHighlighted ? 'smg-highlighted-row' : ''}>
                  <td className="smg-name-cell">{a.name}</td>
                  <td className="smg-date-cell">{a.date}</td>
                  <td>{a.totalScore}</td>
                  <td><span className={`smg-grade-badge ${a.gradeClass}`}>{a.grade}</span></td>
                  <td><span className={`smg-status-badge ${a.statusClass}`}>{a.status}</span></td>
                </tr>
              ))}
            </tbody>
            </table>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="smg-footer">
          <button className="smg-print-btn">🖨 Print Report</button>
          <button className="smg-export-btn">⬇ Download CSV</button>
        </div>
      </div>
    </div>
  );
};

export default StudentMyGrades;
