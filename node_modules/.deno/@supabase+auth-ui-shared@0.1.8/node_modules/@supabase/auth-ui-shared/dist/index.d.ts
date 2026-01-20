import * as _stitches_core_types_styled_component from '@stitches/core/types/styled-component';
import { CssComponent } from '@stitches/core/types/styled-component';
import { Provider, EmailOtpType, MobileOtpType, SupabaseClient } from '@supabase/supabase-js';

interface AnimationTailwindClasses {
    enter?: string;
    enterFrom?: string;
    enterTo?: string;
    leave?: string;
    leaveFrom?: string;
    leaveTo?: string;
}
declare type AuthProviders = Provider;
interface Localization {
    ['en']: I18nVariables;
}
declare enum SocialLayouts {
    'horizontal' = 0,
    'vertical' = 1
}
declare type SocialLayout = keyof typeof SocialLayouts;
declare type SocialButtonSize = 'tiny' | 'small' | 'medium' | 'large' | 'xlarge';
declare type ViewSignIn = 'sign_in';
declare type ViewSignUp = 'sign_up';
declare type ViewMagicLink = 'magic_link';
declare type ViewForgottenPassword = 'forgotten_password';
declare type ViewUpdatePassword = 'update_password';
declare type ViewVerifyOtp = 'verify_otp';
declare type ViewType = ViewSignIn | ViewSignUp | ViewMagicLink | ViewForgottenPassword | ViewUpdatePassword | ViewVerifyOtp;
interface ViewsMap {
    [key: string]: ViewType;
}
interface Theme {
    default: ThemeVariables;
    [key: string]: ThemeVariables;
}
declare type RedirectTo = undefined | string;
declare type OtpType = EmailOtpType | MobileOtpType;
interface BaseAppearance {
    theme?: Theme;
    prependedClassName?: string;
    extend?: boolean;
    variables?: {
        default: ThemeVariables;
        [key: string]: ThemeVariables;
    };
    className?: {
        anchor?: string | CssComponent;
        button?: string | CssComponent;
        container?: string | CssComponent;
        divider?: string | CssComponent;
        input?: string | CssComponent;
        label?: string | CssComponent;
        loader?: string | CssComponent;
        message?: string | CssComponent;
    };
}
declare type ProviderScopes = {
    [key in Partial<Provider>]: string;
};
interface BaseAuth {
    supabaseClient: SupabaseClient;
    socialLayout?: SocialLayout;
    providers?: Provider[];
    providerScopes?: Partial<ProviderScopes>;
    queryParams?: {
        [key: string]: string;
    };
    view?: ViewType;
    redirectTo?: RedirectTo;
    onlyThirdPartyProviders?: boolean;
    magicLink?: boolean;
    showLinks?: boolean;
    otpType?: OtpType;
    additionalData?: {
        [key: string]: any;
    };
    /**
     * This will toggle on the dark variation of the theme
     */
    dark?: boolean;
    /**
     * Override the labels and button text
     */
    localization?: {
        variables?: I18nVariables;
    };
    theme?: 'default' | string;
}
declare type I18nVariables = {
    sign_up?: {
        email_label?: string;
        password_label?: string;
        email_input_placeholder?: string;
        password_input_placeholder?: string;
        button_label?: string;
        loading_button_label?: string;
        social_provider_text?: string;
        link_text?: string;
        confirmation_text?: string;
    };
    sign_in?: {
        email_label?: string;
        password_label?: string;
        email_input_placeholder?: string;
        password_input_placeholder?: string;
        button_label?: string;
        loading_button_label?: string;
        social_provider_text?: string;
        link_text?: string;
    };
    magic_link?: {
        email_input_label?: string;
        email_input_placeholder?: string;
        button_label?: string;
        loading_button_label?: string;
        link_text?: string;
        confirmation_text?: string;
        empty_email_address?: string;
    };
    forgotten_password?: {
        email_label?: string;
        password_label?: string;
        email_input_placeholder?: string;
        button_label?: string;
        loading_button_label?: string;
        link_text?: string;
        confirmation_text?: string;
    };
    update_password?: {
        password_label?: string;
        password_input_placeholder?: string;
        button_label?: string;
        loading_button_label?: string;
        confirmation_text?: string;
    };
    verify_otp?: {
        email_input_label?: string;
        email_input_placeholder?: string;
        phone_input_label?: string;
        phone_input_placeholder?: string;
        token_input_label?: string;
        token_input_placeholder?: string;
        button_label?: string;
        loading_button_label?: string;
    };
};

/**
 * Create default theme
 *
 * createStitches()
 * https://stitches.dev/docs/api#theme
 *
 * to add a new theme use  createTheme({})
 * https://stitches.dev/docs/api#theme
 */

declare const ThemeSupa: Theme;
declare const ThemeMinimal: Theme;

declare type ThemeVariables = {
    colors?: {
        brand?: string;
        brandAccent?: string;
        brandButtonText?: string;
        defaultButtonBackground?: string;
        defaultButtonBackgroundHover?: string;
        defaultButtonBorder?: string;
        defaultButtonText?: string;
        dividerBackground?: string;
        inputBackground?: string;
        inputBorder?: string;
        inputBorderFocus?: string;
        inputBorderHover?: string;
        inputLabelText?: string;
        inputPlaceholder?: string;
        inputText?: string;
        messageText?: string;
        messageBackground?: string;
        messageBorder?: string;
        messageTextDanger?: string;
        messageBackgroundDanger?: string;
        messageBorderDanger?: string;
        anchorTextColor?: string;
        anchorTextHoverColor?: string;
    };
    space?: {
        spaceSmall?: string;
        spaceMedium?: string;
        spaceLarge?: string;
        labelBottomMargin?: string;
        anchorBottomMargin?: string;
        emailInputSpacing?: string;
        socialAuthSpacing?: string;
        buttonPadding?: string;
        inputPadding?: string;
    };
    fontSizes?: {
        baseBodySize?: string;
        baseInputSize?: string;
        baseLabelSize?: string;
        baseButtonSize?: string;
    };
    fonts?: {
        bodyFontFamily?: string;
        buttonFontFamily?: string;
        inputFontFamily?: string;
        labelFontFamily?: string;
    };
    borderWidths?: {
        buttonBorderWidth?: string;
        inputBorderWidth?: string;
    };
    radii?: {
        borderRadiusButton?: string;
        buttonBorderRadius?: string;
        inputBorderRadius?: string;
    };
};

/**
 * Create default theme
 *
 * createStitches()
 * https://stitches.dev/docs/api#theme
 *
 * to add a new theme use  createTheme({})
 * https://stitches.dev/docs/api#theme
 */

declare const supabase: ThemeVariables;
declare const minimal: ThemeVariables;
declare const darkThemes: {
    supabase: ThemeVariables;
    minimal: ThemeVariables;
};

declare function generateClassNames(
/**
 * name of css class name variable
 */
classNameKey: 'button' | 'container' | 'anchor' | 'divider' | 'label' | 'input' | 'loader' | 'message', 
/**
 * stiches CSS output
 */
defaultStyles: string, 
/**
 * appearance variables
 */
appearance?: BaseAppearance): (string | _stitches_core_types_styled_component.CssComponent<"span", {}, {}, {}> | undefined)[];

declare const VIEWS: ViewsMap;
declare const PREPENDED_CLASS_NAMES = "supabase-auth-ui";
/**
 * CSS class names
 * used for generating prepended classes
 */
declare const CLASS_NAMES: {
    ROOT: string;
    SIGN_IN: ViewType;
    SIGN_UP: ViewType;
    FORGOTTEN_PASSWORD: ViewType;
    MAGIC_LINK: ViewType;
    UPDATE_PASSWORD: ViewType;
    anchor: string;
    button: string;
    container: string;
    divider: string;
    input: string;
    label: string;
    loader: string;
    message: string;
};

declare function merge(target: any, ...args: any): any;
declare function template(string: string, data: Record<string, string>): string;

var sign_up = {
	email_label: "Email address",
	password_label: "Create a Password",
	email_input_placeholder: "Your email address",
	password_input_placeholder: "Your password",
	button_label: "Sign up",
	loading_button_label: "Signing up ...",
	social_provider_text: "Sign in with {{provider}}",
	link_text: "Don't have an account? Sign up",
	confirmation_text: "Check your email for the confirmation link"
};
var sign_in = {
	email_label: "Email address",
	password_label: "Your Password",
	email_input_placeholder: "Your email address",
	password_input_placeholder: "Your password",
	button_label: "Sign in",
	loading_button_label: "Signing in ...",
	social_provider_text: "Sign in with {{provider}}",
	link_text: "Already have an account? Sign in"
};
var magic_link = {
	email_input_label: "Email address",
	email_input_placeholder: "Your email address",
	button_label: "Send Magic Link",
	loading_button_label: "Sending Magic Link ...",
	link_text: "Send a magic link email",
	confirmation_text: "Check your email for the magic link"
};
var forgotten_password = {
	email_label: "Email address",
	password_label: "Your Password",
	email_input_placeholder: "Your email address",
	button_label: "Send reset password instructions",
	loading_button_label: "Sending reset instructions ...",
	link_text: "Forgot your password?",
	confirmation_text: "Check your email for the password reset link"
};
var update_password = {
	password_label: "New password",
	password_input_placeholder: "Your new password",
	button_label: "Update password",
	loading_button_label: "Updating password ...",
	confirmation_text: "Your password has been updated"
};
var verify_otp = {
	email_input_label: "Email address",
	email_input_placeholder: "Your email address",
	phone_input_label: "Phone number",
	phone_input_placeholder: "Your phone number",
	token_input_label: "Token",
	token_input_placeholder: "Your Otp token",
	button_label: "Verify token",
	loading_button_label: "Signing in ..."
};
var en = {
	sign_up: sign_up,
	sign_in: sign_in,
	magic_link: magic_link,
	forgotten_password: forgotten_password,
	update_password: update_password,
	verify_otp: verify_otp
};

export { AnimationTailwindClasses, AuthProviders, BaseAppearance, BaseAuth, CLASS_NAMES, I18nVariables, Localization, OtpType, PREPENDED_CLASS_NAMES, ProviderScopes, RedirectTo, SocialButtonSize, SocialLayout, SocialLayouts, Theme, ThemeMinimal, ThemeSupa, ThemeVariables, VIEWS, ViewForgottenPassword, ViewMagicLink, ViewSignIn, ViewSignUp, ViewType, ViewUpdatePassword, ViewVerifyOtp, ViewsMap, darkThemes, en, generateClassNames, merge, minimal, supabase, template };
