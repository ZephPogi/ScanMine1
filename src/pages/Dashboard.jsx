import { useState, useEffect } from 'react';
import './Dashboard.css';
import Sidebar from './Sidebar';
import { Users, FileText, TrendingUp, Camera, Scan, Bot, FileDown } from 'lucide-react';

const TeacherDashboard = () => {
  const [dashboardData, setDashboardData] = useState({
    totalStudents: 0,
    quizzesChecked: 0,
    classAverage: "0.0",
    recentActivity: []
  });

  const [loading, setLoading] = useState(true);
  const user = JSON.parse(localStorage.getItem('user') || '{}');

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

  const stats = [
    { id: 1, label: "Total Students", value: dashboardData.totalStudents.toString(), icon: Users, trend: "" },
    { id: 2, label: "Quizzes Checked", value: dashboardData.quizzesChecked.toString(), icon: FileText, trend: "" },
    { id: 3, label: "Average Score", value: `${dashboardData.classAverage}%`, icon: TrendingUp, trend: "" },
    { id: 4, label: "Pending Scans", value: "0", icon: Camera, trend: "Action Required" }, // Kept static per original if not requested
  ];

  return (
    <div className="page-layout">
      <Sidebar />
      <main className="dashboard-content">
        <header className="dashboard-header">
          <div>
            <h1>Welcome back, {user.name || "Teacher"}</h1>
            <p>Here's what's happening with your classes today.</p>
          </div>
          <button className="primary-action-btn">+ Create New Quiz</button>
        </header>

        {/* Stats Grid */}
        <section className="stats-grid">
          {stats.map(stat => {
            const Icon = stat.icon;
            return (
              <div key={stat.id} className="stat-card">
                <div className="stat-icon"><Icon size={24} /></div>
                <div className="stat-info">
                  <span className="stat-label">{stat.label}</span>
                  <h2 className="stat-value">{stat.value}</h2>
                  <span className={`stat-trend ${stat.trend.includes('+') ? 'positive' : 'neutral'}`}>
                    {stat.trend}
                  </span>
                </div>
              </div>
            );
          })}
        </section>

        {/* Main Section */}
        <div className="dashboard-main-grid">
          {/* Recent Activity Table */}
          <section className="dashboard-card table-container">
            <div className="card-header">
              <h3>Recent Quiz Results</h3>
              <button className="text-link">View All</button>
            </div>
            <div className="table-responsive-wrapper">
              <table className="dashboard-table">
                <thead>
                  <tr>
                    <th>Section</th>
                    <th>Quiz Title</th>
                    <th>Status</th>
                    <th>Avg. Score</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan="4" style={{textAlign: 'center', padding: '20px'}}>Loading recent activity...</td></tr>
                  ) : dashboardData.recentActivity.length === 0 ? (
                    <tr><td colSpan="4" style={{textAlign: 'center', padding: '20px'}}>No recent activity found.</td></tr>
                  ) : (
                    dashboardData.recentActivity.map((activity, index) => (
                      <tr key={index}>
                        <td>{activity.student_name}</td>
                        <td>{activity.subject}</td>
                        <td>{getStatusBadge(activity.score)}</td>
                        <td>{activity.score}%</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Quick Actions / Shortcuts */}
          <section className="dashboard-card shortcuts">
            <h3>Quick Actions</h3>
            <div className="shortcut-list">
              <button className="shortcut-item">
                <Scan size={18} />
                <span>Scan Answer Sheets</span>
              </button>
              <button className="shortcut-item">
                <Bot size={18} />
                <span>AI Quiz Generator</span>
              </button>
              <button className="shortcut-item">
                <FileDown size={18} />
                <span>Export Grade Reports</span>
              </button>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
};

export default TeacherDashboard;