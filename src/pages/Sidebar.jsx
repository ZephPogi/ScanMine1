import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, BookOpen, User, LogOut } from 'lucide-react';
import './Sidebar.css';

const Sidebar = () => {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="brand-logo">S</div>
        <h2>ScanMine</h2>
      </div>
      
      <nav className="sidebar-nav">
        <ul>
          {/* Dashboard */}
          <Link to="/dashboard" style={{ textDecoration: 'none' }}>
            <li className={`nav-item ${location.pathname === '/dashboard' ? 'active' : ''}`}>
              <LayoutDashboard className="icon" size={20} />
              <span>Dashboard</span>
            </li>
          </Link>

          {/* My Classes */}
          <Link to="/classes" style={{ textDecoration: 'none' }}>
            <li className={`nav-item ${location.pathname === '/classes' ? 'active' : ''}`}>
              <BookOpen className="icon" size={20} />
              <span>My Classes</span>
            </li>
          </Link>

          {/* Profile */}
          <Link to="/profile" style={{ textDecoration: 'none' }}>
            <li className={`nav-item ${location.pathname === '/profile' ? 'active' : ''}`}>
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

export default Sidebar;