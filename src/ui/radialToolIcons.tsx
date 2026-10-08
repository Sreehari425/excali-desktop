import type { ReactNode } from "react";
import type { ToolType } from "@excalidraw/excalidraw/types";

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

type IconProps = { className?: string };

function Svg({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <svg
      className={className}
      width="22"
      height="22"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function RadialToolIcon({ type, className }: { type: ToolType; className?: string }) {
  const props: IconProps = { className };
  switch (type) {
    case "selection":
      return (
        <Svg {...props}>
          <path d="M5 3l4.5 16 2.2-6.3L18 10.5 5 3z" {...stroke} />
        </Svg>
      );
    case "hand":
      return (
        <Svg {...props}>
          <path d="M8 11V7.5a1.5 1.5 0 013 0V11M11 10.5V6.5a1.5 1.5 0 013 0V11M14 11V7.8a1.5 1.5 0 013 0V14c0 3-1.8 5-4.5 5H12c-3 0-5-2-5-5v-3.5a1.5 1.5 0 013 0V11" {...stroke} />
        </Svg>
      );
    case "rectangle":
      return (
        <Svg {...props}>
          <rect x="5" y="6" width="14" height="12" rx="1.5" {...stroke} />
        </Svg>
      );
    case "diamond":
      return (
        <Svg {...props}>
          <path d="M12 4l8 8-8 8-8-8 8-8z" {...stroke} />
        </Svg>
      );
    case "ellipse":
      return (
        <Svg {...props}>
          <ellipse cx="12" cy="12" rx="8" ry="6" {...stroke} />
        </Svg>
      );
    case "arrow":
      return (
        <Svg {...props}>
          <path d="M5 17L17 5M17 5h-6M17 5v6" {...stroke} />
        </Svg>
      );
    case "line":
      return (
        <Svg {...props}>
          <path d="M5 17L19 7" {...stroke} />
        </Svg>
      );
    case "freedraw":
      return (
        <Svg {...props}>
          <path d="M17 3a2.828 2.828 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z" {...stroke} />
          <path d="M15 5l4 4" {...stroke} />
        </Svg>
      );
    case "text":
      return (
        <Svg {...props}>
          <path d="M6 6h12M12 6v12" {...stroke} />
        </Svg>
      );
    case "eraser":
      return (
        <Svg {...props}>
          <path d="M15 5l4 4-9 9H6l-2-2 9-9zM8 16h8" {...stroke} />
        </Svg>
      );
    case "stickynote":
      return (
        <Svg {...props}>
          <path d="M7 5h8l4 4v10H7V5z" {...stroke} />
          <path d="M15 5v4h4" {...stroke} />
        </Svg>
      );
    case "laser":
      return (
        <Svg {...props}>
          <circle cx="12" cy="12" r="2.5" fill="currentColor" />
          <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" {...stroke} />
        </Svg>
      );
    default:
      return (
        <Svg {...props}>
          <circle cx="12" cy="12" r="7" {...stroke} />
        </Svg>
      );
  }
}
