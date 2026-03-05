const USERS_STORAGE_KEY = 'scheduler-users';
const SESSION_USER_KEY = 'scheduler-current-user';

export interface User {
  username: string;
  password: string;
}

const DEFAULT_USERS: User[] = [
  { username: 'Brendan', password: 'Redgrape26' },
];

function loadUsers(): User[] {
  try {
    const raw = localStorage.getItem(USERS_STORAGE_KEY);
    if (!raw) {
      saveUsers(DEFAULT_USERS);
      return [...DEFAULT_USERS];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      saveUsers(DEFAULT_USERS);
      return [...DEFAULT_USERS];
    }
    const users = parsed
      .filter((u): u is User => u && typeof u.username === 'string' && typeof u.password === 'string')
      .map((u) => ({ username: u.username, password: u.password }));
    if (users.length === 0) {
      saveUsers(DEFAULT_USERS);
      return [...DEFAULT_USERS];
    }
    return users;
  } catch {
    saveUsers(DEFAULT_USERS);
    return [...DEFAULT_USERS];
  }
}

function saveUsers(users: User[]) {
  try {
    localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users));
  } catch {
    // ignore
  }
}

export function getUsers(): User[] {
  return loadUsers();
}

export function addUser(username: string, password: string): boolean {
  const trimmed = username.trim();
  if (!trimmed || !password) return false;
  const users = loadUsers();
  if (users.some((u) => u.username.toLowerCase() === trimmed.toLowerCase())) return false;
  users.push({ username: trimmed, password });
  saveUsers(users);
  return true;
}

export function validateUser(username: string, password: string): boolean {
  const users = loadUsers();
  return users.some(
    (u) => u.username === username && u.password === password,
  );
}

export function getSessionUser(): string | null {
  try {
    return sessionStorage.getItem(SESSION_USER_KEY);
  } catch {
    return null;
  }
}

export function setSessionUser(username: string | null) {
  try {
    if (username == null) {
      sessionStorage.removeItem(SESSION_USER_KEY);
    } else {
      sessionStorage.setItem(SESSION_USER_KEY, username);
    }
  } catch {
    // ignore
  }
}
