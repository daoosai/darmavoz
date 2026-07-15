import React, { useState, useEffect } from "react";
import {
  Home,
  List,
  ShoppingCart,
  Tag,
  User,
  MapPin,
  Search,
  ImageIcon,
  RefreshCw,
  Truck,
  Wrench,
} from "lucide-react";
import { MaterialProps } from "./MaterialDetailScreen";
import OrdersScreen from "./OrdersScreen";
import WelcomeScreen from "./WelcomeScreen";
import { getImageUrl, baseURL, APP_VERSION } from "./utils";

import CartScreen from "./CartScreen";
import ProfileScreen from "./ProfileScreen";
import PromosScreen from "./PromosScreen";
import MaterialBottomSheet from "./MaterialBottomSheet";

import { Toaster } from "react-hot-toast";

interface Category {
  id: string;
  name: string;
  slug: string;
  sort_order: number;
}

import LoginScreen from "./LoginScreen";
import DriverOrdersScreen from "./DriverOrdersScreen";
import LogistDashboardScreen from "./LogistDashboardScreen";
import AdminDashboardScreen from "./AdminDashboardScreen";
import AdminOrdersListScreen from "./AdminOrdersListScreen";
import AdminStatisticsScreen from "./AdminStatisticsScreen";
import DriverRegistrationScreen from "./DriverRegistrationScreen";
import { useAuthStore, useCartStore, useAddressStore } from "./store";
import ClientAuthBottomSheet from "./ClientAuthBottomSheet";
import ClientAddressBottomSheet from "./ClientAddressBottomSheet";
import ClientProfileScreen from "./ClientProfileScreen";
import InstallPWA from "./InstallPWA";
import { usePushNotifications } from "./usePushNotifications";
import SupplierPortalScreen from "./SupplierPortalScreen";
import FloatingOrderTracker from "./FloatingOrderTracker";
import EquipmentCatalogScreen from "./EquipmentCatalogScreen";
import SupportScreen from "./SupportScreen";

// Reuse Material type as MaterialProps by exporting it from MaterialDetailScreen or type matching
export default function App() {
  usePushNotifications();
  const [currentPath, setCurrentPath] = useState(
    typeof window !== "undefined" ? window.location.pathname : "/",
  );
  const { role, token } = useAuthStore();
  const [currentRoute, setCurrentRoute] = useState<
    | "welcome"
    | "main"
    | "login"
    | "driver"
    | "logist"
    | "admin"
    | "supplier"
    | "supplier_register"
    | "driver_register"
  >(
    role === "client" && currentPath.startsWith("/client/orders/")
      ? "main"
      : role === "driver"
      ? "driver"
      : role === "logist"
        ? "logist"
        : role === "admin"
          ? "admin"
          : role === "supplier"
            ? "supplier"
          : "welcome",
  );

  const [activeTab, setActiveTab] = useState("home");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(
    null,
  );
  const [selectedMaterial, setSelectedMaterial] =
    useState<MaterialProps | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const [categories, setCategories] = useState<Category[]>([]);
  const [materials, setMaterials] = useState<MaterialProps[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAuthSheet, setShowAuthSheet] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handlePopState = () => setCurrentPath(window.location.pathname);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        const [categoriesRes, materialsRes] = await Promise.all([
          fetch(`${baseURL}/catalog/categories/`),
          fetch(`${baseURL}/catalog/materials/`),
        ]);

        if (categoriesRes.ok && materialsRes.ok) {
          const categoriesData = await categoriesRes.json();
          const materialsData = await materialsRes.json();
          setCategories(
            Array.isArray(categoriesData)
              ? categoriesData
              : categoriesData.results || [],
          );
          const fetchedMaterials = Array.isArray(materialsData)
            ? materialsData
            : materialsData.results || [];
          setMaterials(
            fetchedMaterials.filter((m: any) => m.is_active !== false),
          );
        } else {
          console.error("Failed to fetch data");
        }
      } catch (err) {
        // Silent error for release
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, []);

  const cartItemsCount = useCartStore((state) => state.cartItems.length);
  const focusedClientOrderId = currentPath.match(/^\/client\/orders\/([^/]+)\/?$/)?.[1] || null;

  useEffect(() => {
    if (focusedClientOrderId && role === "client") {
      setCurrentRoute("main");
      setActiveTab("orders");
    }
  }, [focusedClientOrderId, role]);

  const openClientOrder = (orderId: string) => {
    const nextPath = `/client/orders/${orderId}`;
    window.history.pushState({}, "", nextPath);
    setCurrentPath(nextPath);
    setActiveTab("orders");
  };

  const clearFocusedClientOrder = () => {
    if (!focusedClientOrderId) return;
    window.history.pushState({}, "", "/");
    setCurrentPath("/");
  };

  const renderContent = () => {
    if (currentPath === "/admin/orders") {
      return role === "admin" ? (
        <AdminOrdersListScreen role="admin" />
      ) : (
        <LoginScreen
          onLogin={(r) =>
            setCurrentRoute(
              r === "driver"
                ? "driver"
                : r === "logist"
                  ? "logist"
                  : r === "admin"
                    ? "admin"
                    : "main",
            )
          }
          onBack={() => setCurrentRoute("welcome")}
        />
      );
    }

    if (currentPath === "/logist/orders") {
      return role === "logist" ? (
        <LogistDashboardScreen onLogout={() => setCurrentRoute("login")} />
      ) : (
        <LoginScreen
          onLogin={(r) =>
            setCurrentRoute(
              r === "driver"
                ? "driver"
                : r === "logist"
                  ? "logist"
                  : r === "admin"
                    ? "admin"
                    : "main",
            )
          }
          onBack={() => setCurrentRoute("welcome")}
        />
      );
    }

    if (currentPath === "/admin/statistics") {
      return role === "admin" ? (
        <AdminStatisticsScreen role="admin" />
      ) : (
        <LoginScreen
          onLogin={(r) =>
            setCurrentRoute(
              r === "driver"
                ? "driver"
                : r === "logist"
                  ? "logist"
                  : r === "admin"
                    ? "admin"
                    : "main",
            )
          }
          onBack={() => setCurrentRoute("welcome")}
        />
      );
    }

    if (currentPath === "/logist/statistics") {
      return role === "logist" ? (
        <AdminStatisticsScreen role="logist" />
      ) : (
        <LoginScreen
          onLogin={(r) =>
            setCurrentRoute(
              r === "driver"
                ? "driver"
                : r === "logist"
                  ? "logist"
                  : r === "admin"
                    ? "admin"
                    : "main",
            )
          }
          onBack={() => setCurrentRoute("welcome")}
        />
      );
    }
    if (currentRoute === "welcome") {
      return (
        <WelcomeScreen
          onSelectClient={() => {
            setCurrentRoute("main");
          }}
          onSelectEmployee={() => setCurrentRoute("login")}
          onSelectDriverRegister={() => setCurrentRoute("driver_register")}
        />
      );
    }

    if (currentRoute === "driver_register") {
      return (
        <DriverRegistrationScreen
          onRegister={(r) =>
            setCurrentRoute(r === "driver" ? "driver" : "main")
          }
          onBack={() => setCurrentRoute("welcome")}
        />
      );
    }

    if (currentRoute === "supplier_register" || currentRoute === "supplier") {
      return <SupplierPortalScreen onBack={() => setCurrentRoute("welcome")} />;
    }

    if (currentRoute === "login") {
      return (
        <LoginScreen
          onLogin={(r) =>
            setCurrentRoute(
              r === "driver"
                ? "driver"
                : r === "logist"
                  ? "logist"
                  : r === "admin"
                    ? "admin"
                    : r === "supplier"
                      ? "supplier"
                    : "main",
            )
          }
          onBack={() => setCurrentRoute("welcome")}
          onSelectSupplier={() => setCurrentRoute("supplier_register")}
        />
      );
    }

    if (currentRoute === "driver") {
      return role === "driver" ? (
        <DriverOrdersScreen onLogout={() => setCurrentRoute("login")} />
      ) : (
        <LoginScreen
          onLogin={(r) =>
            setCurrentRoute(
              r === "driver"
                ? "driver"
                : r === "logist"
                  ? "logist"
                  : r === "admin"
                    ? "admin"
                    : "main",
            )
          }
          onBack={() => setCurrentRoute("welcome")}
        />
      );
    }

    if (currentRoute === "logist") {
      return role === "logist" ? (
        <LogistDashboardScreen onLogout={() => setCurrentRoute("login")} />
      ) : (
        <LoginScreen
          onLogin={(r) =>
            setCurrentRoute(
              r === "driver"
                ? "driver"
                : r === "logist"
                  ? "logist"
                  : r === "admin"
                    ? "admin"
                    : "main",
            )
          }
          onBack={() => setCurrentRoute("welcome")}
        />
      );
    }

    if (currentRoute === "admin") {
      return role === "admin" ? (
        <AdminDashboardScreen onLogout={() => setCurrentRoute("login")} />
      ) : (
        <LoginScreen
          onLogin={(r) =>
            setCurrentRoute(
              r === "driver"
                ? "driver"
                : r === "logist"
                  ? "logist"
                  : r === "admin"
                    ? "admin"
                    : "main",
            )
          }
          onBack={() => setCurrentRoute("welcome")}
        />
      );
    }

    return (
      <MainContent
        currentRoute={currentRoute}
        setCurrentRoute={setCurrentRoute}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        categories={categories}
        materials={materials}
        selectedMaterial={selectedMaterial}
        setSelectedMaterial={setSelectedMaterial}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        cartItemsCount={cartItemsCount}
        selectedCategoryId={selectedCategoryId}
        setSelectedCategoryId={setSelectedCategoryId}
        isLoading={isLoading}
        showAuthSheet={showAuthSheet}
        setShowAuthSheet={setShowAuthSheet}
        role={role}
        focusedOrderId={focusedClientOrderId}
        onOpenOrder={openClientOrder}
        onClearFocusedOrder={clearFocusedClientOrder}
      />
    );
  };

  return (
    <>
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 2000,
          style: {
            background: "#10B981",
            color: "#fff",
            zIndex: 999,
          },
        }}
      />
      <InstallPWA />
      {renderContent()}
    </>
  );
}

function MainContent({
  currentRoute,
  setCurrentRoute,
  activeTab,
  setActiveTab,
  categories,
  materials,
  selectedMaterial,
  setSelectedMaterial,
  searchQuery,
  setSearchQuery,
  cartItemsCount,
  selectedCategoryId,
  setSelectedCategoryId,
  isLoading,
  showAuthSheet,
  setShowAuthSheet,
  role,
  focusedOrderId,
  onOpenOrder,
  onClearFocusedOrder,
}: any) {
  const { selectedAddress } = useAddressStore();
  const { token } = useAuthStore();
  const tabs = [
    { id: "home", label: "Главная", icon: Home },
    { id: "orders", label: "Заказы", icon: List },
    {
      id: "cart",
      label: "Корзина",
      icon: ShoppingCart,
      badge: cartItemsCount > 0 ? cartItemsCount : undefined,
    },
    { id: "promotions", label: "Акции", icon: Tag },
    { id: "profile", label: "Профиль", icon: User },
  ];

  const [showAddressSheet, setShowAddressSheet] = useState(false);
  const [serviceDirection, setServiceDirection] = useState<"delivery" | "equipment">("delivery");

  const handleCartClick = () => {
    setActiveTab("cart");
  };

  const handleProfileClick = () => {
    setActiveTab("profile");
  };

  return (
    <div className="min-h-screen w-full bg-slate-100 flex sm:items-center justify-center text-slate-900">
      {/* Mobile container aligned and constrained on large screens */}
      <div className="w-full max-w-md bg-white min-h-screen sm:min-h-0 sm:h-[85vh] relative shadow-2xl flex flex-col overflow-hidden sm:rounded-[32px] sm:border-8 border-slate-900">
        {/* Main Content Area */}
        <main className="flex-1 overflow-y-auto pb-[calc(90px+env(safe-area-inset-bottom))] pt-4">
          {activeTab === "home" && (
            <>
              {/* Top Address Button */}
              <div className="px-4 mb-4">
                <button
                  onClick={() => {
                    if (role !== "client") {
                      setShowAuthSheet(true);
                      return;
                    }
                    setShowAddressSheet(true);
                  }}
                  className="w-full bg-[#2DB0E6] text-white rounded-2xl p-3 flex items-center justify-start gap-2 flex-row font-medium active:opacity-80 transition-opacity"
                >
                  <MapPin className="w-[18px] h-[18px] flex-shrink-0" />
                  <span className="truncate text-sm">
                    {token && role === "client" && selectedAddress
                      ? selectedAddress
                      : "Укажите адрес доставки"}
                  </span>
                </button>
              </div>

              <div className="mx-4 mb-5 grid grid-cols-2 gap-3 rounded-2xl bg-slate-100 p-1.5">
                <button
                  onClick={() => setServiceDirection("delivery")}
                  className={`flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-bold transition ${serviceDirection === "delivery" ? "bg-white text-sky-600 shadow-sm" : "text-slate-500"}`}
                >
                  <Truck className="h-4 w-4" /> Доставка
                </button>
                <button
                  onClick={() => setServiceDirection("equipment")}
                  className={`flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-bold transition ${serviceDirection === "equipment" ? "bg-white text-sky-600 shadow-sm" : "text-slate-500"}`}
                >
                  <Wrench className="h-4 w-4" /> Спецтехника
                </button>
              </div>

              {/* Search Bar */}
              {serviceDirection === "delivery" && <div className="px-4 mb-6">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-[18px] h-[18px]" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Поиск товаров..."
                    className="w-full bg-slate-100 border-none rounded-xl py-3 pl-10 pr-4 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-brand-blue/20 transition-all text-sm"
                  />
                </div>
              </div>}

              {serviceDirection === "delivery" ? <>
              {/* Delivery direction */}
              <section className="mx-4 mb-6 overflow-hidden">
                <div className="px-4 pb-3 pt-4">
                  <h2 className="text-xl font-black text-slate-900">
                    Доставка материалов
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Выберите категорию сыпучих материалов
                  </p>
                </div>
                <div
                  className="overflow-x-auto px-4 pb-4"
                  style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
                >
                  <div className="flex gap-2">
                    <button
                      onClick={() => setSelectedCategoryId(null)}
                      className={`px-5 py-2 rounded-full whitespace-nowrap text-sm font-medium transition-all duration-200 ${
                        selectedCategoryId === null
                          ? "bg-white text-black shadow-sm"
                          : "bg-slate-50 text-slate-500 hover:bg-slate-100"
                      }`}
                    >
                      Все
                    </button>
                    {categories.map((cat) => (
                      <button
                        key={cat.id}
                        onClick={() => setSelectedCategoryId(cat.id)}
                        className={`px-5 py-2 rounded-full whitespace-nowrap text-sm font-medium transition-all duration-200 ${
                          selectedCategoryId === cat.id
                            ? "bg-white text-black shadow-sm"
                            : "bg-slate-50 text-slate-500 hover:bg-slate-100"
                        }`}
                      >
                        {cat?.name}
                      </button>
                    ))}
                  </div>
                </div>
              </section>

              {/* Product Grid Area */}
              <div className="px-4 flex flex-col gap-6 pb-6">
                {isLoading ? (
                  <div className="flex justify-center py-10">
                    <span className="text-slate-500 text-sm font-medium animate-pulse">
                      Загрузка...
                    </span>
                  </div>
                ) : (
                  materials
                    .filter(
                      (m: any) =>
                        selectedCategoryId === null ||
                        m.category_id === selectedCategoryId,
                    )
                    .filter((m: any) =>
                      (m?.name || "")
                        .toLowerCase()
                        .includes(searchQuery.toLowerCase()),
                    )
                    .map((material) => (
                      <ProductCard
                        key={material.id}
                        material={material}
                        onClick={() => setSelectedMaterial(material)}
                      />
                    ))
                )}
              </div>
              </> : <EquipmentCatalogScreen onOpenAuth={() => setShowAuthSheet(true)} />}
            </>
          )}

          {activeTab === "orders" && (
            <OrdersScreen
              onOpenAuth={() => setShowAuthSheet(true)}
              focusedOrderId={focusedOrderId}
              onBackToOrders={onClearFocusedOrder}
            />
          )}

          {activeTab === "cart" && (
            <CartScreen
              onGoToHome={() => setActiveTab("home")}
              onGoToOrders={() => setActiveTab("orders")}
              onOpenAuth={() => setShowAuthSheet(true)}
              onOpenAddresses={() => setShowAddressSheet(true)}
            />
          )}

          {activeTab === "promotions" && <PromosScreen />}

          {activeTab === "profile" &&
            (role === "client" ? (
              <ClientProfileScreen
                onOpenAddresses={() => setShowAddressSheet(true)}
                onOpenSupport={() => setActiveTab("support")}
              />
            ) : (
              <ProfileScreen onOpenAuth={() => setShowAuthSheet(true)} />
            ))}

          {activeTab === "support" && (
            <SupportScreen onBack={() => setActiveTab("profile")} />
          )}
        </main>

        {role === "client" && (
          <FloatingOrderTracker onOpenOrder={onOpenOrder} />
        )}

        {/* Bottom Navigation */}
        <nav className="fixed bottom-0 left-0 right-0 z-50 w-full max-w-md mx-auto bg-white border-t border-gray-200 pb-[env(safe-area-inset-bottom)] flex flex-col sm:rounded-b-[32px]">
          <div className="flex justify-around items-center h-16 px-2">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    onClearFocusedOrder();
                    setActiveTab(tab.id);
                  }}
                  className={`flex flex-col items-center gap-1 transition-opacity cursor-pointer relative ${
                    isActive ? "opacity-100" : "opacity-40 hover:opacity-70"
                  }`}
                >
                  <Icon
                    className={`w-5 h-5 ${isActive ? "text-[#2DB0E6]" : "text-slate-500"}`}
                    strokeWidth={isActive ? 2.5 : 2}
                  />
                  {tab.badge !== undefined && (
                    <span className="absolute -top-1 -right-2 bg-red-500 text-white text-[10px] font-bold w-4 h-4 flex items-center justify-center rounded-full">
                      {tab.badge}
                    </span>
                  )}
                  <span
                    className={`text-[10px] leading-none ${isActive ? "font-bold text-[#2DB0E6]" : "font-medium text-slate-500"}`}
                  >
                    {tab.label}
                  </span>
                </button>
              );
            })}
          </div>
          {/* Home Indicator */}
          <div className="w-full flex justify-center pb-2 pt-1">
            <div className="w-32 h-1 bg-slate-200 rounded-full"></div>
          </div>
        </nav>

        {/* Bottom Sheet */}
        <MaterialBottomSheet
          material={selectedMaterial}
          onClose={() => setSelectedMaterial(null)}
        />

        {/* Auth Bottom Sheet */}
        <ClientAuthBottomSheet
          isOpen={showAuthSheet}
          onClose={() => setShowAuthSheet(false)}
        />

        {/* Address Bottom Sheet */}
        <ClientAddressBottomSheet
          isOpen={showAddressSheet}
          onClose={() => setShowAddressSheet(false)}
        />
      </div>
    </div>
  );
}

interface ProductCardProps {
  key?: React.Key;
  material: MaterialProps;
  onClick: () => void;
}

function ProductCard({ material, onClick }: ProductCardProps) {
  const [activeImageIndex, setActiveImageIndex] = useState(0);

  const images = material.media_files?.length
    ? material.media_files.map((m) => m.public_url)
    : [
        getImageUrl(material),
        "https://placehold.co/400x300/e2e8f0/64748b?text=Photo+2",
        "https://placehold.co/400x300/e2e8f0/64748b?text=Photo+3",
      ];

  return (
    <div
      onClick={onClick}
      className="bg-white rounded-3xl overflow-hidden flex flex-col shadow-sm cursor-pointer hover:shadow-md transition-shadow relative"
    >
      <div className="relative w-full aspect-[4/3] bg-slate-100 group">
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

        {/* Pagination Dots */}
        <div className="absolute bottom-3 left-0 w-full flex justify-center gap-1.5">
          {images.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all ${i === activeImageIndex ? "w-4 bg-white" : "w-1.5 bg-white/50"}`}
            />
          ))}
        </div>
      </div>

      <div className="p-4 flex flex-col gap-1.5">
        <h3 className="font-bold text-[18px] text-slate-900 leading-tight">
          {material?.name}
        </h3>
        <p className="text-[14px] font-bold text-[#2DB0E6]">
          от {material.price} ₽ / {material.unit}
        </p>
      </div>
    </div>
  );
}
