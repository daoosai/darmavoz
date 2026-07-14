import { useState, useEffect } from "react";
import { X, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { MaterialProps, DeliveryOption } from "./MaterialDetailScreen";
import { useCartStore } from "./store";
import { getImageUrl, baseURL } from "./utils";
import toast from "react-hot-toast";
import { PickupPointSelection } from "./PickupPointMapScreen";

interface MaterialBottomSheetProps {
  material: MaterialProps | null;
  onClose: () => void;
  pickupPoint?: PickupPointSelection | null;
}

const getTruckFallback = (capacity: number) =>
  capacity <= 5
    ? "/static/vehicles/zil-dump-truck.svg"
    : "/static/vehicles/kamaz-dump-truck.svg";

export default function MaterialBottomSheet({
  material,
  onClose,
  pickupPoint,
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
      if (pickupPoint?.delivery_options?.length) {
        setDeliveryOptions(pickupPoint.delivery_options);
        return;
      }
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
  }, [material, pickupPoint]);

  if (!material) return null;

  const materialImages = [
    material.primary_image_url,
    ...(material.media_files || []).map((media) => media.public_url),
    material.image_url,
  ].filter((url): url is string => Boolean(url));
  const images = materialImages.length
    ? Array.from(new Set(materialImages))
    : [getImageUrl(material)];

  const materialPrice = pickupPoint?.price ?? material.price;
  const isSubmitDisabled = !selectedOption;

  const handleSubmit = () => {
    if (!selectedOption) return;
    addToCart({ ...material, price: materialPrice }, selectedOption, comment, pickupPoint || undefined);
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
              <div className="h-1.5 w-12 rounded-full bg-gray-200" />
            </div>

            <button
              onClick={onClose}
              className="absolute right-4 top-4 z-50 rounded-full bg-gray-100 p-2 text-gray-500 shadow-sm hover:bg-gray-200"
            >
              <X className="w-5 h-5" />
            </button>

            <div
              className="overflow-y-auto px-4 pb-6 flex-1 flex flex-col gap-6"
              style={{ scrollbarWidth: "none" }}
            >
              {/* Header and Images */}
              <div>
                <h2 className="mb-3 text-2xl font-bold text-gray-900">
                  {material?.name}
                </h2>
                <div className="group relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-gray-100">
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
              {pickupPoint && (
                <div className="rounded-xl border border-gray-200 bg-white p-4">
                  <span className="text-xs uppercase tracking-wider text-gray-500">Точка забора</span>
                  <p className="font-bold text-gray-900">{pickupPoint.name}</p>
                </div>
              )}
              <div>
                <h3 className="mb-3 font-semibold text-gray-900">
                  Выберите кубатуру
                </h3>
                {isLoadingOptions ? (
                  <div className="flex justify-center py-4">
                    <Loader2 className="h-6 w-6 animate-spin text-gray-300" />
                  </div>
                ) : (
                  <div className="flex gap-3 overflow-x-auto pb-2 hide-scrollbar -mx-4 px-4">
                    {[...deliveryOptions]
                      .sort(
                        (a, b) => (a.capacity_m3 || 0) - (b.capacity_m3 || 0),
                      )
                      .map((option) => {
                        const isSelected = selectedOption?.id === option.id;
                        const fallbackImage = getTruckFallback(option.capacity_m3 || 0);
                        const imgSrc =
                          option.media_files?.[0]?.public_url ||
                          option.primary_image_url ||
                          option.image_url ||
                          fallbackImage;

                        return (
                          <button
                            key={option.id}
                            onClick={() => setSelectedOption(option)}
                            className={`shrink-0 min-w-[130px] p-3 rounded-2xl border text-left transition-all ${
                              isSelected
                                ? "border-sky-500 bg-sky-50 shadow-sm ring-1 ring-sky-200"
                                : "border-gray-200 bg-white hover:border-gray-300"
                            }`}
                          >
                            <div className="w-full h-16 bg-white rounded-lg mb-2 overflow-hidden flex items-center justify-center">
                              <img
                                src={imgSrc}
                                alt={option.title}
                                className="max-w-full max-h-full object-contain"
                                onError={(event) => {
                                  event.currentTarget.onerror = null;
                                  event.currentTarget.src = fallbackImage;
                                }}
                              />
                            </div>
                            <span
                              className={`mb-1 block whitespace-nowrap text-base font-semibold ${isSelected ? "text-sky-600" : "text-gray-900"}`}
                            >
                              {option.capacity_m3} м³
                            </span>
                            <span
                              className={`block whitespace-nowrap text-xs font-medium ${isSelected ? "text-sky-600" : "text-gray-500"}`}
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
                  <h3 className="mb-2 font-semibold text-gray-900">
                    Описание
                  </h3>
                  <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">
                    {material.description}
                  </p>
                </div>
              )}
              {pickupPoint?.description && (
                <div>
                  <h3 className="mb-2 font-semibold text-gray-900">О точке</h3>
                  <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">
                    {pickupPoint.description}
                  </p>
                </div>
              )}

              {/* Comment */}
              <div className="flex flex-col gap-4">
                <div>
                  <h3 className="mb-2 font-semibold text-gray-900">
                    Комментарий для водителя
                  </h3>
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Опционально..."
                    className="h-20 w-full resize-none rounded-xl border border-gray-200 bg-gray-50 p-3.5 text-sm text-gray-900 placeholder-gray-400 transition-all focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-100"
                  />
                </div>
              </div>
            </div>

            {/* Bottom Bar */}
            <div className="w-full bg-white border-t border-gray-100 px-6 py-4 mt-6 flex justify-center items-center">
              <button
                disabled={isSubmitDisabled}
                onClick={handleSubmit}
                className="w-full rounded-xl bg-sky-500 px-6 py-3.5 text-center font-bold text-white shadow-md transition-all hover:bg-sky-600 disabled:opacity-50"
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
