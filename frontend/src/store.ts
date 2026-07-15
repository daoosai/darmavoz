import { create } from "zustand";
import { persist } from "zustand/middleware";
import { MaterialProps, DeliveryOption } from "./MaterialDetailScreen";
import { PickupPointSelection } from "./PickupPointMapScreen";
import toast from "react-hot-toast";

export interface CartItem {
  id: string; // unique id for the cart item
  material: MaterialProps;
  deliveryOption: DeliveryOption;
  pickupPoint?: PickupPointSelection;
  comment?: string;
  quantity: number;
  volume: number;
}

interface CartState {
  cartItems: CartItem[];
  addToCart: (
    material: MaterialProps,
    deliveryOption: DeliveryOption,
    comment?: string,
    pickupPoint?: PickupPointSelection,
    availableDeliveryOptions?: DeliveryOption[],
  ) => boolean;
  removeFromCart: (id: string) => void;
  clearCart: () => void;
  getTotalPrice: () => number;
}

export type UserRole = "driver" | "logist" | "admin" | "client" | "supplier" | null;

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
      logout: () => {
        set({ token: null, role: null, driverId: null });
        useAddressStore.getState().setSelectedAddress("");
        localStorage.removeItem('address-storage');
      },
    }),
    {
      name: "auth-storage", // unique name
    }
  )
);

interface AddressState {
  selectedAddress: string;
  setSelectedAddress: (address: string) => void;
}

export const useAddressStore = create<AddressState>()(
  persist(
    (set) => ({
      selectedAddress: "",
      setSelectedAddress: (address: string) => set({ selectedAddress: address }),
    }),
    {
      name: "address-storage",
    }
  )
);

export const useCartStore = create<CartState>((set, get) => ({
  cartItems: [],
  addToCart: (
    material,
    deliveryOption,
    comment,
    pickupPoint,
    availableDeliveryOptions = [],
  ) => {
    const existingItems = get().cartItems.filter(
      (item) => item.material.id === material.id,
    );
    const uniqueOptions = Array.from(
      new Map(
        [deliveryOption, ...availableDeliveryOptions].map((option) => [option.id, option]),
      ).values(),
    ).sort((first, second) => Number(first.capacity_m3) - Number(second.capacity_m3));

    if (existingItems.length > 0) {
      const existingVolume = existingItems.reduce(
        (sum, item) =>
          sum +
          Number(
            item.volume ?? item.deliveryOption.capacity_m3 * item.quantity,
          ),
        0,
      );
      const newVolume = existingVolume + Number(deliveryOption.capacity_m3);
      const upgradedOption = uniqueOptions.find(
        (option) => Number(option.capacity_m3) >= newVolume,
      );

      if (!upgradedOption) {
        toast.error(
          "Максимальный объем одной машины превышен. Пожалуйста, оформите второй заказ.",
        );
        return false;
      }

      const targetItem = existingItems[0];
      set((state) => ({
        cartItems: state.cartItems
          .filter(
            (item) =>
              item.material.id !== material.id || item.id === targetItem.id,
          )
          .map((item) =>
            item.id === targetItem.id
              ? {
                  ...item,
                  material: { ...item.material, ...material },
                  deliveryOption: upgradedOption,
                  pickupPoint: undefined,
                  comment: item.comment || comment,
                  quantity: 1,
                  volume: newVolume,
                }
              : item,
          ),
      }));
      return true;
    }

    set((state) => ({
      cartItems: [
        ...state.cartItems,
        {
          id: Math.random().toString(36).substring(7),
          material,
          deliveryOption,
          pickupPoint,
          comment,
          quantity: 1,
          volume: Number(deliveryOption.capacity_m3),
        },
      ],
    }));
    return true;
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
        total +
        (item.pickupPoint?.price ?? item.material.price) *
          Number(item.volume ?? item.deliveryOption.capacity_m3 * item.quantity),
      0,
    );
  },
}));
