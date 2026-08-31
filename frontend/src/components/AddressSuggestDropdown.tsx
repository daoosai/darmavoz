import { useEffect, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

interface Props {
  anchorRef: RefObject<HTMLElement | null>;
  isOpen: boolean;
  children: ReactNode;
}

interface Position {
  top: number;
  left: number;
  width: number;
}

const EMPTY_POSITION: Position = { top: 0, left: 0, width: 0 };

export default function AddressSuggestDropdown({ anchorRef, isOpen, children }: Props) {
  const [position, setPosition] = useState<Position>(EMPTY_POSITION);

  useEffect(() => {
    if (!isOpen) return undefined;

    const updatePosition = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;

      const rect = anchor.getBoundingClientRect();
      setPosition({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchorRef, isOpen]);

  if (!isOpen || typeof document === "undefined" || position.width === 0) {
    return null;
  }

  return createPortal(
    <ul
      role="listbox"
      className="fixed z-[999999] max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-2xl"
      style={{ top: position.top, left: position.left, width: position.width }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {children}
    </ul>,
    document.body,
  );
}
