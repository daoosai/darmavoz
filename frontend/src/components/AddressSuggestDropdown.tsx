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
  maxHeight: number;
  openAbove: boolean;
}

const EMPTY_POSITION: Position = { top: 0, left: 0, width: 0, maxHeight: 224, openAbove: false };

export default function AddressSuggestDropdown({ anchorRef, isOpen, children }: Props) {
  const [position, setPosition] = useState<Position>(EMPTY_POSITION);

  useEffect(() => {
    if (!isOpen) return undefined;

    const updatePosition = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;

      const rect = anchor.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const openAbove = below < 224 && above > below;
      const maxHeight = Math.max(0, Math.min(224, openAbove ? above : below));
      setPosition({
        top: openAbove ? rect.top - 4 : rect.bottom + 4,
        left: rect.left,
        width: rect.width,
        maxHeight,
        openAbove,
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
      style={{ top: position.top, left: position.left, width: position.width, maxHeight: position.maxHeight, transform: position.openAbove ? "translateY(-100%)" : undefined }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {children}
    </ul>,
    document.body,
  );
}
