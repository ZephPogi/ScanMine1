import { useState, useEffect } from 'react';
import './TeacherDashboard.css';
import Sidebar from './Sidebar';
import { Users, FileText, TrendingUp, Camera, BookOpen, ChevronRight, ClipboardList, Sparkles, Activity, ArrowUpRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const TeacherDashboard = () => {
  const [dashboardData, setDashboardData] = useState({
    totalStudents: 0,
    quizzesChecked: 0,
    classAverage: "0.0",
    recentActivity: []
  });
  const [teacherClasses, setTeacherClasses] = useState([]);

  const [loading, setLoading] = useState(true);
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const navigate = useNavigate();

  useEffect(() => {
    const fetchDashboardData = async () => {
      if (!user.id) return;
      try {
        const [dashboardResponse, classesResponse] = await Promise.all([
          fetch(`/api/dashboard?teacherId=${user.id}`),
          fetch(`/api/classes?teacherId=${user.id}`)
        ]);
        if (dashboardResponse.ok) {
          const data = await dashboardResponse.json();
          setDashboardData(data);
        }
        if (classesResponse.ok) {
          const classes = await classesResponse.json();
          setTeacherClasses(Array.isArray(classes) ? classes : []);
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

  const firstName = (user.name || 'Teacher').trim().split(/\s+/)[0];
  const recentActivity = Array.isArray(dashboardData.recentActivity) ? dashboardData.recentActivity : [];
  const averageScore = Number.parseFloat(dashboardData.classAverage) || 0;
  const getCurrentSection = () => {
    try {
      const section = JSON.parse(localStorage.getItem('currentSection') || 'null');
      if (section?.id) return section;
    } catch (error) {
      console.error('Unable to read the saved class section:', error);
    }
    return teacherClasses.find(section => section?.id) || null;
  };
  const handleScanAnswerSheet = () => {
    const section = getCurrentSection();
    if (!section) {
      navigate('/classes');
      return;
    }
    navigate('/auto-grading-results', { state: { section, openScanModal: true } });
  };
  const handleGenerateQuiz = () => {
    navigate('/classes', { state: { section: getCurrentSection(), openQuizGenerator: true } });
  };

  const stats = [
    { id: 1, label: "Total Students", value: dashboardData.totalStudents.toString(), icon: Users, color: 'indigo', bgClass: 'bg-indigo', trend: "", trendClass: "neutral" },
    { id: 2, label: "Quizzes Checked", value: dashboardData.quizzesChecked.toString(), icon: FileText, color: 'blue', bgClass: 'bg-blue', trend: "", trendClass: "neutral" },
    { id: 3, label: "Average Score", value: `${dashboardData.classAverage}%`, icon: TrendingUp, color: 'emerald', bgClass: 'bg-emerald', trend: "", trendClass: "positive" },
    { id: 4, label: "Pending Scans", value: dashboardData.pendingScans === null || dashboardData.pendingScans === undefined ? "—" : String(dashboardData.pendingScans), icon: Camera, color: 'amber', bgClass: 'bg-amber', trend: dashboardData.pendingScans === null || dashboardData.pendingScans === undefined ? "" : dashboardData.pendingScans ? "Action Required" : "All caught up", trendClass: dashboardData.pendingScans ? "warning" : "positive" },
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
            <p className="dashboard-eyebrow">TEACHER DASHBOARD</p>
            <h1>Welcome back, <span>{firstName}</span> <span className="dashboard-wave" aria-hidden="true">👋</span></h1>
            <p>Here&apos;s what&apos;s happening with your classes today.</p>
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
                  ) : recentActivity.length === 0 ? (
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
                    recentActivity.map((activity, index) => (
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

          <div className="dashboard-side-column">
          {/* Quick Actions Panel */}
          <section className="dashboard-card quick-actions-card">
            <div className="card-header">
              <div>
                <p className="card-eyebrow">GET THINGS DONE</p>
                <h3>Quick Actions</h3>
              </div>
            </div>
            <div className="quick-actions-panel">
              <button className="quick-action-btn scan-action" onClick={handleScanAnswerSheet}>
                <div className="quick-action-icon emerald"><Camera size={19} /></div>
                <span className="quick-action-label">
                  <strong>Scan Answer Sheet</strong>
                  <small>Open the grading scanner</small>
                </span>
                <ArrowUpRight size={16} className="quick-action-arrow" />
              </button>
              <button className="quick-action-btn quiz-action" onClick={handleGenerateQuiz}>
                <div className="quick-action-icon indigo"><Sparkles size={19} /></div>
                <span className="quick-action-label">
                  <strong>Generate AI Quiz</strong>
                  <small>Start from a class section</small>
                </span>
                <ArrowUpRight size={16} className="quick-action-arrow" />
              </button>
              <button className="quick-action-btn classes-action" onClick={() => navigate('/classes')}>
                <div className="quick-action-icon blue"><BookOpen size={19} /></div>
                <span className="quick-action-label">
                  <strong>My Classes</strong>
                  <small>View students and exams</small>
                </span>
                <ChevronRight size={16} className="quick-action-arrow" />
              </button>
            </div>
          </section>

          <section className="dashboard-card performance-card">
            <div className="card-header">
              <div>
                <p className="card-eyebrow">AT A GLANCE</p>
                <h3>Class Performance Overview</h3>
              </div>
              <div className="performance-header-icon"><Activity size={17} /></div>
            </div>
            <div className="performance-score-row">
              <div>
                <span className="performance-label">Average score</span>
                <strong>{dashboardData.classAverage}%</strong>
              </div>
              <span className="performance-range">Class-wide</span>
            </div>
            <div
              className="performance-progress-track"
              role="progressbar"
              aria-label="Class average score"
              aria-valuenow={Math.max(0, Math.min(100, averageScore))}
              aria-valuemin="0"
              aria-valuemax="100"
            >
              <span style={{ width: `${Math.max(0, Math.min(100, averageScore))}%` }} />
            </div>
            <div className="performance-stats">
              <div>
                <span className="performance-stat-icon indigo"><Users size={15} /></span>
                <span><strong>{dashboardData.totalStudents}</strong><small>Students</small></span>
              </div>
              <div>
                <span className="performance-stat-icon emerald"><FileText size={15} /></span>
                <span><strong>{dashboardData.quizzesChecked}</strong><small>Quizzes checked</small></span>
              </div>
            </div>
            <div className="performance-activity">
              <span className="performance-activity-dot" />
              <span>
                {recentActivity.length > 0
                  ? `Latest result: ${recentActivity[0].student_name || 'Student'}`
                  : 'Recent student activity will appear here.'}
              </span>
            </div>
            <button className="performance-view-link" onClick={() => navigate('/classes')}>
              View class details <ChevronRight size={15} />
            </button>
          </section>
          </div>
        </div>
      </main>
    </div>
  );
};

export default TeacherDashboard;