import React, { useState, useEffect } from "react";
import { X, ImageIcon, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { MaterialProps, DeliveryOption } from "./MaterialDetailScreen";
import { useCartStore } from "./store";
import { getImageUrl, baseURL } from "./utils";
import toast from "react-hot-toast";

interface MaterialBottomSheetProps {
  material: MaterialProps | null;
  onClose: () => void;
}

export default function MaterialBottomSheet({
  material,
  onClose,
}: MaterialBottomSheetProps) {
  const [deliveryOptions, setDeliveryOptions] = useState<DeliveryOption[]>([]);
  const [selectedOption, setSelectedOption] = useState<DeliveryOption | null>(
    null,
  );
  const [isLoadingOptions, setIsLoadingOptions] = useState(false);
  const [comment, setComment] = useState("");
  const [activeImageIndex, setActiveImageIndex] = useState(0);

  const addToCart = useCartStore((state) => state.addToCart);

  useEffect(() => {
    if (!material) return;

    // Reset state on open
    setSelectedOption(null);
    setComment("");
    setActiveImageIndex(0);

    const fetchOptions = async () => {
      try {
        setIsLoadingOptions(true);
        const res = await fetch(`${baseURL}/catalog/delivery-options/`);
        if (res.ok) {
          const data = await res.json();
          const options = Array.isArray(data) ? data : data.results || [];
          setDeliveryOptions(options.filter((o: any) => o.is_active !== false));
        }
      } catch (err) {
        console.error("Error fetching delivery options", err);
      } finally {
        setIsLoadingOptions(false);
      }
    };
    fetchOptions();
  }, [material]);

  if (!material) return null;

  const images = material.media_files?.length
    ? material.media_files.map((m) => m.public_url)
    : [
        getImageUrl(material),
        "https://placehold.co/400x300/e2e8f0/64748b?text=Photo+2",
        "https://placehold.co/400x300/e2e8f0/64748b?text=Photo+3",
      ];

  const totalPrice = selectedOption
    ? material.price * selectedOption.capacity_m3
    : 0;
  const isSubmitDisabled = !selectedOption;

  const handleSubmit = () => {
    if (!selectedOption) return;
    addToCart(material, selectedOption, comment);
    toast.success("Товар добавлен в корзину");
    onClose();
  };

  return (
    <AnimatePresence>
      {material && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/50 z-[100] sm:rounded-[32px]"
          />
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="fixed bottom-0 left-0 w-full sm:max-w-md sm:left-[50%] sm:-translate-x-1/2 bg-white rounded-t-[16px] z-[101] flex flex-col max-h-[90%]"
          >
            {/* Handle for drag */}
            <div className="w-full flex justify-center py-3">
              <div className="w-12 h-1.5 bg-slate-200 rounded-full" />
            </div>

            <button
              onClick={onClose}
              className="absolute right-4 top-4 z-50 p-2 bg-slate-100 rounded-full text-slate-500 hover:bg-slate-200 shadow-sm"
            >
              <X className="w-5 h-5" />
            </button>

            <div
              className="overflow-y-auto px-4 pb-6 flex-1 flex flex-col gap-6"
              style={{ scrollbarWidth: "none" }}
            >
              {/* Header and Images */}
              <div>
                <h2 className="text-2xl font-bold text-slate-900 mb-3">
                  {material?.name}
                </h2>
                <div className="relative w-full aspect-[4/3] rounded-2xl overflow-hidden bg-slate-100 group">
                  <div
                    className="flex w-full h-full overflow-x-auto snap-x snap-mandatory hide-scrollbar"
                    onScroll={(e) => {
                      const scrollLeft = e.currentTarget.scrollLeft;
                      const width = e.currentTarget.clientWidth;
                      setActiveImageIndex(Math.round(scrollLeft / width));
                    }}
                  >
                    {images.map((src, i) => (
                      <div
                        key={i}
                        className="w-full h-full shrink-0 snap-center relative"
                      >
                        <img
                          src={src}
                          className="w-full h-full object-cover"
                          alt={`${material?.name} ${i + 1}`}
                        />
                      </div>
                    ))}
                  </div>
                  {/* Dots */}
                  <div className="absolute bottom-3 left-0 w-full flex justify-center gap-1.5">
                    {images.map((_, i) => (
                      <div
                        key={i}
                        className={`h-1.5 rounded-full transition-all ${i === activeImageIndex ? "w-4 bg-white" : "w-1.5 bg-white/50"}`}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* Delivery Options */}
              <div>
                <h3 className="font-semibold text-slate-800 mb-3">
                  Выберите кубатуру
                </h3>
                {isLoadingOptions ? (
                  <div className="flex justify-center py-4">
                    <Loader2 className="w-6 h-6 animate-spin text-slate-300" />
                  </div>
                ) : (
                  <div className="flex gap-3 overflow-x-auto pb-2 hide-scrollbar -mx-4 px-4">
                    {[...deliveryOptions]
                      .sort(
                        (a, b) => (a.capacity_m3 || 0) - (b.capacity_m3 || 0),
                      )
                      .map((option) => {
                        const isSelected = selectedOption?.id === option.id;
                        const imgSrc =
                          option.media_files?.[0]?.public_url ||
                          option.primary_image_url ||
                          option.image_url ||
                          "https://placehold.co/100x100/e2e8f0/64748b?text=Truck";

                        return (
                          <button
                            key={option.id}
                            onClick={() => setSelectedOption(option)}
                            className={`shrink-0 min-w-[130px] p-3 rounded-2xl border text-left transition-all ${
                              isSelected
                                ? "border-[#2DB0E6] bg-[#2DB0E6]/5 shadow-sm ring-1 ring-[#2DB0E6]/20"
                                : "border-slate-200 bg-white hover:border-slate-300"
                            }`}
                          >
                            <div className="w-full h-16 bg-white rounded-lg mb-2 overflow-hidden flex items-center justify-center">
                              <img
                                src={imgSrc}
                                alt={option.title}
                                className="max-w-full max-h-full object-contain"
                              />
                            </div>
                            <span
                              className={`block font-semibold text-base mb-1 whitespace-nowrap ${isSelected ? "text-[#2DB0E6]" : "text-slate-900"}`}
                            >
                              {option.capacity_m3} м³
                            </span>
                            <span
                              className={`block text-xs font-medium whitespace-nowrap ${isSelected ? "text-[#2DB0E6]/80" : "text-slate-500"}`}
                            >
                              {option.title}
                            </span>
                          </button>
                        );
                      })}
                  </div>
                )}
              </div>

              {/* Description */}
              {material.description && (
                <div>
                  <h3 className="font-semibold text-slate-800 mb-2">
                    Описание
                  </h3>
                  <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">
                    {material.description}
                  </p>
                </div>
              )}

              {/* Comment */}
              <div className="flex flex-col gap-4">
                <div>
                  <h3 className="font-semibold text-slate-800 mb-2">
                    Комментарий для водителя
                  </h3>
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Опционально..."
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#2DB0E6]/20 focus:border-[#2DB0E6]/50 transition-all resize-none h-20"
                  />
                </div>
              </div>
            </div>

            {/* Bottom Bar */}
            <div className="w-full bg-white border-t border-gray-100 px-6 py-4 mt-6 flex justify-center items-center">
              <button
                disabled={isSubmitDisabled}
                onClick={handleSubmit}
                className="w-full bg-[#2DB0E6] hover:bg-[#209ccf] text-white font-bold py-3.5 px-6 rounded-full shadow-md transition-all text-center disabled:opacity-50"
              >
                В корзину
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
