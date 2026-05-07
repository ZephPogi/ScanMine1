import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, BookOpen, User, LogOut } from 'lucide-react';
import './StudentSidebar.css';

const StudentSidebar = () => {
  const location = useLocation();
  const navigate  = useNavigate();

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="brand-logo">S</div>
        <h2>ScanMine</h2>
      </div>

      <nav className="sidebar-nav">
        <ul>
          {/* Dashboard */}
          <Link to="/student-dashboard" style={{ textDecoration: 'none' }}>
            <li className={`nav-item ${location.pathname === '/student-dashboard' ? 'active' : ''}`}>
              <LayoutDashboard className="icon" size={20} />
              <span>Dashboard</span>
            </li>
          </Link>

          {/* My Classes */}
          <Link to="/student-classes" style={{ textDecoration: 'none' }}>
            <li className={`nav-item ${location.pathname === '/student-classes' ? 'active' : ''}`}>
              <BookOpen className="icon" size={20} />
              <span>My Classes</span>
            </li>
          </Link>

          {/* Profile */}
          <Link to="/student-profile" style={{ textDecoration: 'none' }}>
            <li className={`nav-item ${location.pathname === '/student-profile' ? 'active' : ''}`}>
              <User className="icon" size={20} />
              <span>Profile</span>
            </li>
          </Link>
        </ul>
      </nav>

      <div className="sidebar-footer">
        <div className="nav-item logout" onClick={() => navigate('/login')}>
          <LogOut className="icon" size={20} />
          <span>Logout</span>
        </div>
      </div>
    </aside>
  );
};

export default StudentSidebar;
