import React, { useState, useEffect } from "react";
import {
  Home,
  List,
  ShoppingCart,
  Map,
  User,
  MapPin,
  Search,
  ImageIcon,
  RefreshCw,
  Truck,
  Wrench,
  Droplets,
  X,
} from "lucide-react";
import { MaterialProps } from "./MaterialDetailScreen";
import OrdersScreen from "./OrdersScreen";
import WelcomeScreen from "./WelcomeScreen";
import { getImageUrl, baseURL, APP_VERSION } from "./utils";

import CartScreen from "./CartScreen";
import ProfileScreen from "./ProfileScreen";
import MaterialBottomSheet from "./MaterialBottomSheet";
import UpdateBanner from "./UpdateBanner";

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
import GlobalMapScreen from "./GlobalMapScreen";
import WaterMapScreen from "./WaterMapScreen";
import SepticCatalogScreen from "./SepticCatalogScreen";
import SupportScreen from "./SupportScreen";
import PickupPointMapScreen, { PickupPointSelection } from "./PickupPointMapScreen";
import EquipmentOwnerPortalScreen from "./EquipmentOwnerPortalScreen";
import WaterSepticPartnerPortalScreen from "./WaterSepticPartnerPortalScreen";
import AdminNotificationToastListener from "./components/shared/AdminNotificationToastListener";

// Reuse Material type as MaterialProps by exporting it from MaterialDetailScreen or type matching
export default function App() {
  usePushNotifications();
  const [currentPath, setCurrentPath] = useState(
    typeof window !== "undefined" ? window.location.pathname : "/",
  );
  const { role, token } = useAuthStore();
  const resolveRouteForRole = (nextRole: string | null | undefined) => {
    if (nextRole === "driver") return "driver" as const;
    if (nextRole === "logist") return "logist" as const;
    if (nextRole === "admin") return "admin" as const;
    if (nextRole === "supplier") return "supplier" as const;
    if (nextRole === "equipment_owner") return "equipment_owner" as const;
    if (nextRole === "water_septic_partner") return "water_septic_partner" as const;
    return "main" as const;
  };
  const [currentRoute, setCurrentRoute] = useState<
    | "welcome"
    | "main"
    | "login"
    | "driver"
    | "logist"
    | "admin"
    | "supplier"
    | "equipment_owner"
    | "water_septic_partner"
    | "supplier_register"
    | "equipment_owner_register"
    | "water_septic_partner_register"
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
            : role === "equipment_owner"
              ? "equipment_owner"
              : role === "water_septic_partner"
                ? "water_septic_partner"
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
    const renderPartnerLogin = () => (
      <LoginScreen
        onLogin={(nextRole) => setCurrentRoute(resolveRouteForRole(nextRole))}
        onBack={() => setCurrentRoute("welcome")}
        onSelectSupplierRegister={() => setCurrentRoute("supplier_register")}
        onSelectEquipmentOwnerRegister={() => setCurrentRoute("equipment_owner_register")}
        onSelectWaterSepticPartnerRegister={() => setCurrentRoute("water_septic_partner_register")}
        onSelectDriverRegister={() => setCurrentRoute("driver_register")}
      />
    );

    if (currentPath === "/admin/orders") {
      return role === "admin" ? <AdminOrdersListScreen role="admin" /> : renderPartnerLogin();
    }

    if (currentPath === "/logist/orders") {
      return role === "logist" ? (
        <LogistDashboardScreen onLogout={() => setCurrentRoute("login")} />
      ) : renderPartnerLogin();
    }

    if (currentPath === "/admin/statistics") {
      return role === "admin" ? <AdminStatisticsScreen role="admin" /> : renderPartnerLogin();
    }

    if (currentPath === "/logist/statistics") {
      return role === "logist" ? (
        <AdminStatisticsScreen role="logist" />
      ) : renderPartnerLogin();
    }
    if (currentRoute === "welcome") {
      return (
        <WelcomeScreen
          onSelectClient={() => {
            setCurrentRoute("main");
          }}
          onSelectEmployee={() => setCurrentRoute("login")}
        />
      );
    }

    if (currentRoute === "driver_register") {
      return (
        <DriverRegistrationScreen
          onRegister={(r) =>
            setCurrentRoute(r === "driver" ? "driver" : "main")
          }
          onBack={() => setCurrentRoute("login")}
        />
      );
    }

    if (currentRoute === "supplier_register" || currentRoute === "supplier") {
      return <SupplierPortalScreen onBack={() => setCurrentRoute("login")} />;
    }

    if (
      currentRoute === "equipment_owner_register" ||
      currentRoute === "equipment_owner"
    ) {
      return <EquipmentOwnerPortalScreen onBack={() => setCurrentRoute("login")} />;
    }

    if (
      currentRoute === "water_septic_partner_register" ||
      currentRoute === "water_septic_partner"
    ) {
      return <WaterSepticPartnerPortalScreen onBack={() => setCurrentRoute("login")} />;
    }

    if (currentRoute === "login") {
      return renderPartnerLogin();
    }

    if (currentRoute === "driver") {
      return role === "driver" ? (
        <DriverOrdersScreen onLogout={() => setCurrentRoute("login")} />
      ) : renderPartnerLogin();
    }

    if (currentRoute === "logist") {
      return role === "logist" ? (
        <LogistDashboardScreen onLogout={() => setCurrentRoute("login")} />
      ) : renderPartnerLogin();
    }

    if (currentRoute === "admin") {
      return role === "admin" ? (
        <AdminDashboardScreen onLogout={() => setCurrentRoute("login")} />
      ) : renderPartnerLogin();
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
        currentPath={currentPath}
        setCurrentPath={setCurrentPath}
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
      <AdminNotificationToastListener />
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
  currentPath,
  setCurrentPath,
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
    { id: "map", label: "Карта", icon: Map },
    { id: "water", label: "Вода", icon: Droplets },
    { id: "profile", label: "Профиль", icon: User },
  ];

  const [showAddressSheet, setShowAddressSheet] = useState(false);
  const [serviceDirection, setServiceDirection] = useState<"delivery" | "equipment">("delivery");
  const [mapMaterial, setMapMaterial] = useState<MaterialProps | null>(null);
  const [materialActionChoice, setMaterialActionChoice] = useState<MaterialProps | null>(null);
  const [quickBuyMaterial, setQuickBuyMaterial] = useState<MaterialProps | null>(null);
  const [selectedPickupPoint, setSelectedPickupPoint] =
    useState<PickupPointSelection | null>(null);

  const handleCartClick = () => {
    setActiveTab("cart");
  };

  const handleProfileClick = () => {
    setActiveTab("profile");
  };

  const handleClientAuthenticated = () => {
    onClearFocusedOrder();
    setActiveTab("home");
    if (quickBuyMaterial) {
      setShowAddressSheet(true);
    }
  };

  const closeMaterialSheet = () => {
    setSelectedMaterial(null);
    setSelectedPickupPoint(null);
  };

  const closeMaterialActionChoice = () => {
    setMaterialActionChoice(null);
  };

  const openDeliveryMap = (material: MaterialProps) => {
    setMaterialActionChoice(null);
    setSelectedPickupPoint(null);
    setMapMaterial(material);
  };

  const startQuickBuy = (material: MaterialProps) => {
    closeMaterialActionChoice();
    setSelectedPickupPoint(null);
    if (role !== "client" || !token) {
      setQuickBuyMaterial(material);
      setShowAuthSheet(true);
      return;
    }
    if (!selectedAddress) {
      setQuickBuyMaterial(material);
      setShowAddressSheet(true);
      return;
    }
    setSelectedMaterial(material);
  };

  const handlePickupPointSelected = (point: PickupPointSelection) => {
    if (!mapMaterial) return;
    setSelectedPickupPoint(point);
    setSelectedMaterial(mapMaterial);
    setMapMaterial(null);
  };

  const openSpecialCategory = (path: "/water" | "/septics", tab: "water" | "septic") => {
    if (typeof window !== "undefined" && window.location.pathname !== path) {
      window.history.pushState({}, "", path);
    }
    setCurrentPath(path);
    setMapMaterial(null);
    closeMaterialSheet();
    setActiveTab(tab);
  };

  const handleCatalogMaterialClick = (material: MaterialProps) => {
    const categoryName = (
      material.category?.name ||
      categories.find((category: Category) => category.id === material.category_id)?.name ||
      ""
    ).toLowerCase();

    if (categoryName.includes("вода") || categoryName.includes("water")) {
      openSpecialCategory("/water", "water");
      return;
    }

    if (categoryName.includes("септик") || categoryName.includes("septic")) {
      openSpecialCategory("/septics", "septic");
      return;
    }

    setMaterialActionChoice(material);
  };

  useEffect(() => {
    if (!quickBuyMaterial) return;
    if (role !== "client" || !token) return;
    if (!selectedAddress) return;
    setSelectedPickupPoint(null);
    setSelectedMaterial(quickBuyMaterial);
    setQuickBuyMaterial(null);
    setShowAddressSheet(false);
    setShowAuthSheet(false);
  }, [quickBuyMaterial, role, selectedAddress, setSelectedMaterial, token]);

  useEffect(() => {
    if (currentPath === "/map" && activeTab !== "map") {
      setActiveTab("map");
      return;
    }
    if (currentPath === "/water" && activeTab !== "water") { setActiveTab("water"); return; }
    if ((currentPath === "/septic" || currentPath === "/septics") && activeTab !== "septic") { setActiveTab("septic"); return; }
    if (currentPath !== "/map" && currentPath !== "/water" && currentPath !== "/septic" && currentPath !== "/septics" && (activeTab === "map" || activeTab === "water" || activeTab === "septic")) {
      setActiveTab("home");
    }
  }, [activeTab, currentPath, setActiveTab]);

  return (
    <div className="min-h-screen w-full bg-slate-100 flex sm:items-center justify-center text-slate-900">
      {/* Mobile container aligned and constrained on large screens */}
      <div className="w-full max-w-md bg-white min-h-screen sm:min-h-0 sm:h-[85vh] relative shadow-2xl flex flex-col overflow-hidden sm:rounded-[32px] sm:border-8 border-slate-900">
        {/* Main Content Area */}
        <main className="flex h-full flex-1 flex-col overflow-y-auto pb-[calc(90px+env(safe-area-inset-bottom))] pt-4">
          {activeTab === "home" && (
            <>
              <div className="px-4">
                <UpdateBanner />
              </div>

              {/* Top Address Button */}
              <div className="mb-4 px-4 pt-[calc(env(safe-area-inset-top,0px)+0.25rem)]">
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
                  onClick={() => {
                    setServiceDirection("delivery");
                    setMapMaterial(null);
                  }}
                  className={`flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-bold transition ${serviceDirection === "delivery" ? "bg-white text-sky-600 shadow-sm" : "text-slate-500"}`}
                >
                  <Truck className="h-4 w-4" /> Доставка
                </button>
                <button
                  onClick={() => {
                    setServiceDirection("equipment");
                    setMapMaterial(null);
                    closeMaterialSheet();
                  }}
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
              {/* Category tabs */}
              <section className="mb-6">
                <div className="flex overflow-x-auto whitespace-nowrap hide-scrollbar gap-2 px-4 pb-2">
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
                    <button
                      type="button"
                      onClick={() => openSpecialCategory("/water", "water")}
                      className="px-5 py-2 rounded-full whitespace-nowrap text-sm font-medium transition-all duration-200 bg-slate-50 text-slate-500 hover:bg-slate-100"
                    >
                      Вода
                    </button>
                    <button
                      type="button"
                      onClick={() => openSpecialCategory("/septics", "septic")}
                      className="px-5 py-2 rounded-full whitespace-nowrap text-sm font-medium transition-all duration-200 bg-slate-50 text-slate-500 hover:bg-slate-100"
                    >
                      Септики
                    </button>
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
                        onClick={() => handleCatalogMaterialClick(material)}
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

          {activeTab === "map" && <GlobalMapScreen />}
          {activeTab === "water" && <WaterMapScreen />}
          {activeTab === "septic" && <SepticCatalogScreen />}

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
        <nav className="fixed bottom-0 left-0 right-0 z-40 w-full max-w-md mx-auto bg-white border-t border-gray-200 pb-[env(safe-area-inset-bottom)] flex flex-col sm:rounded-b-[32px]">
          <div className="flex justify-around items-center h-16 px-2">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              const isPriority = ["orders", "cart", "map"].includes(tab.id);
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    onClearFocusedOrder();
                    const nextPath = tab.id === "map" ? "/map" : tab.id === "water" ? "/water" : "/";
                    if (typeof window !== "undefined" && window.location.pathname !== nextPath) {
                      window.history.pushState({}, "", nextPath);
                    }
                    setCurrentPath(nextPath);
                    setActiveTab(tab.id);
                  }}
                  className={`relative flex min-w-0 flex-1 cursor-pointer flex-col items-center gap-1 rounded-xl px-1 py-1.5 transition-all ${
                    isActive && isPriority
                      ? "bg-[#2DB0E6] text-white shadow-[0_6px_16px_rgba(45,176,230,0.30)]"
                      : isPriority
                        ? "text-slate-500 opacity-45 hover:opacity-70"
                        : isActive
                          ? "text-[#2DB0E6] opacity-100"
                          : "text-slate-500 opacity-45 hover:opacity-70"
                  }`}
                >
                  <span className="relative inline-block">
                    <Icon
                      className={`h-5 w-5 ${
                        isActive && isPriority
                          ? "text-white"
                          : isPriority
                            ? "text-slate-500"
                            : isActive
                              ? "text-[#2DB0E6]"
                              : "text-slate-500"
                      }`}
                      strokeWidth={isActive ? 2.5 : 2}
                    />
                    {tab.badge !== undefined && (
                      <span className="absolute -right-2 -top-1 z-10 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white shadow-sm">
                        {tab.badge}
                      </span>
                    )}
                  </span>
                  <span
                    className={`whitespace-nowrap text-[10px] leading-none ${
                      isActive && isPriority
                        ? "font-bold text-white"
                        : isPriority
                          ? "font-medium text-slate-500"
                          : isActive
                            ? "font-bold text-[#2DB0E6]"
                            : "font-medium text-slate-500"
                    }`}
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

        <QuickBuyChoiceModal
          material={materialActionChoice}
          onClose={closeMaterialActionChoice}
          onQuickBuy={startQuickBuy}
          onChooseOnMap={openDeliveryMap}
        />

        {/* Bottom Sheet */}
        <MaterialBottomSheet
          material={selectedMaterial}
          pickupPoint={selectedPickupPoint}
          onClose={closeMaterialSheet}
          onSubmitted={() => setActiveTab("cart")}
        />

        {mapMaterial && (
          <PickupPointMapScreen
            material={mapMaterial}
            onClose={() => setMapMaterial(null)}
            onSelect={handlePickupPointSelected}
          />
        )}

        {/* Auth Bottom Sheet */}
        <ClientAuthBottomSheet
          isOpen={showAuthSheet}
          onClose={() => setShowAuthSheet(false)}
          onAuthenticated={handleClientAuthenticated}
        />

        {/* Address Bottom Sheet */}
        <ClientAddressBottomSheet
          isOpen={showAddressSheet}
          onClose={() => setShowAddressSheet(false)}
          closeOnSelect={Boolean(quickBuyMaterial)}
        />
      </div>
    </div>
  );
}

function QuickBuyChoiceModal({
  material,
  onClose,
  onQuickBuy,
  onChooseOnMap,
}: {
  material: MaterialProps | null;
  onClose: () => void;
  onQuickBuy: (material: MaterialProps) => void;
  onChooseOnMap: (material: MaterialProps) => void;
}) {
  if (!material) return null;

  return (
    <div className="fixed inset-0 z-[102] flex items-end justify-center bg-slate-900/45 backdrop-blur-sm sm:items-center">
      <div className="relative w-full rounded-t-[32px] bg-white px-5 pb-8 pt-6 shadow-2xl sm:max-w-md sm:rounded-[32px]">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full bg-slate-100 p-2 text-slate-500 hover:bg-slate-200"
          aria-label="Закрыть"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="mb-6 pr-12">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-sky-500">
            {material.name}
          </p>
          <h3 className="mt-2 text-2xl font-black text-slate-900">
            Как хотите оформить заказ?
          </h3>
          <p className="mt-2 text-sm text-slate-500">
            Можно сразу перейти к доставке или выбрать конкретный карьер на карте.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => onQuickBuy(material)}
            className="rounded-2xl bg-sky-500 px-5 py-4 text-left text-white shadow-[0_12px_30px_rgba(14,165,233,0.28)] transition hover:bg-sky-600"
          >
            <span className="block text-lg font-black">Купить с доставкой</span>
            <span className="mt-1 block text-sm text-sky-50">
              Мы автоматически подберем ближайший карьер с самой выгодной ценой.
            </span>
          </button>

          <button
            type="button"
            onClick={() => onChooseOnMap(material)}
            className="rounded-2xl border border-slate-200 bg-white px-5 py-4 text-left text-slate-900 transition hover:border-sky-200 hover:bg-sky-50"
          >
            <span className="block text-lg font-black">Выбрать карьер на карте</span>
            <span className="mt-1 block text-sm text-slate-500">
              Посмотреть все доступные точки на карте и выбрать подходящую самостоятельно.
            </span>
          </button>
        </div>
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
