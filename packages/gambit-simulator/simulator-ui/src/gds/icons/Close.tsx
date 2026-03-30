import React from "react";

type IconProps = React.SVGProps<SVGSVGElement> & {
  title?: string;
};

export function CloseIcon({ title, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 14 14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      {title && <title>{title}</title>}
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M2.73285 0.492584L7 4.75973L11.2671 0.492584C12.7608 -1.00102 15.001 1.23936 13.5074 2.73285L9.24027 7L13.5074 11.2671C15.001 12.7608 12.7606 15.001 11.2671 13.5074L7 9.24027L2.73285 13.5074C1.23925 15.001 -1.00102 12.7606 0.492584 11.2671L4.75973 7L0.492584 2.73285C-1.00102 1.23925 1.23936 -1.00102 2.73285 0.492584Z"
        fill="currentColor"
      />
    </svg>
  );
}
