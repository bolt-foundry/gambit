import { SupabaseClient, Session, User } from '@supabase/supabase-js';
export interface AuthSession {
    user: User | null;
    session: Session | null;
}
export interface Props {
    supabaseClient: SupabaseClient;
    [propName: string]: any;
}
export declare const UserContextProvider: (props: Props) => import("react/jsx-runtime").JSX.Element;
export declare const useUser: () => AuthSession;
//# sourceMappingURL=UserContext.d.ts.map