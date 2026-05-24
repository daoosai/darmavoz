import { create } from "zustand";
import { MaterialProps, DeliveryOption } from "./MaterialDetailScreen";

export interface CartItem {
  id: string; // unique id for the cart item
  material: MaterialProps;
  deliveryOption: DeliveryOption;
  comment?: string;
}

interface CartState {
  cartItems: CartItem[];
  addToCart: (
    material: MaterialProps,
    deliveryOption: DeliveryOption,
    comment?: string,
  ) => void;
  removeFromCart: (id: string) => void;
  clearCart: () => void;
  getTotalPrice: () => number;
}

export const useCartStore = create<CartState>((set, get) => ({
  cartItems: [],
  addToCart: (material, deliveryOption, comment) => {
    set((state) => ({
      cartItems: [
        ...state.cartItems,
        {
          id: Math.random().toString(36).substring(7),
          material,
          deliveryOption,
          comment,
        },
      ],
    }));
  },
  removeFromCart: (id) => {
    set((state) => ({ cartItems: state.cartItems.filter((i) => i.id !== id) }));
  },
  clearCart: () => {
    set({ cartItems: [] });
  },
  getTotalPrice: () => {
    return get().cartItems.reduce(
      (total, item) =>
        total + item.material.price * item.deliveryOption.capacity_m3,
      0,
    );
  },
}));
