import React, { useState } from "react";
import { ShoppingCart, X, ImageIcon, Loader2, MapPin } from "lucide-react";
import { useCartStore } from "./store";
import { getImageUrl, baseURL } from "./utils";
import toast from "react-hot-toast";

export default function CartScreen({
  onGoToHome,
  onGoToOrders,
}: {
  onGoToHome: () => void;
  onGoToOrders: () => void;
}) {
  const { cartItems, removeFromCart, getTotalPrice, clearCart } =
    useCartStore();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [globalAddress, setGlobalAddress] = useState("");

  const handleCheckout = async () => {
    if (cartItems.length === 0 || !globalAddress.trim()) return;

    try {
      setIsSubmitting(true);

      const requests = cartItems.map((item) =>
        fetch(`${baseURL}/orders/checkout`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            session_key: "demo-session",
          },
          body: JSON.stringify({
            material_id: item.material.id,
            delivery_option_id: item.deliveryOption.id,
            address: globalAddress,
            notes: item.comment || "",
            source: "web",
          }),
        }),
      );

      const responses = await Promise.all(requests);
      const hasErrors = responses.some((res) => !res.ok);

      if (!hasErrors) {
        toast.success("Заказ успешно оформлен");
        clearCart();
        setGlobalAddress("");
        onGoToOrders();
      } else {
        alert(
          "Некоторые заказы не удалось оформить. Пожалуйста, попробуйте еще раз.",
        );
      }
    } catch (err) {
      console.error(err);
      alert("Сетевая ошибка при оформлении заказа.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (cartItems.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center h-full min-h-[400px]">
        <div className="w-20 h-20 bg-slate-100 rounded-[28px] flex items-center justify-center mb-5 border border-slate-200">
          <ShoppingCart className="w-10 h-10 text-slate-300" />
        </div>
        <h3 className="text-lg font-semibold text-slate-900 mb-1">
          Добавьте товары в корзину
        </h3>
        <p className="text-sm text-slate-500 mb-6">
          Ваша корзина пуста. Перейдите в каталог, чтобы выбрать материалы для
          доставки.
        </p>
        <button
          onClick={onGoToHome}
          className="bg-[#2DB0E6] text-white px-8 py-3 rounded-full font-medium shadow-sm active:bg-[#209dd0] transition-colors"
        >
          К списку товаров
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-full pb-4 relative">
      <div className="px-4 pb-4 flex-1">
        <h2 className="text-2xl font-bold text-slate-900 mb-4 pt-2">Корзина</h2>

        {/* List of items */}
        <div className="flex flex-col gap-4 mb-6">
          {cartItems.map((item) => (
            <div
              key={item.id}
              className="bg-white p-3 rounded-[24px] flex flex-row items-start shadow-sm border border-slate-100"
            >
              <div className="w-[80px] h-[80px] bg-slate-100 rounded-[16px] overflow-hidden shrink-0 flex items-center justify-center">
                {getImageUrl(item.material) !== "/placeholder.jpg" ? (
                  <img
                    src={getImageUrl(item.material)}
                    alt={item.material.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <ImageIcon className="w-6 h-6 text-slate-300" />
                )}
              </div>
              <div className="flex flex-col justify-between flex-1 ml-3 h-[80px]">
                <div className="flex justify-between items-start">
                  <h3 className="font-bold text-[16px] text-slate-900 leading-tight line-clamp-1">
                    {item.material.name}
                  </h3>
                  <button
                    onClick={() => removeFromCart(item.id)}
                    className="p-1 -mt-1 -mr-1 text-slate-400 hover:text-red-500 hover:bg-slate-50 transition-colors rounded-full"
                  >
                    <X className="w-4 h-4" strokeWidth={2.5} />
                  </button>
                </div>

                <div className="text-[14px] text-slate-500 line-clamp-1">
                  {item.deliveryOption.title} ({item.deliveryOption.capacity_m3}{" "}
                  м³)
                </div>

                {item.comment && (
                  <div className="text-[13px] italic text-slate-400 line-clamp-1 mt-0.5">
                    {item.comment}
                  </div>
                )}

                <div className="font-bold text-[#2DB0E6] text-[16px] mt-auto">
                  {item.material.price * item.deliveryOption.capacity_m3} ₽
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Global Address Field */}
        <div className="bg-white rounded-[24px] p-4 shadow-sm border border-slate-100">
          <h3 className="font-semibold text-slate-800 mb-2 ml-1 text-[15px]">
            Адрес доставки
          </h3>
          <input
            type="text"
            value={globalAddress}
            onChange={(e) => setGlobalAddress(e.target.value)}
            placeholder="Укажите точный адрес..."
            className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#2DB0E6]/20 focus:border-[#2DB0E6]/50 transition-all"
          />
        </div>
      </div>

      {/* Sticky Bottom Bar */}
      <div className="sticky top-[100vh] mt-4 w-full bg-white border-t border-slate-100 shadow-[0_-10px_20px_rgba(0,0,0,0.03)] px-4 py-4 flex flex-wrap items-center justify-between z-10 rounded-2xl">
        <div className="flex flex-col">
          <span className="text-xs text-slate-500 font-medium mb-0.5">
            Итого:
          </span>
          <span className="font-bold text-lg text-slate-900">
            {getTotalPrice()} ₽
          </span>
        </div>
        <button
          disabled={isSubmitting || !globalAddress.trim()}
          onClick={handleCheckout}
          className="bg-[#2DB0E6] text-white px-8 py-3.5 rounded-xl font-semibold shadow-sm active:bg-[#209dd0] transition-colors disabled:opacity-50 flex items-center gap-2"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" /> Оформляем...
            </>
          ) : (
            "Оформить заказ"
          )}
        </button>
      </div>
    </div>
  );
}
