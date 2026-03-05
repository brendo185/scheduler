import { useNavigate } from 'react-router-dom';
import type { SidePanelTab } from '../App';
import { useAuth } from '../contexts/AuthContext';
import './Sidebar.css';

interface SidebarProps {
  activeTab: SidePanelTab;
  onSelectTab: (tab: SidePanelTab) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

type NavIconName = 'dashboard' | 'events' | 'meetings' | 'tracker' | 'contacts' | 'settings';

interface NavIconProps {
  name: NavIconName;
}

function NavIcon({ name }: NavIconProps) {
  if (name === 'dashboard') {
    return (
      <span className="sidebar-item-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false">
          <rect x="3" y="3" width="8" height="8" rx="2" />
          <rect x="13" y="3" width="8" height="5" rx="2" />
          <rect x="3" y="13" width="5" height="8" rx="2" />
          <rect x="10" y="13" width="11" height="8" rx="2" />
        </svg>
      </span>
    );
  }

  if (name === 'events') {
    return (
      <span className="sidebar-item-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false">
          <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
          <path d="M3.5 9.5h17" />
          <path d="M8 3v3" />
          <path d="M16 3v3" />
        </svg>
      </span>
    );
  }

  if (name === 'meetings') {
    return (
      <span className="sidebar-item-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false">
          <rect x="3" y="4" width="14" height="11" rx="3" />
          <path d="M17 8.5 21 6v7l-4-2.5" />
        </svg>
      </span>
    );
  }

  if (name === 'tracker') {
    return (
      <span className="sidebar-item-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false">
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v4l2.5 2.5" />
        </svg>
      </span>
    );
  }

  if (name === 'contacts') {
    return (
      <span className="sidebar-item-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false">
          <circle cx="12" cy="9" r="3.25" />
          <path d="M6.5 18.5c.9-2.4 2.7-3.75 5.5-3.75s4.6 1.35 5.5 3.75" />
        </svg>
      </span>
    );
  }

  // settings (gear)
  return (
    <span className="sidebar-item-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false">
        <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    </span>
  );
}

interface CollapseIconProps {
  collapsed: boolean;
}

function CollapseIcon({ collapsed }: CollapseIconProps) {
  return (
    <span className="sidebar-toggle-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false">
        {collapsed ? (
          <path d="M10 7l5 5-5 5" />
        ) : (
          <path d="M14 7l-5 5 5 5" />
        )}
      </svg>
    </span>
  );
}

export function Sidebar({ activeTab, onSelectTab, isCollapsed, onToggleCollapse }: SidebarProps) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const sidebarClassName = `sidebar${isCollapsed ? ' sidebar--collapsed' : ''}`;

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <aside className={sidebarClassName} aria-label="Main navigation">
      <div className="sidebar-brand">
        <div className="sidebar-brand-main">
          <span className="sidebar-logo">◇</span>
          <span className="sidebar-title">Scheduler</span>
        </div>
        <button
          type="button"
          className="sidebar-toggle"
          onClick={onToggleCollapse}
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <CollapseIcon collapsed={isCollapsed} />
        </button>
      </div>
      <nav className="sidebar-nav">
        <button
          type="button"
          className={`sidebar-item ${activeTab === 'dashboard' ? 'active' : ''}`}
          onClick={() => onSelectTab('dashboard')}
          aria-label={isCollapsed ? 'Dashboard' : undefined}
          title={isCollapsed ? 'Dashboard' : undefined}
        >
          <NavIcon name="dashboard" />
          <span className="sidebar-item-label">Dashboard</span>
        </button>
        <button
          type="button"
          className={`sidebar-item ${activeTab === 'events' ? 'active' : ''}`}
          onClick={() => onSelectTab('events')}
          aria-label={isCollapsed ? 'Events' : undefined}
          title={isCollapsed ? 'Events' : undefined}
        >
          <NavIcon name="events" />
          <span className="sidebar-item-label">Events</span>
        </button>
        <button
          type="button"
          className={`sidebar-item ${activeTab === 'meetings' ? 'active' : ''}`}
          onClick={() => onSelectTab('meetings')}
          aria-label={isCollapsed ? 'Meetings' : undefined}
          title={isCollapsed ? 'Meetings' : undefined}
        >
          <NavIcon name="meetings" />
          <span className="sidebar-item-label">Meetings</span>
        </button>
        <button
          type="button"
          className={`sidebar-item ${activeTab === 'contacts' ? 'active' : ''}`}
          onClick={() => onSelectTab('contacts')}
          aria-label={isCollapsed ? 'Contacts' : undefined}
          title={isCollapsed ? 'Contacts' : undefined}
        >
          <NavIcon name="contacts" />
          <span className="sidebar-item-label">Contacts</span>
        </button>
        <button
          type="button"
          className={`sidebar-item ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => onSelectTab('settings')}
          aria-label={isCollapsed ? 'Settings' : undefined}
          title={isCollapsed ? 'Settings' : undefined}
        >
          <NavIcon name="settings" />
          <span className="sidebar-item-label">Settings</span>
        </button>
      </nav>
      <div className="sidebar-footer">
        <div className="sidebar-avatar">B</div>
        <div className="sidebar-user">
          <span className="sidebar-user-name">You</span>
          <span className="sidebar-user-role">Schedule</span>
        </div>
        <button
          type="button"
          className="sidebar-logout"
          onClick={handleLogout}
          aria-label="Sign out"
          title="Sign out"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
