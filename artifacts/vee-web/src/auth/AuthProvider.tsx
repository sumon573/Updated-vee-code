/**
 * Auth context — Firebase Auth, mirroring the native app's providers.
 * The native app supports Email/Password (Google sign-in was removed;
 * phone auth is not used), so the web client wires the same.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { auth } from '../lib/firebase';

export interface AuthContextValue {
  /** Current Firebase user, or null when signed out. */
  user: User | null;
  /** True while the initial auth state is being resolved. */
  loading: boolean;
  /** Sign in with email and password. */
  signIn: (email: string, password: string) => Promise<User>;
  /** Create an account with email, password and display name. */
  signUp: (email: string, password: string, name: string) => Promise<User>;
  /** Sign out. */
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const signIn = useCallback(async (email: string, password: string): Promise<User> => {
    const { user: signedInUser } = await signInWithEmailAndPassword(auth, email.trim(), password);
    return signedInUser;
  }, []);

  const signUp = useCallback(
    async (email: string, password: string, name: string): Promise<User> => {
      const { user: newUser } = await createUserWithEmailAndPassword(auth, email.trim(), password);
      await updateProfile(newUser, { displayName: name.trim() });
      return newUser;
    },
    [],
  );

  const handleSignOut = useCallback(async (): Promise<void> => {
    await signOut(auth);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, signIn, signUp, signOut: handleSignOut }),
    [user, loading, signIn, signUp, handleSignOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider.');
  }
  return context;
}
