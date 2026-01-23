import { ChevronDownIcon } from "./icons/ChevronDown.tsx";
import { CircleInfoIcon } from "./icons/CircleInfo.tsx";
import { CircleSolidChevronDownIcon } from "./icons/CircleSolidChevronDown.tsx";
import { CopiedIcon } from "./icons/Copied.tsx";
import { CopyIcon } from "./icons/Copy.tsx";
import { FlagIcon } from "./icons/Flag.tsx";
import { ReviewIcon } from "./icons/Review.tsx";

const ICONS = {
  chevronDown: ChevronDownIcon,
  flag: FlagIcon,
  circleSolidChevronDown: CircleSolidChevronDownIcon,
  copy: CopyIcon,
  copied: CopiedIcon,
  circleInfo: CircleInfoIcon,
  review: ReviewIcon,
};

export type IconName = keyof typeof ICONS;

type IconProps = {
  name: IconName;
  size?: number | string;
  className?: string;
  title?: string;
};

export default function Icon({
  name,
  size = "1em",
  className,
  title,
}: IconProps) {
  const Svg = ICONS[name];
  const ariaHidden = title ? undefined : true;
  const role = title ? "img" : undefined;
  return (
    <Svg
      width={size}
      height={size}
      className={className}
      aria-hidden={ariaHidden}
      role={role}
      focusable="false"
      title={title}
    />
  );
}
