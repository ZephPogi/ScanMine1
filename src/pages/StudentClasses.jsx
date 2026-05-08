import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, Users, CheckCircle, XCircle, Clock } from 'lucide-react';
import './StudentClasses.css';

const StudentClasses = () => {
  const navigate = useNavigate();
  const [pendingInvites, setPendingInvites] = useState([]);
  const [enrolledClasses, setEnrolledClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null); // stores classId being acted on

  const user = JSON.parse(localStorage.getItem('user') || '{}');

  const fetchClasses = useCallback(async () => {
    if (!user.id) return;
    try {
      const response = await fetch(`/api/student-classes?studentId=${user.id}`);
      if (response.ok) {
        const data = await response.json();
        const all = Array.isArray(data) ? data : [];
        setPendingInvites(all.filter(c => c.status === 'pending'));
        setEnrolledClasses(all.filter(c => c.status === 'enrolled'));
      }
    } catch (error) {
      console.error('Error fetching student classes:', error);
    } finally {
      setLoading(false);
    }
  }, [user.id]);

  useEffect(() => { fetchClasses(); }, [fetchClasses]);

  const handleAccept = async (cls) => {
    setActionLoading(cls.id);
    try {
      const res = await fetch('/api/class/accept-invite', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classId: cls.id, userId: user.id }),
      });
      if (res.ok) {
        setPendingInvites(prev => prev.filter(c => c.id !== cls.id));
        setEnrolledClasses(prev => [...prev, { ...cls, status: 'enrolled' }]);
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to accept invitation');
      }
    } catch (err) {
      console.error('Accept error:', err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDecline = async (cls) => {
    setActionLoading(cls.id);
    try {
      const res = await fetch(`/api/class/decline-invite?classId=${cls.id}&userId=${user.id}`, { method: 'DELETE' });
      if (res.ok) {
        setPendingInvites(prev => prev.filter(c => c.id !== cls.id));
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to decline invitation');
      }
    } catch (err) {
      console.error('Decline error:', err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleViewClass = (cls) => {
    navigate('/student-view-class', { state: { section: cls } });
  };

  return (
    <div className="main-content">
      <header className="page-header">
        <div>
          <h2>My Classes</h2>
          <p style={{ color: '#64748b', marginTop: '5px' }}>
            View your enrolled classes and respond to pending invitations.
          </p>
        </div>
      </header>

      {loading ? (
        <p style={{ color: '#94a3b8' }}>Loading classes…</p>
      ) : (
        <>
          {/* ── Pending Invitations Section ── */}
          {pendingInvites.length > 0 && (
            <section className="invites-section">
              <div className="invites-section-header">
                <Clock size={18} className="invites-section-icon" />
                <h3>Pending Invitations</h3>
                <span className="invite-count-badge">{pendingInvites.length}</span>
              </div>
              <div className="invites-grid">
                {pendingInvites.map(cls => (
                  <div key={cls.id} className="invite-card">
                    <div className="invite-card-top">
                      <span className="subject-label">{cls.subject || 'No Subject'}</span>
                      <span className="invite-status-pill">
                        <Clock size={12} />
                        Pending
                      </span>
                    </div>
                    <div className="invite-meta">
                      <h3>{cls.name}</h3>
                      <p>
                        <Users size={14} />
                        {cls.professor || 'Unknown Teacher'}
                      </p>
                    </div>
                    <div className="invite-actions">
                      <button
                        className="accept-btn"
                        onClick={() => handleAccept(cls)}
                        disabled={actionLoading === cls.id}
                      >
                        <CheckCircle size={16} />
                        {actionLoading === cls.id ? 'Processing…' : 'Accept'}
                      </button>
                      <button
                        className="decline-btn"
                        onClick={() => handleDecline(cls)}
                        disabled={actionLoading === cls.id}
                      >
                        <XCircle size={16} />
                        Decline
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Enrolled Classes ── */}
          <section>
            {pendingInvites.length > 0 && (
              <div className="enrolled-section-header">
                <BookOpen size={18} />
                <h3>My Enrolled Classes</h3>
              </div>
            )}
            <div className="class-grid">
              {enrolledClasses.map((item) => (
                <div key={item.id} className="class-card">
                  <div className="card-top">
                    <span className="subject-label">{item.subject || 'No Subject'}</span>
                  </div>
                  <div className="card-info">
                    <h3>{item.name}</h3>
                    <p><Users size={16} /> Professor: {item.professor || 'Unknown'}</p>
                  </div>
                  <button className="view-btn" onClick={() => handleViewClass(item)}>
                    View Class
                  </button>
                </div>
              ))}
              {enrolledClasses.length === 0 && pendingInvites.length === 0 && (
                <p style={{ color: '#94a3b8', gridColumn: '1/-1' }}>
                  You are not enrolled in any classes yet. Ask your teacher to invite you!
                </p>
              )}
              {enrolledClasses.length === 0 && pendingInvites.length > 0 && (
                <p style={{ color: '#94a3b8', gridColumn: '1/-1' }}>
                  No enrolled classes yet. Accept an invitation above to get started!
                </p>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
};

export default StudentClasses;
