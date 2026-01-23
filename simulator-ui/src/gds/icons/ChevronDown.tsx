import React from "react";

type IconProps = React.SVGProps<SVGSVGElement> & {
  title?: string;
};

export function ChevronDownIcon({ title, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 7 3"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      {title && <title>{title}</title>}
      <path
        d="M6.8648 1.05185L3.95833 3.95833C3.83482 4.08183 3.67838 4.13947 3.52194 4.13947C3.3655 4.13947 3.20906 4.08183 3.08556 3.95833L0.179082 1.05185C-0.059694 0.813073 -0.059694 0.417858 0.179082 0.179082C0.417858 -0.059694 0.813073 -0.059694 1.05185 0.179082L3.52194 2.64918L5.99204 0.179082C6.23081 -0.059694 6.62603 -0.059694 6.8648 0.179082C7.10358 0.417858 7.10358 0.804839 6.8648 1.05185Z"
        fill="currentColor"
      />
    </svg>
  );
}
