import { create } from "zustand";
import { persist } from "zustand/middleware";
import { MaterialProps, DeliveryOption } from "./MaterialDetailScreen";

export interface CartItem {
  id: string; // unique id for the cart item
  material: MaterialProps;
  deliveryOption: DeliveryOption;
  comment?: string;
  quantity: number;
}

interface CartState {
  cartItems: CartItem[];
  addToCart: (
    material: MaterialProps,
    deliveryOption: DeliveryOption,
    comment?: string,
  ) => void;
  removeFromCart: (id: string) => void;
  increaseQuantity: (id: string) => void;
  decreaseQuantity: (id: string) => void;
  clearCart: () => void;
  getTotalPrice: () => number;
}

export type UserRole = "driver" | "logist" | "admin" | "client" | null;

interface AuthState {
  token: string | null;
  role: UserRole;
  driverId: string | null;
  login: (token: string, role: UserRole, driverId?: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      role: null,
      driverId: null,
      login: (token, role, driverId) => set({ token, role, driverId: driverId || null }),
      logout: () => set({ token: null, role: null, driverId: null }),
    }),
    {
      name: "auth-storage", // unique name
    }
  )
);

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
          quantity: 1,
        },
      ],
    }));
  },
  removeFromCart: (id) => {
    set((state) => ({ cartItems: state.cartItems.filter((i) => i.id !== id) }));
  },
  increaseQuantity: (id) => {
    set((state) => ({
      cartItems: state.cartItems.map((item) =>
        item.id === id && item.quantity < 10
          ? { ...item, quantity: item.quantity + 1 }
          : item,
      ),
    }));
  },
  decreaseQuantity: (id) => {
    set((state) => ({
      cartItems: state.cartItems.map((item) =>
        item.id === id && item.quantity > 1
          ? { ...item, quantity: item.quantity - 1 }
          : item,
      ),
    }));
  },
  clearCart: () => {
    set({ cartItems: [] });
  },
  getTotalPrice: () => {
    return get().cartItems.reduce(
      (total, item) =>
        total +
        item.material.price * item.deliveryOption.capacity_m3 * item.quantity,
      0,
    );
  },
}));
