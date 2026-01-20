// src/theming/defaultThemes.ts
var ThemeSupa = {
  default: {
    colors: {
      brand: "hsl(153 60.0% 53.0%)",
      brandAccent: "hsl(154 54.8% 45.1%)",
      brandButtonText: "white",
      defaultButtonBackground: "white",
      defaultButtonBackgroundHover: "#eaeaea",
      defaultButtonBorder: "lightgray",
      defaultButtonText: "gray",
      dividerBackground: "#eaeaea",
      inputBackground: "transparent",
      inputBorder: "lightgray",
      inputBorderHover: "gray",
      inputBorderFocus: "gray",
      inputText: "black",
      inputLabelText: "gray",
      inputPlaceholder: "darkgray",
      messageText: "#2b805a",
      messageBackground: "#e7fcf1",
      messageBorder: "#d0f3e1",
      messageTextDanger: "#ff6369",
      messageBackgroundDanger: "#fff8f8",
      messageBorderDanger: "#822025",
      anchorTextColor: "gray",
      anchorTextHoverColor: "darkgray"
    },
    space: {
      spaceSmall: "4px",
      spaceMedium: "8px",
      spaceLarge: "16px",
      labelBottomMargin: "8px",
      anchorBottomMargin: "4px",
      emailInputSpacing: "4px",
      socialAuthSpacing: "4px",
      buttonPadding: "10px 15px",
      inputPadding: "10px 15px"
    },
    fontSizes: {
      baseBodySize: "13px",
      baseInputSize: "14px",
      baseLabelSize: "14px",
      baseButtonSize: "14px"
    },
    fonts: {
      bodyFontFamily: `ui-sans-serif, sans-serif`,
      buttonFontFamily: `ui-sans-serif, sans-serif`,
      inputFontFamily: `ui-sans-serif, sans-serif`,
      labelFontFamily: `ui-sans-serif, sans-serif`
    },
    // fontWeights: {},
    // lineHeights: {},
    // letterSpacings: {},
    // sizes: {},
    borderWidths: {
      buttonBorderWidth: "1px",
      inputBorderWidth: "1px"
    },
    // borderStyles: {},
    radii: {
      borderRadiusButton: "4px",
      buttonBorderRadius: "4px",
      inputBorderRadius: "4px"
    }
    // shadows: {},
    // zIndices: {},
    // transitions: {},
  },
  dark: {
    colors: {
      brandButtonText: "white",
      defaultButtonBackground: "#2e2e2e",
      defaultButtonBackgroundHover: "#3e3e3e",
      defaultButtonBorder: "#3e3e3e",
      defaultButtonText: "white",
      dividerBackground: "#2e2e2e",
      inputBackground: "#1e1e1e",
      inputBorder: "#3e3e3e",
      inputBorderHover: "gray",
      inputBorderFocus: "gray",
      inputText: "white",
      inputPlaceholder: "darkgray",
      messageText: "#85e0b7",
      messageBackground: "#072719",
      messageBorder: "#2b805a",
      messageBackgroundDanger: "#1f1315"
    }
  }
};
var ThemeMinimal = {
  default: {
    colors: {
      brand: "black",
      brandAccent: "#333333",
      brandButtonText: "white",
      defaultButtonBackground: "white",
      defaultButtonBorder: "lightgray",
      defaultButtonText: "gray",
      dividerBackground: "#eaeaea",
      inputBackground: "transparent",
      inputBorder: "lightgray",
      inputText: "black",
      inputPlaceholder: "darkgray",
      messageText: "#2b805a",
      messageBackground: "#e7fcf1",
      messageBorder: "#d0f3e1",
      messageTextDanger: "#ff6369",
      messageBackgroundDanger: "#fff8f8",
      messageBorderDanger: "#822025"
    },
    space: {
      spaceSmall: "4px",
      spaceMedium: "8px",
      spaceLarge: "16px"
    },
    fontSizes: {
      baseInputSize: "14px",
      baseLabelSize: "12px"
    },
    fonts: {
      bodyFontFamily: "",
      inputFontFamily: "",
      buttonFontFamily: "",
      labelFontFamily: ""
      // linkFontFamily: '',
    },
    // fontWeights: {},
    // lineHeights: {},
    // letterSpacings: {},
    // sizes: {},
    borderWidths: {},
    // borderStyles: {},
    radii: {}
    // shadows: {},
    // zIndices: {},
    // transitions: {},
  },
  dark: {
    colors: {
      brand: "white",
      brandAccent: "#afafaf",
      brandButtonText: "black",
      defaultButtonBackground: "#080808",
      defaultButtonBorder: "black",
      defaultButtonText: "white",
      dividerBackground: "black",
      inputBackground: "transparent",
      inputBorder: "gray",
      inputText: "black",
      inputPlaceholder: "darkgray",
      messageText: "#85e0b7",
      messageBackground: "#072719",
      messageBorder: "#2b805a",
      messageBackgroundDanger: "#1f1315"
    }
  }
};

// src/theming/Themes.ts
var supabase = {
  colors: {
    brand: "hsl(153 60.0% 53.0%)",
    brandAccent: "hsl(154 54.8% 45.1%)",
    brandButtonText: "white",
    defaultButtonBackground: "white",
    defaultButtonBackgroundHover: "#eaeaea",
    defaultButtonBorder: "lightgray",
    defaultButtonText: "gray",
    dividerBackground: "#eaeaea",
    inputBackground: "transparent",
    inputBorder: "lightgray",
    inputBorderHover: "gray",
    inputBorderFocus: "gray",
    inputText: "black",
    inputLabelText: "gray",
    inputPlaceholder: "darkgray",
    messageText: "gray",
    messageTextDanger: "red",
    anchorTextColor: "gray",
    anchorTextHoverColor: "darkgray"
  },
  space: {
    spaceSmall: "4px",
    spaceMedium: "8px",
    spaceLarge: "16px",
    labelBottomMargin: "8px",
    anchorBottomMargin: "4px",
    emailInputSpacing: "4px",
    socialAuthSpacing: "4px",
    buttonPadding: "10px 15px",
    inputPadding: "10px 15px"
  },
  fontSizes: {
    baseBodySize: "13px",
    baseInputSize: "14px",
    baseLabelSize: "14px",
    baseButtonSize: "14px"
  },
  fonts: {
    bodyFontFamily: `ui-sans-serif, sans-serif`,
    buttonFontFamily: `ui-sans-serif, sans-serif`,
    inputFontFamily: `ui-sans-serif, sans-serif`,
    labelFontFamily: `ui-sans-serif, sans-serif`
  },
  // fontWeights: {},
  // lineHeights: {},
  // letterSpacings: {},
  // sizes: {},
  borderWidths: {
    buttonBorderWidth: "1px",
    inputBorderWidth: "1px"
  },
  // borderStyles: {},
  radii: {
    borderRadiusButton: "4px",
    buttonBorderRadius: "4px",
    inputBorderRadius: "4px"
  }
  // shadows: {},
  // zIndices: {},
  // transitions: {},
};
var defaultDarkTheme = {
  colors: {
    brandButtonText: "white",
    defaultButtonBackground: "#2e2e2e",
    defaultButtonBackgroundHover: "#3e3e3e",
    defaultButtonBorder: "#3e3e3e",
    defaultButtonText: "white",
    dividerBackground: "#2e2e2e",
    inputBackground: "#1e1e1e",
    inputBorder: "#3e3e3e",
    inputBorderHover: "gray",
    inputBorderFocus: "gray",
    inputText: "white",
    inputPlaceholder: "darkgray"
  }
};
var minimal = {
  colors: {
    brand: "black",
    brandAccent: "#333333",
    brandButtonText: "white",
    defaultButtonBackground: "white",
    defaultButtonBorder: "lightgray",
    defaultButtonText: "gray",
    dividerBackground: "#eaeaea",
    inputBackground: "transparent",
    inputBorder: "lightgray",
    inputText: "black",
    inputPlaceholder: "darkgray"
  },
  space: {
    spaceSmall: "4px",
    spaceMedium: "8px",
    spaceLarge: "16px"
  },
  fontSizes: {
    baseInputSize: "14px",
    baseLabelSize: "12px"
  },
  fonts: {
    bodyFontFamily: "",
    inputFontFamily: "",
    buttonFontFamily: "",
    labelFontFamily: ""
    // linkFontFamily: '',
  },
  // fontWeights: {},
  // lineHeights: {},
  // letterSpacings: {},
  // sizes: {},
  borderWidths: {},
  // borderStyles: {},
  radii: {}
  // shadows: {},
  // zIndices: {},
  // transitions: {},
};
var minimalDark = {
  colors: {
    brand: "white",
    brandAccent: "#afafaf",
    brandButtonText: "black",
    defaultButtonBackground: "#080808",
    defaultButtonBorder: "black",
    defaultButtonText: "white",
    dividerBackground: "black",
    inputBackground: "transparent",
    inputBorder: "gray",
    inputText: "black",
    inputPlaceholder: "darkgray"
  }
};
var darkThemes = {
  supabase: defaultDarkTheme,
  minimal: minimalDark
};

// src/constants.ts
var VIEWS = {
  SIGN_IN: "sign_in",
  SIGN_UP: "sign_up",
  FORGOTTEN_PASSWORD: "forgotten_password",
  MAGIC_LINK: "magic_link",
  UPDATE_PASSWORD: "update_password",
  VERIFY_OTP: "verify_otp"
};
var PREPENDED_CLASS_NAMES = "supabase-auth-ui";
var CLASS_NAMES = {
  // interfaces
  ROOT: "root",
  SIGN_IN: VIEWS.SIGN_IN,
  SIGN_UP: VIEWS.SIGN_UP,
  FORGOTTEN_PASSWORD: VIEWS.FORGOTTEN_PASSWORD,
  MAGIC_LINK: VIEWS.MAGIC_LINK,
  UPDATE_PASSWORD: VIEWS.UPDATE_PASSWORD,
  // ui
  anchor: "ui-anchor",
  button: "ui-button",
  container: "ui-container",
  divider: "ui-divider",
  input: "ui-input",
  label: "ui-label",
  loader: "ui-loader",
  message: "ui-message"
};

// src/theming/utils.ts
function generateClassNames(classNameKey, defaultStyles, appearance) {
  var _a, _b;
  const classNames = [];
  const className = CLASS_NAMES[classNameKey];
  classNames.push(
    (appearance == null ? void 0 : appearance.prependedClassName) ? (appearance == null ? void 0 : appearance.prependedClassName) + "_" + className : PREPENDED_CLASS_NAMES + "_" + className
  );
  if ((_a = appearance == null ? void 0 : appearance.className) == null ? void 0 : _a[classNameKey]) {
    classNames.push((_b = appearance == null ? void 0 : appearance.className) == null ? void 0 : _b[classNameKey]);
  }
  if ((appearance == null ? void 0 : appearance.extend) === void 0 || (appearance == null ? void 0 : appearance.extend) === true) {
    classNames.push(defaultStyles);
  }
  return classNames;
}

// src/types.ts
var SocialLayouts = /* @__PURE__ */ ((SocialLayouts2) => {
  SocialLayouts2[SocialLayouts2["horizontal"] = 0] = "horizontal";
  SocialLayouts2[SocialLayouts2["vertical"] = 1] = "vertical";
  return SocialLayouts2;
})(SocialLayouts || {});

// src/utils.ts
function value(src, next) {
  let k;
  if (src && next && typeof src === "object" && typeof next === "object") {
    if (Array.isArray(next)) {
      for (k = 0; k < next.length; k++) {
        src[k] = value(src[k], next[k]);
      }
    } else {
      for (k in next) {
        src[k] = value(src[k], next[k]);
      }
    }
    return src;
  }
  return next;
}
function merge(target, ...args) {
  let len = args.length;
  for (let i = 0; i < len; i++) {
    target = value(target, args[i]);
  }
  return target;
}
function template(string, data) {
  return string.replace(
    /{{(\w+)}}/g,
    (placeholderWithDelimiters, placeholderWithoutDelimiters) => data.hasOwnProperty(placeholderWithoutDelimiters) ? data[placeholderWithoutDelimiters] : placeholderWithDelimiters
  );
}

// src/localization/en.json
var en_default = {
  sign_up: {
    email_label: "Email address",
    password_label: "Create a Password",
    email_input_placeholder: "Your email address",
    password_input_placeholder: "Your password",
    button_label: "Sign up",
    loading_button_label: "Signing up ...",
    social_provider_text: "Sign in with {{provider}}",
    link_text: "Don't have an account? Sign up",
    confirmation_text: "Check your email for the confirmation link"
  },
  sign_in: {
    email_label: "Email address",
    password_label: "Your Password",
    email_input_placeholder: "Your email address",
    password_input_placeholder: "Your password",
    button_label: "Sign in",
    loading_button_label: "Signing in ...",
    social_provider_text: "Sign in with {{provider}}",
    link_text: "Already have an account? Sign in"
  },
  magic_link: {
    email_input_label: "Email address",
    email_input_placeholder: "Your email address",
    button_label: "Send Magic Link",
    loading_button_label: "Sending Magic Link ...",
    link_text: "Send a magic link email",
    confirmation_text: "Check your email for the magic link"
  },
  forgotten_password: {
    email_label: "Email address",
    password_label: "Your Password",
    email_input_placeholder: "Your email address",
    button_label: "Send reset password instructions",
    loading_button_label: "Sending reset instructions ...",
    link_text: "Forgot your password?",
    confirmation_text: "Check your email for the password reset link"
  },
  update_password: {
    password_label: "New password",
    password_input_placeholder: "Your new password",
    button_label: "Update password",
    loading_button_label: "Updating password ...",
    confirmation_text: "Your password has been updated"
  },
  verify_otp: {
    email_input_label: "Email address",
    email_input_placeholder: "Your email address",
    phone_input_label: "Phone number",
    phone_input_placeholder: "Your phone number",
    token_input_label: "Token",
    token_input_placeholder: "Your Otp token",
    button_label: "Verify token",
    loading_button_label: "Signing in ..."
  }
};
export {
  CLASS_NAMES,
  PREPENDED_CLASS_NAMES,
  SocialLayouts,
  ThemeMinimal,
  ThemeSupa,
  VIEWS,
  darkThemes,
  en_default as en,
  generateClassNames,
  merge,
  minimal,
  supabase,
  template
};
//# sourceMappingURL=index.mjs.map