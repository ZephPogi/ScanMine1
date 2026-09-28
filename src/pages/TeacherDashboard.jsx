import { useState, useEffect } from 'react';
import './TeacherDashboard.css';
import Sidebar from './Sidebar';
import { Users, FileText, TrendingUp, Camera, BookOpen, User, ChevronRight, ClipboardList } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const TeacherDashboard = () => {
  const [dashboardData, setDashboardData] = useState({
    totalStudents: 0,
    quizzesChecked: 0,
    classAverage: "0.0",
    recentActivity: []
  });

  const [loading, setLoading] = useState(true);
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const navigate = useNavigate();

  useEffect(() => {
    const fetchDashboardData = async () => {
      if (!user.id) return;
      try {
        const response = await fetch(`/api/dashboard?teacherId=${user.id}`);
        if (response.ok) {
          const data = await response.json();
          setDashboardData(data);
        }
      } catch (error) {
        console.error("Error fetching dashboard data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, [user.id]);

  const getStatusBadge = (score) => {
    const numScore = parseFloat(score);
    if (numScore >= 75) {
      return <span className="badge success">Passed</span>;
    }
    return <span className="badge warning">Retake</span>;
  };

  const firstName = (user.name || 'Teacher').split(' ')[0];

  const stats = [
    { id: 1, label: "Total Students", value: dashboardData.totalStudents.toString(), icon: Users, color: 'indigo', bgClass: 'bg-indigo', trend: "", trendClass: "neutral" },
    { id: 2, label: "Quizzes Checked", value: dashboardData.quizzesChecked.toString(), icon: FileText, color: 'blue', bgClass: 'bg-blue', trend: "", trendClass: "neutral" },
    { id: 3, label: "Average Score", value: `${dashboardData.classAverage}%`, icon: TrendingUp, color: 'emerald', bgClass: 'bg-emerald', trend: "", trendClass: "positive" },
    { id: 4, label: "Pending Scans", value: "0", icon: Camera, color: 'amber', bgClass: 'bg-amber', trend: "Action Required", trendClass: "warning" },
  ];

  // Skeleton rows for loading state
  const SkeletonRows = () => (
    <>
      {[1, 2, 3].map(i => (
        <tr key={i} className="skeleton-row">
          <td><div className="skeleton-cell medium" /></td>
          <td><div className="skeleton-cell long" /></td>
          <td><div className="skeleton-cell short" /></td>
          <td><div className="skeleton-cell short" /></td>
        </tr>
      ))}
    </>
  );

  return (
    <div className="page-layout">
      <Sidebar />
      <main className="dashboard-content">
        {/* ── Header ── */}
        <header className="dashboard-header">
          <div className="dashboard-header-text">
            <h1>Welcome back, <span>{firstName}</span> 👋</h1>
            <p>Here's what's happening with your classes today.</p>
          </div>
          <button className="primary-action-btn" onClick={() => navigate('/classes')}>
            <BookOpen size={17} />
            View My Classes
          </button>
        </header>

        {/* ── Stats Grid ── */}
        <section className="stats-grid">
          {stats.map(stat => {
            const Icon = stat.icon;
            return (
              <div key={stat.id} className={`stat-card color-${stat.color}`}>
                <div className={`stat-icon ${stat.bgClass}`}>
                  <Icon size={22} />
                </div>
                <div className="stat-info">
                  <span className="stat-label">{stat.label}</span>
                  <h2 className="stat-value">{stat.value}</h2>
                  {stat.trend && (
                    <span className={`stat-trend ${stat.trendClass}`}>
                      {stat.trend}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </section>

        {/* ── Main Grid ── */}
        <div className="dashboard-main-grid">
          {/* Recent Activity Table */}
          <section className="dashboard-card table-container">
            <div className="card-header">
              <h3>
                <div className="card-header-icon"><ClipboardList size={16} /></div>
                Recent Quiz Results
              </h3>
              <button className="text-link" onClick={() => navigate('/classes')}>View All</button>
            </div>
            <div className="table-responsive-wrapper">
              <table className="dashboard-table">
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Subject</th>
                    <th>Status</th>
                    <th>Score</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <SkeletonRows />
                  ) : dashboardData.recentActivity.length === 0 ? (
                    <tr className="empty-state-row">
                      <td colSpan="4">
                        <div className="empty-state-content">
                          <div className="empty-state-icon">
                            <ClipboardList size={24} />
                          </div>
                          <p>No recent quiz activity yet.</p>
                          <p>Results will appear here after students complete exams.</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    dashboardData.recentActivity.map((activity, index) => (
                      <tr key={index}>
                        <td>{activity.student_name}</td>
                        <td>{activity.subject}</td>
                        <td>{getStatusBadge(activity.score)}</td>
                        <td><strong>{activity.score}%</strong></td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Quick Actions Panel */}
          <section className="dashboard-card">
            <div className="card-header">
              <h3>Quick Actions</h3>
            </div>
            <div className="quick-actions-panel">
              <button className="quick-action-btn" onClick={() => navigate('/classes')}>
                <div className="quick-action-icon indigo"><BookOpen size={18} /></div>
                <span className="quick-action-label">My Classes</span>
                <ChevronRight size={16} className="quick-action-arrow" />
              </button>
              <button className="quick-action-btn" onClick={() => navigate('/profile')}>
                <div className="quick-action-icon blue"><User size={18} /></div>
                <span className="quick-action-label">My Profile</span>
                <ChevronRight size={16} className="quick-action-arrow" />
              </button>
              <button className="quick-action-btn" onClick={() => navigate('/classes')}>
                <div className="quick-action-icon emerald"><TrendingUp size={18} /></div>
                <span className="quick-action-label">View Class Grades</span>
                <ChevronRight size={16} className="quick-action-arrow" />
              </button>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
};

export default TeacherDashboard;