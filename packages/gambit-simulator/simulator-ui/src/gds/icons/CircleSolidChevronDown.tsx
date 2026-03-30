import React from "react";

type IconProps = React.SVGProps<SVGSVGElement> & {
  title?: string;
};

export function CircleSolidChevronDownIcon({ title, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 14 14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      {title && <title>{title}</title>}
      <path
        d="M6.78403 0C3.04603 0 0 3.04603 0 6.78403C0 10.522 3.04603 13.5681 6.78403 13.5681C10.522 13.5681 13.5681 10.522 13.5681 6.78403C13.5681 3.04603 10.522 0 6.78403 0ZM9.53834 6.28879L7.14358 8.68356C7.04182 8.78532 6.91292 8.83281 6.78403 8.83281C6.65513 8.83281 6.52624 8.78532 6.42448 8.68356L4.02971 6.28879C3.83298 6.09206 3.83298 5.76642 4.02971 5.56969C4.22645 5.37295 4.55208 5.37295 4.74882 5.56969L6.78403 7.6049L8.81924 5.56969C9.01597 5.37295 9.34161 5.37295 9.53834 5.56969C9.73508 5.76642 9.73508 6.08527 9.53834 6.28879Z"
        fill="currentColor"
      />
    </svg>
  );
}
