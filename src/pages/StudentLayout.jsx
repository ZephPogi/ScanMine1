import { Outlet } from 'react-router-dom';
import StudentSidebar from './StudentSidebar';

const StudentLayout = () => {
  return (
    <div className="page-layout">
      <StudentSidebar />
      <Outlet />
    </div>
  );
};

export default StudentLayout;
