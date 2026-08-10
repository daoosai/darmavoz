import { create } from "zustand";
import { persist } from "zustand/middleware";
import { MaterialProps, DeliveryOption } from "./MaterialDetailScreen";
import { PickupPointSelection } from "./PickupPointMapScreen";
import toast from "react-hot-toast";
import { baseURL } from "./utils";
import type { PlacementPolicy, PlacementSummary } from "./placement";

export const getDeliveryOptionsForVolume = (
  deliveryOptions: DeliveryOption[],
) => Array.from(
  new Map(deliveryOptions.map((option) => [option.id, option])).values(),
)
  .filter((option) => option.is_active !== false && Number(option.capacity_m3) > 0)
  .sort((first, second) => Number(first.capacity_m3) - Number(second.capacity_m3));

export const findDeliveryOptionForVolume = (
  deliveryOptions: DeliveryOption[],
  volume: number,
) => getDeliveryOptionsForVolume(deliveryOptions).find(
  (option) => Number(option.capacity_m3) >= volume,
);

export interface CartItem {
  id: string; // unique id for the cart item
  material: MaterialProps;
  deliveryOption: DeliveryOption;
  pickupPoint?: PickupPointSelection;
  comment?: string;
  quantity: number;
  volume: number;
}

export interface ClientOrderSummary {
  id: string;
  status: string;
  address?: string | null;
  total_amount?: number | null;
  delivery_cost?: number | null;
  estimated_total_amount?: number | null;
  total_price?: number | null;
  created_at: string;
  items?: {
    material?: { name?: string | null } | null;
    quantity?: number;
  }[];
  driver?: {
    name: string;
    phone: string;
    vehicle?: {
      brand?: string;
      plate_number?: string;
      title?: string;
    };
  };
  delivery_option?: {
    capacity_m3: number;
    title: string;
  };
}

export const normalizeClientOrderSummary = <T extends ClientOrderSummary>(order: T): T => {
  const resolvedTotal =
    typeof order.total_price === "number"
      ? order.total_price
      : typeof order.estimated_total_amount === "number"
        ? order.estimated_total_amount
        : order.total_amount == null && order.delivery_cost == null
          ? null
          : Number(order.total_amount ?? 0) + Number(order.delivery_cost ?? 0);

  if (resolvedTotal == null) return order;

  return {
    ...order,
    total_amount: resolvedTotal,
    estimated_total_amount: resolvedTotal,
    total_price: resolvedTotal,
  };
};

interface ClientOrdersState {
  orders: ClientOrderSummary[];
  isLoading: boolean;
  setOrders: (orders: ClientOrderSummary[]) => void;
  setIsLoading: (isLoading: boolean) => void;
  clearOrders: () => void;
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
  updateItemVolume: (id: string, volume: number) => boolean;
  removeFromCart: (id: string) => void;
  clearCart: () => void;
  getTotalPrice: () => number;
}

export type UserRole =
  | "driver"
  | "logist"
  | "admin"
  | "client"
  | "supplier"
  | "equipment_owner"
  | null;

export interface CurrentUserProfile {
  id: string;
  name: string;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
}

export interface AdminModerationNotification {
  event: string;
  title: string;
  body: string;
  receivedAt: number;
}

const ADMIN_MODERATION_EVENTS = new Set([
  "pickup_point_pending_moderation",
  "equipment_listing_pending_moderation",
  "water_point_created",
  "water_point_updated",
]);

export const isAdminModerationEvent = (
  event: string | null | undefined,
): event is string => Boolean(event && ADMIN_MODERATION_EVENTS.has(event));

interface AuthState {
  token: string | null;
  role: UserRole;
  driverId: string | null;
  currentUser: CurrentUserProfile | null;
  login: (token: string, role: UserRole, driverId?: string) => void;
  logout: () => void;
  setCurrentUser: (currentUser: CurrentUserProfile | null) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      role: null,
      driverId: null,
      currentUser: null,
      login: (token, role, driverId) =>
        set({ token, role, driverId: driverId || null, currentUser: null }),
      logout: () => {
        set({ token: null, role: null, driverId: null, currentUser: null });
        useAddressStore.getState().clearSelectedAddress();
        useClientOrdersStore.getState().clearOrders();
        useAdminModerationStore.getState().reset();
        localStorage.removeItem('address-storage');
      },
      setCurrentUser: (currentUser) => set({ currentUser }),
    }),
    {
      name: "auth-storage", // unique name
    }
  )
);

interface AddressState {
  selectedAddress: string;
  setSelectedAddress: (address: string) => void;
  clearSelectedAddress: () => void;
}

export const useAddressStore = create<AddressState>()(
  persist(
    (set) => ({
      selectedAddress: "",
      setSelectedAddress: (address: string) => set({ selectedAddress: address }),
      clearSelectedAddress: () => set({ selectedAddress: "" }),
    }),
    {
      name: "address-storage",
    }
  )
);

export const useClientOrdersStore = create<ClientOrdersState>((set) => ({
  orders: [],
  isLoading: true,
  setOrders: (orders) => set({ orders, isLoading: false }),
  setIsLoading: (isLoading) => set({ isLoading }),
  clearOrders: () => set({ orders: [], isLoading: false }),
}));

interface PlacementState {
  policy: PlacementPolicy | null;
  summary: PlacementSummary | null;
  isLoading: boolean;
  loadPolicy: () => Promise<void>;
  loadSummary: (token: string) => Promise<void>;
}

export const usePlacementStore = create<PlacementState>((set) => ({
  policy: null,
  summary: null,
  isLoading: false,
  loadPolicy: async () => {
    const response = await fetch(`${baseURL}/system/placement-policy`);
    if (!response.ok) return;
    set({ policy: await response.json() });
  },
  loadSummary: async (token) => {
    set({ isLoading: true });
    try {
      const response = await fetch(`${baseURL}/admin/placements/summary`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("Не удалось загрузить сводку размещений");
      const summary: PlacementSummary = await response.json();
      set({ summary, policy: summary.policy });
    } finally {
      set({ isLoading: false });
    }
  },
}));

interface AdminModerationState {
  lastNotification: AdminModerationNotification | null;
  refreshNonce: number;
  registerNotification: (payload: {
    event: string;
    title?: string | null;
    body?: string | null;
  }) => void;
  reset: () => void;
}

export const useAdminModerationStore = create<AdminModerationState>((set) => ({
  lastNotification: null,
  refreshNonce: 0,
  registerNotification: ({ event, title, body }) =>
    set((state) => ({
      lastNotification: {
        event,
        title: title?.trim() || "",
        body: body?.trim() || "",
        receivedAt: Date.now(),
      },
      refreshNonce: state.refreshNonce + 1,
    })),
  reset: () => set({ lastNotification: null, refreshNonce: 0 }),
}));

export const useCartStore = create<CartState>()(
  persist((set, get) => ({
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
    const uniqueOptions = getDeliveryOptionsForVolume([
      deliveryOption,
      ...availableDeliveryOptions,
    ]);

    if (existingItems.length > 0) {
      const lockedPickupPointId =
        pickupPoint?.id || existingItems.find((item) => item.pickupPoint?.id)?.pickupPoint?.id;
      const hasConflictingPickupPoint = existingItems.some(
        (item) =>
          item.pickupPoint?.id &&
          lockedPickupPointId &&
          item.pickupPoint.id !== lockedPickupPointId,
      );

      if (hasConflictingPickupPoint) {
        toast.error(
          "Этот материал уже добавлен из другой точки. Оформите его отдельным заказом.",
        );
        return false;
      }

      const existingVolume = existingItems.reduce(
        (sum, item) =>
          sum +
          Number(
            item.volume ?? item.deliveryOption.capacity_m3 * item.quantity,
          ),
        0,
      );
      const newVolume = existingVolume + Number(deliveryOption.capacity_m3);
      const upgradedOption = findDeliveryOptionForVolume(uniqueOptions, newVolume);

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
                  material: {
                    ...item.material,
                    ...material,
                    delivery_options: uniqueOptions,
                  },
                  deliveryOption: upgradedOption,
                  pickupPoint: pickupPoint || item.pickupPoint,
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
          material: { ...material, delivery_options: uniqueOptions },
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
  updateItemVolume: (id, volume) => {
    const item = get().cartItems.find((cartItem) => cartItem.id === id);
    if (!item) return false;
    const availableOptions = getDeliveryOptionsForVolume([
      item.deliveryOption,
      ...(item.material.delivery_options || []),
    ]);
    const upgradedOption = findDeliveryOptionForVolume(availableOptions, volume);
    if (!upgradedOption) return false;

    set((state) => ({
      cartItems: state.cartItems.map((cartItem) =>
        cartItem.id === id
          ? {
              ...cartItem,
              deliveryOption: upgradedOption,
              quantity: 1,
              volume,
            }
          : cartItem,
      ),
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
  }), {
    name: "cart-storage",
  })
);
