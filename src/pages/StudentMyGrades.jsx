import { useState, useEffect } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { ArrowLeft, Printer } from 'lucide-react';
import './StudentMyGrades.css';

const StudentMyGrades = () => {
  const navigate   = useNavigate();
  const { classId } = useParams();
  const location   = useLocation();
  const section    = location.state?.section;

  const user   = JSON.parse(localStorage.getItem('user') || '{}');
  const avatar = (user.name || 'S').substring(0, 2).toUpperCase();

  const [assessments, setAssessments] = useState([]);
  const [loading, setLoading]         = useState(true);

  useEffect(() => {
    if (user.id && classId) fetchGrades();
  }, [classId]);

  const fetchGrades = async () => {
    try {
      const res = await fetch(`/api/student/${user.id}/grades/${classId}`);
      if (res.ok) {
        const data = await res.json();
        setAssessments(data);
      }
    } catch (err) {
      console.error('Error fetching grades:', err);
    } finally {
      setLoading(false);
    }
  };

  // --- Helpers ---
  const getGradeInfo = (score, total) => {
    if (!total || Number(total) === 0) return { label: '—', cls: '' };
    const pct = (score / Number(total)) * 100;
    if (pct >= 90) return { label: 'A', cls: 'grade-a', pct };
    if (pct >= 80) return { label: 'B', cls: 'grade-b', pct };
    if (pct >= 70) return { label: 'C', cls: 'grade-c', pct };
    return { label: 'F', cls: 'grade-f', pct };
  };

  const formatDate = (iso) =>
    new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  // --- Summary computations ---
  const averagePct = assessments.length > 0
    ? assessments.reduce((sum, a) => {
        const pct = Number(a.total_questions) > 0
          ? (a.score / Number(a.total_questions)) * 100
          : 0;
        return sum + pct;
      }, 0) / assessments.length
    : 0;

  const latestSub = assessments[0] || null;

  const gradeDist = { A: 0, B: 0, C: 0, F: 0 };
  assessments.forEach(a => {
    const { label } = getGradeInfo(a.score, a.total_questions);
    if (label in gradeDist) gradeDist[label]++;
  });

  const circumference = 100 * 2.51; // 2πr where r=40 → ~251
  const dashFill      = (averagePct / 100) * circumference;
  const dashArray     = `${dashFill} ${circumference - dashFill}`;
  const className     = section?.name || 'Class';

  return (
    <div className="student-main">

      {/* Header */}
      <header className="smg-header">
        <div>
          <p className="smg-label">student / my grades</p>
          <h1>My Grades</h1>
          <button className="smg-back-btn" onClick={() => navigate('/student-classes')}>
            <ArrowLeft size={13} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
            Back to {className}
          </button>
        </div>
        <div className="student-avatar-circle">{avatar}</div>
      </header>

      {/* Overall Grade Summary */}
      <div className="smg-summary-card">
        <h3 className="smg-summary-title">Overall Grade Summary — {className}</h3>
        <div className="smg-summary-body">

          {/* Donut */}
          <div className="smg-donut-wrapper">
            <svg viewBox="0 0 100 100" className="smg-donut">
              <circle cx="50" cy="50" r="40" fill="none" stroke="#e2e8f0" strokeWidth="12" />
              {averagePct > 0 && (
                <circle
                  cx="50" cy="50" r="40"
                  fill="none" stroke="#4483f2" strokeWidth="12"
                  strokeDasharray={dashArray}
                  strokeLinecap="round"
                  transform="rotate(-90 50 50)"
                />
              )}
              <text x="50" y="55" textAnchor="middle" fontSize="16" fontWeight="800" fill="#1e293b">
                {loading ? '—' : `${averagePct.toFixed(0)}%`}
              </text>
            </svg>
          </div>

          {/* Stats */}
          <div className="smg-summary-stats">
            <div className="smg-stat-row">
              <span className="smg-stat-label">Latest Score:</span>
              <span className="smg-stat-val">
                {latestSub
                  ? `${latestSub.score} / ${latestSub.total_questions ?? '—'}`
                  : '—'}
              </span>
            </div>
            <div className="smg-stat-row">
              <span className="smg-stat-label">Total Assessments:</span>
              <span className="smg-stat-val">{assessments.length}</span>
            </div>
          </div>

          {/* Grade Distribution */}
          <div className="smg-grade-dist">
            {Object.entries(gradeDist).map(([grade, count]) => (
              <div key={grade} className={`smg-dist-item grade-${grade.toLowerCase()}-bg`}>
                {grade}: {count}
              </div>
            ))}
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
                <th>Date Submitted</th>
                <th>Score</th>
                <th>Grade</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="5" style={{ textAlign: 'center', padding: '24px', color: '#94a3b8' }}>
                    Loading grades...
                  </td>
                </tr>
              ) : assessments.length === 0 ? (
                <tr>
                  <td colSpan="5" style={{ textAlign: 'center', padding: '24px', color: '#94a3b8' }}>
                    No submissions found for this class.
                  </td>
                </tr>
              ) : (
                assessments.map(a => {
                  const { label, cls, pct } = getGradeInfo(a.score, a.total_questions);
                  return (
                    <tr key={a.id}>
                      <td className="smg-name-cell">{a.exam_title}</td>
                      <td className="smg-date-cell">{formatDate(a.created_at)}</td>
                      <td>{a.score} / {a.total_questions ?? '—'}</td>
                      <td>
                        <span className={`smg-grade-badge ${cls}`}>
                          {label !== '—' ? `${label} (${pct?.toFixed(0)}%)` : '—'}
                        </span>
                      </td>
                      <td><span className="smg-status-badge st-done">Submitted</span></td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Footer */}
      <div className="smg-footer">
        <button className="smg-print-btn" onClick={() => window.print()}>
          <Printer size={14} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
          Print Report
        </button>
      </div>

    </div>
  );
};

export default StudentMyGrades;
