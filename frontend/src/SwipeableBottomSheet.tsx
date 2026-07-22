import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import {
  AnimatePresence,
  motion,
  useDragControls,
  type PanInfo,
  type Transition,
} from "motion/react";

interface SwipeableBottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  containerClassName?: string;
  overlayClassName?: string;
  sheetClassName?: string;
  showOverlay?: boolean;
  closeOnOverlayClick?: boolean;
  showHandle?: boolean;
  handleClassName?: string;
  dragThreshold?: number;
  dragVelocityThreshold?: number;
  transition?: Transition;
  enableDragToClose?: boolean;
}

const DEFAULT_TRANSITION: Transition = {
  type: "spring",
  bounce: 0,
  duration: 0.4,
};

export default function SwipeableBottomSheet({
  isOpen,
  onClose,
  children,
  containerClassName = "fixed inset-0 z-[9999] flex items-end justify-center sm:p-4",
  overlayClassName = "absolute inset-0 bg-black/40 backdrop-blur-sm",
  sheetClassName = "relative flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl",
  showOverlay = true,
  closeOnOverlayClick = true,
  showHandle = true,
  handleClassName = "h-1.5 w-12 rounded-full bg-slate-200",
  dragThreshold = 120,
  dragVelocityThreshold = 700,
  transition = DEFAULT_TRANSITION,
  enableDragToClose = true,
}: SwipeableBottomSheetProps) {
  const dragControls = useDragControls();

  const handleDragEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    if (!enableDragToClose) return;
    if (info.offset.y > dragThreshold || info.velocity.y > dragVelocityThreshold) {
      onClose();
    }
  };

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!enableDragToClose) return;
    dragControls.start(event, { snapToCursor: false });
  };

  return (
    <AnimatePresence>
      {isOpen ? (
        <div className={containerClassName}>
          {showOverlay ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className={overlayClassName}
              onClick={closeOnOverlayClick ? onClose : undefined}
            />
          ) : null}

          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={transition}
            drag={enableDragToClose ? "y" : false}
            dragControls={dragControls}
            dragListener={false}
            dragDirectionLock
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.24 }}
            onDragEnd={handleDragEnd}
            className={sheetClassName}
          >
            {showHandle ? (
              <div
                onPointerDown={startDrag}
                className="flex w-full cursor-grab justify-center pt-3 pb-1 active:cursor-grabbing touch-none"
              >
                <div className={handleClassName} />
              </div>
            ) : null}
            {children}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
