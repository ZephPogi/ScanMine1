import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

// ── Landing ───────────────────────────────────────────
import LandingPage from "./pages/LandingPage";

// ── Auth ──────────────────────────────────────────────
import Login  from "./pages/Login";
import Signup from "./pages/Signup";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";

// ── Teacher ───────────────────────────────────────────
import TeacherDashboard   from "./pages/TeacherDashboard";
import TeacherClass       from "./pages/TeacherClass";
import TeacherProfile     from "./pages/TeacherProfile";
import SectionDetails     from "./pages/SectionDetails";
import AutoGradingResults from "./pages/AutoGradingResults";

// ── Student ───────────────────────────────────────────
import StudentDashboard    from "./pages/StudentDashboard";
import StudentClasses      from "./pages/StudentClasses";
import StudentProfile      from "./pages/StudentProfile";
import StudentMyGrades     from "./pages/StudentMyGrades";
import StudentUpcomingExams from "./pages/StudentUpcomingExams";
import StudentViewClass    from "./pages/StudentViewClass";
import StudentLayout       from "./pages/StudentLayout";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Default — Promotional Landing Page */}
        <Route path="/" element={<LandingPage />} />

        {/* Auth */}
        <Route path="/login"  element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />

        {/* Teacher */}
        <Route path="/dashboard"            element={<TeacherDashboard />} />
        <Route path="/classes"              element={<TeacherClass />} />
        <Route path="/profile"              element={<TeacherProfile />} />
        <Route path="/section-details"      element={<SectionDetails />} />
        <Route path="/auto-grading-results" element={<AutoGradingResults />} />

        {/* Student */}
        <Route element={<StudentLayout />}>
          <Route path="/student-dashboard"      element={<StudentDashboard />} />
          <Route path="/student-classes"        element={<StudentClasses />} />
          <Route path="/student-profile"        element={<StudentProfile />} />
          <Route path="/student/grades/:classId" element={<StudentMyGrades />} />
          <Route path="/student-upcoming-exams" element={<StudentUpcomingExams />} />
          <Route path="/student-view-class"     element={<StudentViewClass />} />
        </Route>

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;