import { useState, useEffect } from 'react';
import { BookOpen, TrendingUp, CheckCircle } from 'lucide-react';
import './StudentDashboard.css';

const StudentDashboard = () => {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const avatar = (user.name || 'S').substring(0, 2).toUpperCase();

  const [dashData, setDashData] = useState({
    activeClasses: 0,
    averageGrade: '0.0',
    totalSubmissions: 0,
    recentSubmissions: []
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user.id) fetchDashboard();
  }, []);

  const fetchDashboard = async () => {
    try {
      const res = await fetch(`/api/student/dashboard?studentId=${user.id}`);
      if (res.ok) {
        const data = await res.json();
        setDashData(data);
      }
    } catch (err) {
      console.error('Error fetching student dashboard:', err);
    } finally {
      setLoading(false);
    }
  };

  const stats = [
    { id: 1, label: 'Active Classes',  value: dashData.activeClasses,    icon: BookOpen    },
    { id: 2, label: 'Average Grade',   value: `${parseFloat(dashData.averageGrade).toFixed(1)}%`, icon: TrendingUp  },
    { id: 3, label: 'Total Scans',     value: dashData.totalSubmissions,  icon: CheckCircle },
  ];

  const formatDate = (iso) =>
    new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const getGradeInfo = (score, total) => {
    if (!total || total === '0') return { label: '—', cls: '' };
    const pct = (score / total) * 100;
    if (pct >= 90) return { label: 'A', cls: 'grade-badge-a' };
    if (pct >= 80) return { label: 'B', cls: 'grade-badge-b' };
    if (pct >= 70) return { label: 'C', cls: 'grade-badge-c' };
    return { label: 'F', cls: 'grade-badge-f' };
  };

  return (
    <main className="dashboard-content">
      <header className="dashboard-header">
        <div>
          <h1>Welcome back, {user.name || 'Student'}</h1>
          <p>Here is a summary of your academic activity.</p>
        </div>
        <div className="student-avatar-circle">{avatar}</div>
      </header>

      {/* Stats Grid */}
      <section className="stats-grid">
        {stats.map(stat => {
          const Icon = stat.icon;
          return (
            <div key={stat.id} className="stat-card">
              <div className="stat-icon"><Icon size={20} strokeWidth={1.75} /></div>
              <div className="stat-info">
                <span className="stat-label">{stat.label}</span>
                <h2 className="stat-value">{loading ? '—' : stat.value}</h2>
              </div>
            </div>
          );
        })}
      </section>

      {/* Recent Submissions Table — full width */}
      <section className="dashboard-card table-container dashboard-full-card">
        <div className="card-header">
          <h3>Recent Submissions</h3>
        </div>
        <div className="table-responsive-wrapper">
          <table className="dashboard-table">
            <thead>
              <tr>
                <th>Exam Title</th>
                <th>Date Submitted</th>
                <th>Score</th>
                <th>Grade</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="4" className="table-empty-state">Loading your submissions...</td>
                </tr>
              ) : dashData.recentSubmissions.length === 0 ? (
                <tr>
                  <td colSpan="4" className="table-empty-state">
                    No submissions yet. Scan your first answer sheet to get started.
                  </td>
                </tr>
              ) : (
                dashData.recentSubmissions.map(sub => {
                  const { label, cls } = getGradeInfo(sub.score, sub.total_questions);
                  return (
                    <tr key={sub.id}>
                      <td className="fw-600">{sub.exam_title}</td>
                      <td className="text-muted">{formatDate(sub.created_at)}</td>
                      <td>{sub.score} / {sub.total_questions ?? '—'}</td>
                      <td>
                        {label !== '—'
                          ? <span className={`badge ${cls}`}>{label}</span>
                          : <span className="text-muted">—</span>
                        }
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
};

export default StudentDashboard;
