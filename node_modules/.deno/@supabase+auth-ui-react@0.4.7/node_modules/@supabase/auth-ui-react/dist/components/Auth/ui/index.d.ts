import { ReactNode } from 'react';
import { Auth as AuthProps } from '../../../types';
import { CssComponent } from '@stitches/core/types/styled-component';
interface Card {
    className?: string | CssComponent;
}
export declare const AuthCard: ({ children, appearance, }: {
    children?: ReactNode;
    appearance?: Card | undefined;
}) => import("react/jsx-runtime").JSX.Element;
export declare const SignUp: (props: Omit<AuthProps, 'view' | 'onlyThirdPartyProviders'>) => import("react/jsx-runtime").JSX.Element;
export declare const SignIn: (props: Omit<AuthProps, 'view' | 'onlyThirdPartyProviders' | 'additionalData'>) => import("react/jsx-runtime").JSX.Element;
export declare const MagicLink: (props: Omit<AuthProps, 'view' | 'onlyThirdPartyProviders' | 'magicLink' | 'showLinks' | 'additionalData'>) => import("react/jsx-runtime").JSX.Element;
export declare const SocialAuth: (props: Omit<AuthProps, 'view' | 'onlyThirdPartyProviders' | 'magicLink' | 'showLinks' | 'additionalData'>) => import("react/jsx-runtime").JSX.Element;
export declare const ForgottenPassword: (props: Pick<AuthProps, 'supabaseClient' | 'appearance' | 'localization' | 'theme' | 'showLinks' | 'redirectTo'>) => import("react/jsx-runtime").JSX.Element;
export declare const UpdatePassword: (props: Pick<AuthProps, 'supabaseClient' | 'appearance' | 'localization' | 'theme'>) => import("react/jsx-runtime").JSX.Element;
export declare const VerifyOtp: (props: Pick<AuthProps, 'supabaseClient' | 'appearance' | 'localization' | 'theme' | 'otpType'>) => import("react/jsx-runtime").JSX.Element;
export {};
//# sourceMappingURL=index.d.ts.map