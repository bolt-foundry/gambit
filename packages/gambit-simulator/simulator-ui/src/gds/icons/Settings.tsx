import React from "react";

type IconProps = React.SVGProps<SVGSVGElement> & {
  title?: string;
};

export function SettingsIcon({ title, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      {title && <title>{title}</title>}
      <path
        d="M8.85 1.77C9.32 0.74 10.68 0.74 11.15 1.77L11.61 2.79C11.91 3.45 12.65 3.8 13.36 3.66L14.45 3.44C15.56 3.22 16.52 4.18 16.3 5.29L16.08 6.38C15.94 7.09 16.29 7.83 16.95 8.13L17.97 8.59C19 9.06 19 10.42 17.97 10.89L16.95 11.35C16.29 11.65 15.94 12.39 16.08 13.1L16.3 14.19C16.52 15.3 15.56 16.26 14.45 16.04L13.36 15.82C12.65 15.68 11.91 16.03 11.61 16.69L11.15 17.71C10.68 18.74 9.32 18.74 8.85 17.71L8.39 16.69C8.09 16.03 7.35 15.68 6.64 15.82L5.55 16.04C4.44 16.26 3.48 15.3 3.7 14.19L3.92 13.1C4.06 12.39 3.71 11.65 3.05 11.35L2.03 10.89C1 10.42 1 9.06 2.03 8.59L3.05 8.13C3.71 7.83 4.06 7.09 3.92 6.38L3.7 5.29C3.48 4.18 4.44 3.22 5.55 3.44L6.64 3.66C7.35 3.8 8.09 3.45 8.39 2.79L8.85 1.77Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <circle
        cx="10"
        cy="10"
        r="2.7"
        stroke="currentColor"
        strokeWidth="1.4"
      />
    </svg>
  );
}
