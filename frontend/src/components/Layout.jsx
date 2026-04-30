import { Outlet, Link, useLocation, useNavigate } from "react-router-dom";
import { Mic, Home, History, LogOut } from "lucide-react";
import { useAuth } from '@/lib/AuthContext';

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout } = useAuth();
  const isLanding = location.pathname === "/";
  const isInterview = location.pathname === "/interview";

  if (isInterview) {
    return <Outlet />;
  }

  return (
    <div className="min-h-screen bg-background">
      {!isLanding && (
        <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-16">
              <Link to="/" className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-accent flex items-center justify-center">
                  <Mic className="w-5 h-5 text-accent-foreground" />
                </div>
                <span className="font-space font-bold text-lg tracking-tight">InterviewAI</span>
              </Link>
              <nav className="flex items-center gap-1">
                <NavLink to="/dashboard" icon={<Home className="w-4 h-4" />} label="Dashboard" current={location.pathname} />
                <NavLink to="/setup" icon={<Mic className="w-4 h-4" />} label="New Interview" current={location.pathname} />
                <NavLink to="/history" icon={<History className="w-4 h-4" />} label="History" current={location.pathname} />
                <button
                  type="button"
                  onClick={async () => {
                    await logout();
                    navigate('/');
                  }}
                  className="ml-2 p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </nav>
            </div>
          </div>
        </header>
      )}
      <Outlet />
    </div>
  );
}

function NavLink({ to, icon, label, current }) {
  const isActive = current === to;
  return (
    <Link
      to={to}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
        isActive
          ? "bg-accent/10 text-accent"
          : "text-muted-foreground hover:text-foreground hover:bg-muted"
      }`}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </Link>
  );
}