import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, TrendingUp, CheckCircle, LayoutDashboard, UserRound, LogOut } from 'lucide-react';
import './StudentDashboard.css';

const StudentMobileNav = () => (
  <nav className="student-mobile-nav md:hidden" aria-label="Student navigation">
    <Link to="/student-dashboard" className="student-mobile-nav-item active" aria-current="page">
      <LayoutDashboard size={19} />
      <span>Dashboard</span>
    </Link>
    <Link to="/student-classes" className="student-mobile-nav-item">
      <BookOpen size={19} />
      <span>My Classes</span>
    </Link>
    <Link to="/student-profile" className="student-mobile-nav-item">
      <UserRound size={19} />
      <span>Profile</span>
    </Link>
    <Link to="/login" className="student-mobile-nav-item">
      <LogOut size={19} />
      <span>Logout</span>
    </Link>
  </nav>
);

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

  return (
    <>
      <main className="dashboard-content student-dashboard-page">
        <header className="dashboard-header student-dashboard-header">
          <div className="student-mobile-greeting">
            <div>
              <span className="student-greeting-eyebrow">Student Portal</span>
              <h1>Welcome back, {user.name || 'Student'}</h1>
            </div>
            <div className="student-mobile-avatar" aria-label={`Initials: ${avatar}`}>{avatar}</div>
          </div>
          <div className="dashboard-heading">
            <h1>Welcome back, {user.name || 'Student'}</h1>
            <p>Here is a summary of your academic activity.</p>
          </div>
          <div className="student-avatar-circle">{avatar}</div>
        </header>

        <section className="stats-grid student-stats-grid" aria-label="Academic summary">
          {stats.map(stat => {
            const Icon = stat.icon;
            return (
              <article key={stat.id} className="stat-card student-stat-card">
                <div className="stat-icon"><Icon size={20} strokeWidth={1.75} /></div>
                <div className="stat-info">
                  <span className="stat-label">{stat.label}</span>
                  <h2 className="stat-value">{loading ? '—' : stat.value}</h2>
                </div>
              </article>
            );
          })}
        </section>

        <section className="dashboard-card table-container dashboard-full-card student-submissions-card">
          <div className="card-header">
            <div>
              <span className="student-section-eyebrow">Your activity</span>
              <h3>Recent Submissions</h3>
            </div>
          </div>
          <div className="table-responsive-wrapper">
            <table className="dashboard-table student-submissions-table">
              <thead>
                <tr>
                  <th>Exam Title</th>
                  <th>Date Submitted</th>
                  <th>Score</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan="3" className="table-empty-state">Loading your submissions...</td>
                  </tr>
                ) : dashData.recentSubmissions.length === 0 ? (
                  <tr>
                    <td colSpan="3" className="table-empty-state">
                      No submissions yet. Scan your first answer sheet to get started.
                    </td>
                  </tr>
                ) : (
                  dashData.recentSubmissions.map(sub => (
                    <tr key={sub.id}>
                      <td className="fw-600">{sub.exam_title}</td>
                      <td className="text-muted">{formatDate(sub.created_at)}</td>
                      <td>
                        <span className="student-dashboard-score">
                          {sub.points_earned ?? Math.round(sub.score) ?? 0} / {sub.total_items ?? sub.total_questions ?? '?'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
      <StudentMobileNav />
    </>
  );
};

export default StudentDashboard;
