import React, { useState, useEffect, useMemo } from "react";
import { useAuthStore } from "./store";
import { baseURL, extractApiErrorMessage, handleApiError } from "./utils";
import {
  LogOut,
  Lock,
  Plus,
  Edit2,
  Image as ImageIcon,
  Loader2,
  Trash2,
  Layers,
  Truck,
  UploadCloud,
  CheckCircle2,
  XCircle,
  Star,
  StarOff,
  Eye,
  EyeOff,
  ClipboardCheck,
  RefreshCw,
  Users,
  User,
  Camera,
  Map,
  Search,
  Clock,
  Filter,
} from "lucide-react";
import AdminProfileScreen from "./AdminProfileScreen";
import AdminQuarriesScreen from "./AdminQuarriesScreen";
import AdminCategoriesPanel from "./AdminCategoriesPanel";
import { DriverHistoryModal } from "./components/admin/DriverHistoryModal";
import toast from "react-hot-toast";
import { logoutCurrentSession } from "./pushAuth";

interface AdminCategory {
  id: string;
  name: string;
  slug: string;
  sort_order: number;
  is_active: boolean;
}

interface AdminMediaFile {
  id: string;
  public_url: string;
  slot_key: string;
  is_primary: boolean;
}

interface AdminMaterial {
  id: string;
  category_id: string;
  name: string;
  description: string;
  price: number;
  unit: string;
  min_volume: number;
  is_active: boolean;
  media_files?: AdminMediaFile[];
  primary_image_url?: string;
  image_url?: string;
}

interface AdminDeliveryOption {
  id: string;
  title: string;
  capacity_m3: number;
  base_price: number;
  delivery_rate_per_km?: number;
  min_price_quarry?: number;
  min_price_warehouse?: number;
  is_active: boolean;
  media_files?: AdminMediaFile[];
  primary_image_url?: string;
  image_url?: string;
}

interface AdminDriver {
  id: string;
  name: string;
  phone: string;
  delivery_option_id: string;
  is_active: boolean;
  status?: string | null;
  vehicle_brand?: string;
  vehicle_plate_number?: string;
  vehicle_type?: string;
  cubature_min?: number;
  cubature_max?: number;
  tonnage_min?: number;
  tonnage_max?: number;
  moderation_status?:
    "pending_moderation" | "approved" | "rejected" | "suspended" | null;
  rate_mode?: "fixed" | "per_ton_km";
  fixed_rate?: number;
  rate_per_ton_km?: number;
  media_files?: { id: string; public_url: string; slot_key: string }[];
  delivery_option?: {
    title: string;
    capacity_m3: number;
  };
  vehicle?: {
    id?: string;
    title: string;
    brand?: string;
    model?: string;
    plate_number?: string;
    vehicle_type?: string;
    cubature_min?: number;
    cubature_max?: number;
    tonnage_min?: number;
    tonnage_max?: number;
    delivery_option_id?: string;
    vehicle_main_url?: string;
    vehicle_left_url?: string;
    vehicle_plate_url?: string;
    media_files?: { id: string; public_url: string; slot_key: string }[];
    delivery_option?: {
      id?: string;
      title?: string;
      capacity_m3: number;
    };
  };
}

interface PendingModerationRequest {
  driver_id: string;
  driver_name: string;
  driver_phone: string;
  vehicle_id: string;
  vehicle_brand: string;
  vehicle_model: string;
  vehicle_plate_number: string;
  vehicle_body_volume_m3?: number;
  vehicle_cubature_min?: number;
  vehicle_cubature_max?: number;
  vehicle_tonnage_min?: number;
  vehicle_tonnage_max?: number;
  vehicle_main_url?: string | null;
  vehicle_left_url?: string | null;
  vehicle_plate_url?: string | null;
}

interface AdminDashboardScreenProps {
  onLogout: () => void;
}

export default function AdminDashboardScreen({
  onLogout,
}: AdminDashboardScreenProps) {
  const { token } = useAuthStore();
  const [activeTab, setActiveTab] = useState<
    "materials" | "quarries" | "delivery" | "drivers" | "moderation" | "profile"
  >("materials");

  const [materials, setMaterials] = useState<AdminMaterial[]>([]);
  const [deliveryOptions, setDeliveryOptions] = useState<AdminDeliveryOption[]>(
    [],
  );

  // --- Live Fleet State ---
  interface LiveFleetCar {
    id: string;
    plate_number: string;
    car_type: string;
    volume: number;
    photo_url?: string;
    status?: string;
    driver_id?: string;
    driver?: {
      id: string;
      full_name?: string;
      name?: string;
      phone?: string;
      status?: string;
      moderation_status?: string | null;
    };
  }
  const [fleetSubTab, setFleetSubTab] = useState<"live" | "tariffs">("live");
  const [cars, setCars] = useState<LiveFleetCar[]>([]);
  const [carsFilter, setCarsFilter] = useState({
    plate_number: "",
    driver_name: "",
    volume: "",
    status: "",
  });
  const [debouncedPlateNumber, setDebouncedPlateNumber] = useState("");
  const [isLoadingCars, setIsLoadingCars] = useState(false);
  const [isOrderHistoryModalOpen, setIsOrderHistoryModalOpen] = useState(false);
  const [selectedHistoryDriverId, setSelectedHistoryDriverId] = useState<
    string | null
  >(null);
  const [selectedHistoryDriverName, setSelectedHistoryDriverName] =
    useState("");
  // ------------------------

  const [drivers, setDrivers] = useState<AdminDriver[]>([]);
  const [pendingRequests, setPendingRequests] = useState<
    PendingModerationRequest[]
  >([]);
  const [driverActiveOverrides, setDriverActiveOverrides] = useState<
    Record<string, boolean>
  >({});
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingModeration, setIsLoadingModeration] = useState(false);

  const normalizeDriverModerationStatus = (value?: string | null) => {
    const normalized = value?.trim().toLowerCase();

    if (!normalized) {
      return null;
    }
    if (
      normalized === "blocked" ||
      normalized === "suspended" ||
      normalized === "заблокирован"
    ) {
      return "blocked";
    }
    if (normalized === "rejected" || normalized === "отклонен") {
      return "rejected";
    }
    if (
      normalized === "pending" ||
      normalized === "pending_moderation" ||
      normalized === "на модерации" ||
      normalized === "на проверке"
    ) {
      return "pending";
    }
    if (normalized === "approved" || normalized === "одобрен") {
      return "approved";
    }

    return null;
  };

  const normalizeDriverWorkStatus = (value?: string | null) => {
    const normalized = value?.trim().toLowerCase();

    if (normalized === "available" || normalized === "свободен") {
      return "available";
    }
    if (normalized === "busy" || normalized === "занят") {
      return "busy";
    }

    return "offline";
  };

  const getDriverStatusBadge = (
    driver?: { moderation_status?: string | null; status?: string | null } | null,
    carStatus?: string,
  ) => {
    const moderationStatus = normalizeDriverModerationStatus(
      driver?.moderation_status ?? carStatus,
    );

    if (moderationStatus === "blocked") {
      return (
        <span className="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold text-red-600 bg-red-100">
          Заблокирован
        </span>
      );
    }
    if (moderationStatus === "rejected") {
      return (
        <span className="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold text-red-600 bg-red-100">
          Отклонен
        </span>
      );
    }
    if (moderationStatus === "pending") {
      return (
        <span className="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold text-yellow-600 bg-yellow-100">
          На модерации
        </span>
      );
    }

    const status = normalizeDriverWorkStatus(driver?.status || carStatus || "offline");
    if (status === "available") {
      return (
        <span className="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold text-green-600 bg-green-100">
          Свободен
        </span>
      );
    }
    if (status === "busy") {
      return (
        <span className="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold text-blue-600 bg-blue-100">
          Занят
        </span>
      );
    }
    return (
      <span className="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold text-gray-600 bg-gray-100">
        Недоступен
      </span>
    );
  };

  // Modals state
  const [isMaterialModalOpen, setIsMaterialModalOpen] = useState(false);
  const [editingMaterial, setEditingMaterial] =
    useState<Partial<AdminMaterial> | null>(null);
  const [isSavingMaterial, setIsSavingMaterial] = useState(false);

  const [isDeliveryModalOpen, setIsDeliveryModalOpen] = useState(false);
  const [editingDelivery, setEditingDelivery] =
    useState<Partial<AdminDeliveryOption> | null>(null);
  const [isSavingDelivery, setIsSavingDelivery] = useState(false);

  const [isDriverModalOpen, setIsDriverModalOpen] = useState(false);
  const [editingDriver, setEditingDriver] = useState<
    Partial<AdminDriver> & { password?: string }
  >({});
  const [isSavingDriver, setIsSavingDriver] = useState(false);
  const [showDriverPassword, setShowDriverPassword] = useState(false);
  const [fileMain, setFileMain] = useState<File | null>(null);
  const [fileLeft, setFileLeft] = useState<File | null>(null);
  const [filePlate, setFilePlate] = useState<File | null>(null);
  const [previewMain, setPreviewMain] = useState<string | null>(null);
  const [previewLeft, setPreviewLeft] = useState<string | null>(null);
  const [previewPlate, setPreviewPlate] = useState<string | null>(null);

  const sortedDeliveryOptions = useMemo(() => {
    return [...deliveryOptions].sort(
      (a, b) => (a.capacity_m3 || 0) - (b.capacity_m3 || 0),
    );
  }, [deliveryOptions]);

  const applyDriverActiveOverrides = (items: AdminDriver[]) =>
    items.map((driver) => {
      if (!driver.id || !(driver.id in driverActiveOverrides)) {
        return driver;
      }
      return { ...driver, is_active: driverActiveOverrides[driver.id] };
    });

  const renderVehicleCell = (driver: AdminDriver) => {
    const brand = driver.vehicle?.brand || driver.vehicle_brand;
    const plate = driver.vehicle?.plate_number || driver.vehicle_plate_number;

    if (!brand && !plate && !driver.vehicle) {
      return <span className="text-slate-400">Автомобиль не назначен</span>;
    }
    return (
      <div className="flex flex-col gap-1.5 items-start">
        <span className="text-sm font-medium text-gray-900">
          {brand || "Неизвестно"}
        </span>
        {plate ? (
          <div className="flex items-center bg-white border border-gray-400 rounded-md shadow-sm overflow-hidden w-max">
            <span className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 text-gray-900">
              {plate}
            </span>
            <div className="border-l border-gray-400 flex flex-col items-center justify-center px-1.5 py-0.5 bg-white">
              <span className="text-[8px] font-bold leading-none text-gray-800 mb-0.5">
                RUS
              </span>
              <svg
                className="w-3 h-2 rounded-[1px] block"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 9 6"
              >
                <rect fill="#fff" width="9" height="2" />
                <rect fill="#0039a6" y="2" width="9" height="2" />
                <rect fill="#d52b1e" y="4" width="9" height="2" />
              </svg>
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  const handleLogout = async () => {
    await logoutCurrentSession();
    onLogout();
  };

  const handleApproveDriver = async (id: string) => {
    try {
      const res = await fetch(`${baseURL}/admin/drivers/${id}/approve`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setPendingRequests((prev) =>
          prev.filter((request) => request.driver_id !== id),
        );
        setDrivers((prev) =>
          prev.map((driver) =>
            driver.id === id
              ? { ...driver, moderation_status: "approved" }
              : driver,
          ),
        );
        toast.success("Водитель одобрен");
        fetchDrivers(true);
      } else {
        toast.error("Ошибка при одобрении");
      }
    } catch {
      toast.error("Ошибка на сервере");
    }
  };

  const handleRejectDriver = async (id: string) => {
    try {
      const res = await fetch(`${baseURL}/admin/drivers/${id}/reject`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setPendingRequests((prev) =>
          prev.filter((request) => request.driver_id !== id),
        );
        setDrivers((prev) =>
          prev.map((driver) =>
            driver.id === id
              ? { ...driver, moderation_status: "rejected" }
              : driver,
          ),
        );
        toast.success("Водитель отклонен");
        fetchDrivers(true);
      } else {
        toast.error("Ошибка при отклонении");
      }
    } catch {
      toast.error("Ошибка на сервере");
    }
  };

  const handleSuspendDriver = async (id: string) => {
    try {
      const res = await fetch(`${baseURL}/admin/drivers/${id}/suspend`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        toast.success("Водитель заблокирован");
        fetchDrivers(true);
      } else {
        toast.error("Ошибка при блокировке");
      }
    } catch {
      toast.error("Ошибка на сервере");
    }
  };

  const fetchCategories = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${baseURL}/admin/categories/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setCategories(Array.isArray(data) ? data : data.results || []);
      }
    } catch (e) {
      console.warn("Failed to fetch categories");
    }
  };

  const [uploadingSlots, setUploadingSlots] = useState<Record<string, boolean>>(
    {},
  );

  const uploadPhoto = async (
    file: File,
    entityType: string,
    entityId: string,
    slotKey: string,
  ) => {
    const slotId = `${entityType}-${entityId}-${slotKey}`;
    setUploadingSlots((prev) => ({ ...prev, [slotId]: true }));
    try {
      // Подготовим безопасное имя файла, чтобы избежать ошибки "Unsupported file extension"
      let fileExt = file.name.includes(".")
        ? file.name.split(".").pop()?.toLowerCase()
        : "";
      if (
        !fileExt ||
        !["jpg", "jpeg", "png", "webp", "gif"].includes(fileExt)
      ) {
        fileExt =
          file.type === "image/png"
            ? "png"
            : file.type === "image/webp"
              ? "webp"
              : "jpg";
      }
      const safeFileName = `photo-${Date.now()}.${fileExt}`;
      const safeContentType =
        file.type || `image/${fileExt === "jpg" ? "jpeg" : fileExt}`;

      // ШАГ 1: Presign
      const presignRes = await fetch(`${baseURL}/media/presign-upload`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          file_name: safeFileName,
          content_type: safeContentType,
          file_size: file.size,
          entity_type: entityType,
          entity_id: entityId,
          is_primary: false,
          slot_key: slotKey,
        }),
      });

      if (!presignRes.ok) {
        const errText = await presignRes.text();
        throw new Error(`Ошибка Presign: ${errText}`);
      }

      const presignData = await presignRes.json();
      if (!presignData.upload_url)
        throw new Error("Бэкенд не вернул upload_url!");

      // ШАГ 2: Upload to S3
      const uploadRes = await fetch(presignData.upload_url, {
        method: "PUT",
        headers: {
          "Content-Type": safeContentType,
        },
        body: file,
      });

      if (!uploadRes.ok) {
        throw new Error(`Ошибка S3 (PUT): Статус ${uploadRes.status}`);
      }

      // ШАГ 3: Confirm
      const confirmRes = await fetch(`${baseURL}/media/confirm`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          entity_type: entityType,
          entity_id: entityId,
          object_key: presignData.object_key,
          file_name: safeFileName,
          content_type: safeContentType,
          file_size: file.size,
          is_primary: false,
          slot_key: slotKey,
        }),
      });

      if (!confirmRes.ok) {
        const errText = await confirmRes.text();
        throw new Error(`Ошибка Confirm: ${errText}`);
      }

      toast.success("Фото успешно загружено!");

      // refetch after upload
      if (entityType === "material") {
        await fetchMaterials(true);
        const refetchRes = await fetch(
          `${baseURL}/admin/materials/${entityId}`,
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );
        if (refetchRes.ok) setEditingMaterial(await refetchRes.json());
      } else if (entityType === "delivery_option") {
        await fetchDeliveryOptions(true);
        const refetchRes = await fetch(
          `${baseURL}/catalog/delivery-options/${entityId}`,
        );
        if (refetchRes.ok) setEditingDelivery(await refetchRes.json());
      }
    } catch (err: any) {
      console.error("Full Upload Error:", err);
      toast.error(handleApiError(err, "Сбой загрузки фото"));
    } finally {
      setUploadingSlots((prev) => ({ ...prev, [slotId]: false }));
    }
  };

  const fetchMaterials = async (silent = false) => {
    if (!token) return;
    if (!silent) setIsLoading(true);
    try {
      const res = await fetch(`${baseURL}/admin/materials/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Ошибка загрузки материалов");
      const data = await res.json();
      setMaterials(Array.isArray(data) ? data : data.results || []);
    } catch (err) {
      if (!silent) toast.error("Не удалось загрузить каталог");
    } finally {
      if (!silent) setIsLoading(false);
    }
  };

  const fetchDeliveryOptions = async (silent = false) => {
    if (!token) return;
    if (!silent) setIsLoading(true);
    try {
      const res = await fetch(`${baseURL}/catalog/delivery-options/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Ошибка загрузки автопарка");
      const data = await res.json();
      setDeliveryOptions(Array.isArray(data) ? data : data.results || []);
    } catch (err) {
      if (!silent) toast.error("Не удалось загрузить типы машин");
    } finally {
      if (!silent) setIsLoading(false);
    }
  };

  const fetchDrivers = async (silent = false) => {
    if (!token) return;
    if (!silent) setIsLoading(true);
    try {
      let res = await fetch(`${baseURL}/admin/drivers`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 404 || res.status === 405) {
        res = await fetch(`${baseURL}/drivers/`, {
          headers: { Authorization: `Bearer ${token}` },
        });
      }
      if (!res.ok) throw new Error("Ошибка загрузки водителей");
      const data = await res.json();
      const items = Array.isArray(data) ? data : data.results || [];
      setDrivers(applyDriverActiveOverrides(items));
    } catch (err) {
      if (!silent) toast.error("Не удалось загрузить водителей");
    } finally {
      if (!silent) setIsLoading(false);
    }
  };

  const fetchPendingRequests = async (silent = false) => {
    if (!token) return;
    if (!silent) setIsLoadingModeration(true);
    try {
      const res = await fetch(`${baseURL}/admin/moderation/pending`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Не удалось загрузить ожидающие запросы");
      const data = await res.json();
      const items = Array.isArray(data) ? data : data.results || [];
      setPendingRequests(items);
    } catch (err) {
      if (!silent) toast.error("Не удалось загрузить заявки");
    } finally {
      if (!silent) setIsLoadingModeration(false);
    }
  };

  const fetchLiveCars = async () => {
    if (!token) return;
    setIsLoadingCars(true);
    try {
      const params = new URLSearchParams();
      if (debouncedPlateNumber)
        params.append("plate_number", debouncedPlateNumber);
      if (carsFilter.driver_name)
        params.append("driver_name", carsFilter.driver_name);
      if (carsFilter.volume && carsFilter.volume !== "all")
        params.append("volume", carsFilter.volume);
      if (carsFilter.status && carsFilter.status !== "all")
        params.append("status", carsFilter.status);

      const url = `${baseURL}/admin/cars?${params.toString()}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to fetch live cars");
      const data = await res.json();
      console.log("CARS DATA:", data);
      setCars(Array.isArray(data) ? data : data.items || data.results || []);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoadingCars(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedPlateNumber(carsFilter.plate_number);
    }, 500);
    return () => clearTimeout(timer);
  }, [carsFilter.plate_number]);

  useEffect(() => {
    if (activeTab === "delivery" && fleetSubTab === "live") {
      fetchLiveCars();
    }
  }, [
    debouncedPlateNumber,
    carsFilter.driver_name,
    carsFilter.volume,
    carsFilter.status,
    activeTab,
    fleetSubTab,
  ]);

  useEffect(() => {
    fetchCategories();
    if (activeTab === "materials" && materials.length === 0) {
      fetchMaterials();
    } else if (activeTab === "delivery" && deliveryOptions.length === 0) {
      fetchDeliveryOptions();
    } else if (activeTab === "drivers" && drivers.length === 0) {
      fetchDrivers();
      if (deliveryOptions.length === 0) fetchDeliveryOptions(true);
    } else if (activeTab === "moderation" && pendingRequests.length === 0) {
      fetchPendingRequests();
    }
  }, [activeTab]);

  const [itemToDelete, setItemToDelete] = useState<{
    id: string;
    type: "material" | "delivery" | "driver";
  } | null>(null);

  const confirmDeleteAction = async () => {
    if (!itemToDelete) return;
    const { id, type } = itemToDelete;
    // Set to null to hide modal immediately while deleting, or keep it open?
    // User: "При клике вызывает реальную функцию DELETE запроса, показывает toast и закрывает модалку."
    setItemToDelete(null);

    if (type === "material") {
      try {
        const res = await fetch(`${baseURL}/admin/materials/${id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail || "Ошибка удаления");
        toast.success("Товар удален из базы");
        fetchMaterials(true);
      } catch (err: any) {
        toast.error(err.message || "Ошибка удаления");
      }
    } else if (type === "delivery") {
      try {
        const res = await fetch(`${baseURL}/admin/delivery-options/${id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error("Ошибка удаления");
        const data = await res.json();
        if (data.action === "hidden") {
          toast.success("Элемент скрыт (так как имеет связанные заказы)");
        } else {
          toast.success("Успешно удалено");
        }
        fetchDeliveryOptions(true);
      } catch (err) {
        toast.error("Ошибка удаления");
      }
    } else if (type === "driver") {
      try {
        const res = await fetch(`${baseURL}/admin/drivers/${id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error("Ошибка удаления");
        toast.success("Водитель успешно удален");
        fetchDrivers(true);
      } catch (err) {
        toast.error("Ошибка удаления");
      }
    }
  };

  const handleDeleteMedia = async (mediaId: string, entityType: string) => {
    try {
      const res = await fetch(`${baseURL}/media/${mediaId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Ошибка удаления фото");
      toast.success("Фотография успешно удалена!");

      if (entityType === "material") {
        await fetchMaterials(true);
        if (editingMaterial && editingMaterial.id) {
          const refetchRes = await fetch(
            `${baseURL}/admin/materials/${editingMaterial.id}`,
            {
              headers: { Authorization: `Bearer ${token}` },
            },
          );
          if (refetchRes.ok) setEditingMaterial(await refetchRes.json());
        }
      } else if (entityType === "delivery_option") {
        await fetchDeliveryOptions(true);
        if (editingDelivery && editingDelivery.id) {
          const refetchRes = await fetch(
            `${baseURL}/catalog/delivery-options/${editingDelivery.id}`,
          );
          if (refetchRes.ok) setEditingDelivery(await refetchRes.json());
        }
      }
    } catch (err) {
      toast.error("Ошибка удаления фото");
    }
  };

  const handleMakePrimary = async (mediaId: string, entityType: string) => {
    try {
      const res = await fetch(`${baseURL}/media/${mediaId}/make-primary`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Ошибка назначения фото главным");
      toast.success("Главное фото успешно назначено!");

      if (entityType === "material") {
        await fetchMaterials(true);
        if (editingMaterial && editingMaterial.id) {
          const refetchRes = await fetch(
            `${baseURL}/admin/materials/${editingMaterial.id}`,
            {
              headers: { Authorization: `Bearer ${token}` },
            },
          );
          if (refetchRes.ok) setEditingMaterial(await refetchRes.json());
        }
      } else if (entityType === "delivery_option") {
        await fetchDeliveryOptions(true);
        if (editingDelivery && editingDelivery.id) {
          const refetchRes = await fetch(
            `${baseURL}/catalog/delivery-options/${editingDelivery.id}`,
          );
          if (refetchRes.ok) setEditingDelivery(await refetchRes.json());
        }
      }
    } catch (err) {
      toast.error("Ошибка обновления фото");
    }
  };

  const handleSaveMaterial = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMaterial?.name || editingMaterial.price === undefined) {
      toast.error("Заполните обязательные поля (Название, Цена)");
      return;
    }

    setIsSavingMaterial(true);
    try {
      const isEdit = !!editingMaterial.id;
      const url = isEdit
        ? `${baseURL}/admin/materials/${editingMaterial.id}`
        : `${baseURL}/admin/materials/`;
      const method = isEdit ? "PATCH" : "POST";

      const payload: any = {
        name: editingMaterial.name,
        description: editingMaterial.description || "",
        price: Number(editingMaterial.price),
        unit: editingMaterial.unit || "м3",
        min_volume: Number(editingMaterial.min_volume || 1),
        is_active: editingMaterial.is_active ?? true,
        category_id: editingMaterial.category_id || categories[0]?.id || null,
      };

      if (!payload.category_id) {
        throw new Error("Сначала создайте категорию материалов");
      }

      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error("Ошибка сохранения");
      const savedData = await res.json();
      const entityId = isEdit ? editingMaterial.id! : savedData.id;

      toast.success(isEdit ? "Материал обновлен" : "Материал добавлен");
      setIsMaterialModalOpen(false);
      fetchMaterials(true);
    } catch (err) {
      toast.error("Ошибка сохранения материала");
    } finally {
      setIsSavingMaterial(false);
    }
  };

  const handleSaveDelivery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDelivery?.title || editingDelivery.capacity_m3 === undefined) {
      toast.error("Заполните обязательные поля (Название, Объем)");
      return;
    }

    setIsSavingDelivery(true);
    try {
      const isEdit = !!editingDelivery.id;
      const url = isEdit
        ? `${baseURL}/admin/delivery-options/${editingDelivery.id}`
        : `${baseURL}/admin/delivery-options`;
      const method = isEdit ? "PATCH" : "POST";

      const payload: any = {
        title: editingDelivery.title,
        capacity_m3: Number(editingDelivery.capacity_m3),
        delivery_rate_per_km: editingDelivery.delivery_rate_per_km
          ? Number(editingDelivery.delivery_rate_per_km)
          : null,
        min_price_quarry: Number(editingDelivery.min_price_quarry ?? 5000),
        min_price_warehouse: Number(editingDelivery.min_price_warehouse ?? 3000),
        is_active: editingDelivery.is_active ?? true,
        sort_order: 10,
      };

      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(extractApiErrorMessage(errData, "Ошибка сервера"));
      }

      const savedData = await res.json();
      const entityId = isEdit ? editingDelivery.id! : savedData.id;

      toast.success(
        isEdit ? "Опция доставки обновлена" : "Опция доставки добавлена",
      );
      setIsDeliveryModalOpen(false);
      fetchDeliveryOptions(true);
    } catch (err: any) {
      toast.error(handleApiError(err, "Ошибка сохранения опции доставки"));
    } finally {
      setIsSavingDelivery(false);
    }
  };

  const formatPhoneNumber = (value: string) => {
    let digits = value.replace(/\D/g, "");
    if (digits.startsWith("7") || digits.startsWith("8")) {
      digits = digits.substring(1);
    }
    digits = digits.substring(0, 10);

    let formatted = "+7";
    if (digits.length > 0) {
      formatted += " (" + digits.substring(0, 3);
    }
    if (digits.length >= 3) {
      formatted += ") " + digits.substring(3, 6);
    }
    if (digits.length >= 6) {
      formatted += "-" + digits.substring(6, 8);
    }
    if (digits.length >= 8) {
      formatted += "-" + digits.substring(8, 10);
    }
    return formatted;
  };

  const openDriverModal = (driver?: AdminDriver) => {
    setFileMain(null);
    setFileLeft(null);
    setFilePlate(null);
    if (driver) {
      setPreviewMain(
        driver.vehicle?.media_files?.find(
          (m: any) => m.slot_key === "vehicle_main",
        )?.public_url ||
          driver.vehicle?.vehicle_main_url ||
          null,
      );
      setPreviewLeft(
        driver.vehicle?.media_files?.find(
          (m: any) => m.slot_key === "vehicle_left",
        )?.public_url ||
          driver.vehicle?.vehicle_left_url ||
          null,
      );
      setPreviewPlate(
        driver.vehicle?.media_files?.find(
          (m: any) => m.slot_key === "vehicle_plate",
        )?.public_url ||
          driver.vehicle?.vehicle_plate_url ||
          null,
      );

      setEditingDriver({
        ...driver,
        vehicle_brand: driver.vehicle?.brand || driver.vehicle_brand,
        vehicle_plate_number:
          driver.vehicle?.plate_number || driver.vehicle_plate_number,
        vehicle_type: driver.vehicle?.vehicle_type || driver.vehicle_type,
        cubature_min: driver.vehicle?.cubature_min || driver.cubature_min,
        cubature_max: driver.vehicle?.cubature_max || driver.cubature_max,
        tonnage_min: driver.vehicle?.tonnage_min || driver.tonnage_min,
        tonnage_max: driver.vehicle?.tonnage_max || driver.tonnage_max,
        phone: formatPhoneNumber(driver.phone),
      });
    } else {
      setPreviewMain(null);
      setPreviewLeft(null);
      setPreviewPlate(null);
      setEditingDriver({ is_active: true, phone: "+7" });
    }
    setIsDriverModalOpen(true);
  };

  const cleanPhone = (phone: string) => phone.replace(/[\s()-]/g, "");

  const handleSaveDriver = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !editingDriver?.name ||
      !editingDriver?.phone ||
      !editingDriver?.vehicle_type
    ) {
      toast.error("Заполните обязательные поля (Имя, Телефон, Тип машины)");
      return;
    }

    setIsSavingDriver(true);
    try {
      const isEdit = !!editingDriver.id;
      if (!isEdit && !editingDriver.password) {
        toast.error("Укажите пароль для нового водителя");
        setIsSavingDriver(false);
        return;
      }

      const url = isEdit
        ? `${baseURL}/admin/drivers/${editingDriver.id}`
        : `${baseURL}/admin/drivers`;
      const method = isEdit ? "PATCH" : "POST";

      let fullPhone = cleanPhone(editingDriver.phone);
      if (fullPhone.startsWith("8")) {
        fullPhone = "+7" + fullPhone.substring(1);
      } else if (!fullPhone.startsWith("+")) {
        fullPhone = "+" + fullPhone;
      }

      const parseNumber = (val: any) => {
        if (val === undefined || val === null || val === "") return undefined;
        return Number(val);
      };

      const payload: any = {
        name: editingDriver.name,
        phone: fullPhone,
        is_active: editingDriver.is_active ?? true,
        vehicle_type: editingDriver.vehicle_type,
        cubature_min: parseNumber(editingDriver.cubature_min),
        cubature_max: parseNumber(editingDriver.cubature_max),
        tonnage_min: parseNumber(editingDriver.tonnage_min),
        tonnage_max: parseNumber(editingDriver.tonnage_max),
        vehicle_brand: editingDriver.vehicle_brand,
        vehicle_plate_number: editingDriver.vehicle_plate_number,
      };

      if (!isEdit && payload.is_active) {
        payload.status = "free";
      }

      if (editingDriver.password) {
        payload.password = editingDriver.password;
      }

      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        if (errData?.detail && Array.isArray(errData.detail)) {
          const errorMessages = errData.detail.map((err: any) => {
            const field = err.loc[err.loc.length - 1];
            if (field === "password")
              return "Пароль: должен содержать не менее 6 символов";
            if (field === "phone") return "Телефон: неверный формат";
            if (
              field === "cubature_min" ||
              field === "cubature_max" ||
              field === "tonnage_min" ||
              field === "tonnage_max"
            )
              return "Пожалуйста, корректно заполните кубатуру и тоннаж";
            return "Проверьте правильность заполнения полей";
          });
          const uniqueErrors = Array.from(new Set(errorMessages));
          throw new Error(uniqueErrors.join("\n"));
        }
        const errorOb: any = new Error(errData?.detail || "Ошибка сохранения");
        errorOb.response = { status: res.status, data: errData };
        throw errorOb;
      }

      let vehicleId = editingDriver.vehicle?.id;
      try {
        const resData = await res.json();
        if (resData?.vehicle?.id) vehicleId = resData.vehicle.id;
        else if (resData?.id) vehicleId = resData.id;
      } catch (e) {
        // ignore if empty response
      }

      if (vehicleId) {
        const filesToUpload = [
          { file: fileMain, slotKey: "vehicle_main" },
          { file: fileLeft, slotKey: "vehicle_left" },
          { file: filePlate, slotKey: "vehicle_plate" },
        ].filter((item) => item.file !== null);

        for (const item of filesToUpload) {
          try {
            const file = item.file as File;
            let fileExt = file.name.split(".").pop()?.toLowerCase() || "jpg";
            if (
              fileExt !== "jpg" &&
              fileExt !== "jpeg" &&
              fileExt !== "png" &&
              fileExt !== "webp"
            ) {
              fileExt =
                file.type === "image/png"
                  ? "png"
                  : file.type === "image/webp"
                    ? "webp"
                    : "jpg";
            }
            const safeFileName = `photo-${Date.now()}.${fileExt}`;
            const safeContentType =
              file.type || `image/${fileExt === "jpg" ? "jpeg" : fileExt}`;

            // 1: Presign
            const presignRes = await fetch(`${baseURL}/media/presign-upload`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                file_name: safeFileName,
                content_type: safeContentType,
                file_size: file.size,
                entity_type: "vehicle",
                entity_id: vehicleId,
                is_primary: false,
                sort_order: 0,
                slot_key: item.slotKey,
              }),
            });

            if (!presignRes.ok)
              throw new Error(`Ошибка Presign для ${item.slotKey}`);
            const presignData = await presignRes.json();
            if (!presignData.upload_url) throw new Error("Нет upload_url");

            // 2: Upload
            const uploadRes = await fetch(presignData.upload_url, {
              method: "PUT",
              headers: { "Content-Type": safeContentType },
              body: file,
            });
            if (!uploadRes.ok) throw new Error(`Ошибка S3 для ${item.slotKey}`);

            // 3: Confirm
            const confirmRes = await fetch(`${baseURL}/media/confirm`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                entity_type: "vehicle",
                entity_id: vehicleId,
                object_key: presignData.object_key,
                file_name: safeFileName,
                content_type: safeContentType,
                file_size: file.size,
                is_primary: false,
                slot_key: item.slotKey,
              }),
            });
            if (!confirmRes.ok)
              throw new Error(`Ошибка Confirm для ${item.slotKey}`);
          } catch (err: any) {
            console.error(err);
            if (err instanceof TypeError && err.message.includes("fetch")) {
              toast.error(
                "Не удалось загрузить фото. Проверьте интернет или отключите VPN.",
              );
            } else {
              toast.error("Сбой при загрузке медиафайла.");
            }
          }
        }
      }

      const previousIsActive = isEdit
        ? drivers.find((driver) => driver.id === editingDriver.id)?.is_active
        : undefined;
      const nextIsActive = editingDriver.is_active ?? true;
      const isStatusChanged = isEdit && previousIsActive !== nextIsActive;

      if (isEdit && editingDriver.id) {
        setDriverActiveOverrides((prev) => ({
          ...prev,
          [editingDriver.id!]: nextIsActive,
        }));
        setDrivers((prev) =>
          prev.map((driver) =>
            driver.id === editingDriver.id
              ? { ...driver, is_active: nextIsActive }
              : driver,
          ),
        );
      }

      toast.success(
        !isEdit
          ? "Водитель добавлен"
          : isStatusChanged
            ? "Статус водителя изменен"
            : "Водитель успешно сохранен",
      );
      setIsDriverModalOpen(false);
      fetchDrivers(true);
    } catch (err: any) {
      if (err.response?.status === 409) {
        toast.error(
          extractApiErrorMessage(
            err,
            "Водитель с таким номером телефона или госномером уже существует",
          ),
        );
        return;
      }
      if (
        err.message &&
        (err.message.includes("Пароль:") ||
          err.message.includes("Телефон:") ||
          err.message.includes("Пожалуйста,") ||
          err.message.includes("Проверьте правильность"))
      ) {
        toast.error(err.message);
      } else {
        toast.error(handleApiError(err, "Ошибка сохранения водителя"));
      }
    } finally {
      setIsSavingDriver(false);
    }
  };

  const openMaterialModal = async (material?: AdminMaterial) => {
    if (material) {
      setEditingMaterial({ ...material });
      setIsMaterialModalOpen(true);
      try {
        const res = await fetch(`${baseURL}/admin/materials/${material.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setEditingMaterial({
            ...data,
            media_files: data.media_files || material.media_files,
          });
        }
      } catch (err) {
        console.error("Failed to fetch material details", err);
      }
    } else {
      setEditingMaterial({
        is_active: true,
        unit: "м3",
        min_volume: 1,
        price: 0,
        category_id: categories[0]?.id,
      });
      setIsMaterialModalOpen(true);
    }
  };

  const openDeliveryModal = async (delivery?: AdminDeliveryOption) => {
    if (delivery) {
      setEditingDelivery({ ...delivery });
      setIsDeliveryModalOpen(true);
      try {
        const res = await fetch(
          `${baseURL}/catalog/delivery-options/${delivery.id}`,
        );
        if (res.ok) {
          const data = await res.json();
          setEditingDelivery({
            ...data,
            media_files: data.media_files || delivery.media_files,
          });
        }
      } catch (err) {
        console.error("Failed to fetch delivery details", err);
      }
    } else {
      setEditingDelivery({
        is_active: true,
        capacity_m3: 0,
        min_price_quarry: 5000,
        min_price_warehouse: 3000,
      });
      setIsDeliveryModalOpen(true);
    }
  };

  const renderPhotoSlot = (
    entityType: string,
    entityId: string | undefined,
    slotKey: string,
    title: string,
    mediaFiles: AdminMediaFile[] = [],
  ) => {
    if (!entityId) {
      return (
        <div className="flex flex-col gap-1.5 opacity-50">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
            {title}
          </label>
          <div className="border-2 border-dashed border-slate-200 rounded-xl p-4 flex flex-col items-center justify-center text-center">
            <span className="text-xs font-medium text-slate-500">
              Сначала сохраните элемент
            </span>
          </div>
        </div>
      );
    }

    const file = mediaFiles.find((m) => m.slot_key === slotKey);
    const slotId = `${entityType}-${entityId}-${slotKey}`;
    const isUploading = uploadingSlots[slotId];

    return (
      <div className="flex flex-col gap-1.5" key={slotKey}>
        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
          {title}
        </label>
        {isUploading ? (
          <div className="border-2 border-slate-200 rounded-xl p-4 flex flex-col items-center justify-center bg-slate-50 h-32">
            <Loader2 className="w-6 h-6 animate-spin text-[#2DB0E6] mb-2" />
            <span className="text-xs font-medium text-slate-500">
              Загрузка...
            </span>
          </div>
        ) : file ? (
          <div className="border border-slate-200 rounded-xl p-2 relative group overflow-hidden bg-white">
            <div className="aspect-video bg-slate-100 rounded-lg overflow-hidden relative">
              <img
                src={file.public_url}
                alt={title}
                className="w-full h-full object-cover"
              />
              {file.is_primary && (
                <div className="absolute top-2 left-2 bg-[#2DB0E6] text-white text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded shadow-sm flex items-center gap-1">
                  <Star className="w-3 h-3 fill-current" /> Главное
                </div>
              )}
            </div>
            <div className="flex gap-2 mt-2">
              <button
                type="button"
                onClick={() => handleMakePrimary(file.id, entityType)}
                className={`flex-1 flex justify-center items-center gap-1.5 text-xs font-bold py-1.5 rounded-lg transition-colors border ${file.is_primary ? "bg-[#2DB0E6]/10 text-[#209ccf] border-[#209ccf]/20" : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"}`}
              >
                {file.is_primary ? (
                  <Star className="w-3.5 h-3.5 fill-current" />
                ) : (
                  <StarOff className="w-3.5 h-3.5" />
                )}
                {file.is_primary ? "Главное" : "Сделать главным"}
              </button>
              <button
                type="button"
                onClick={() => handleDeleteMedia(file.id, entityType)}
                className="px-3 flex justify-center items-center text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ) : (
          <div className="border-2 border-dashed border-slate-200 rounded-xl p-4 flex flex-col items-center justify-center gap-2 hover:bg-slate-50 hover:border-[#2DB0E6]/30 transition-all cursor-pointer relative h-32">
            <UploadCloud className="w-6 h-6 text-slate-400" />
            <span className="text-xs font-medium text-slate-500">
              Загрузить фото
            </span>
            <input
              type="file"
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              accept="image/*"
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  uploadPhoto(e.target.files[0], entityType, entityId, slotKey);
                  e.target.value = "";
                }
              }}
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-screen bg-slate-50 relative overflow-hidden text-slate-800">
      {/* Header */}
      <div className="bg-white px-6 py-4 shadow-sm z-10 sticky top-0 border-b border-slate-100 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <div className="flex items-center justify-between sm:justify-start gap-6">
          <div>
            <h1 className="text-2xl font-black text-[#2DB0E6] tracking-tight">
              Дармавоз
            </h1>
            <p className="text-sm font-medium text-slate-500">
              Панель администратора
            </p>
          </div>
          <button
            onClick={handleLogout}
            className="flex sm:hidden items-center gap-2 px-3 py-1.5 bg-slate-50 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors font-medium text-sm"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>

        <div className="hidden sm:flex flex-1 sm:justify-center">
          <div className="bg-slate-100 p-1 rounded-xl flex w-full sm:w-auto">
            <button
              onClick={() => setActiveTab("materials")}
              className={`flex-1 sm:w-auto flex-shrink-0 whitespace-nowrap py-2 px-3 text-sm font-bold rounded-lg transition-colors flex items-center justify-center gap-2 ${
                activeTab === "materials"
                  ? "bg-white text-[#209ccf] shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <Layers className="w-4 h-4" />
              Каталог
            </button>
            <button
              onClick={() => setActiveTab("quarries")}
              className={`flex-1 sm:w-auto flex-shrink-0 whitespace-nowrap py-2 px-3 text-sm font-bold rounded-lg transition-colors flex items-center justify-center gap-2 ${
                activeTab === "quarries"
                  ? "bg-white text-[#209ccf] shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <Map className="w-4 h-4" />
              Карьеры
            </button>
            <button
              onClick={() => setActiveTab("delivery")}
              className={`flex-1 sm:w-auto flex-shrink-0 whitespace-nowrap py-2 px-3 text-sm font-bold rounded-lg transition-colors flex items-center justify-center gap-2 ${
                activeTab === "delivery"
                  ? "bg-white text-[#209ccf] shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <Truck className="w-4 h-4" />
              Автопарк
            </button>
            <button
              onClick={() => setActiveTab("drivers")}
              className={`flex-1 sm:w-auto flex-shrink-0 whitespace-nowrap py-2 px-3 text-sm font-bold rounded-lg transition-colors flex items-center justify-center gap-2 ${
                activeTab === "drivers"
                  ? "bg-white text-[#209ccf] shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <Users className="w-4 h-4" />
              Водители
            </button>
            <button
              onClick={() => setActiveTab("moderation")}
              className={`flex-1 sm:w-auto flex-shrink-0 whitespace-nowrap py-2 px-3 text-sm font-bold rounded-lg transition-colors flex items-center justify-center gap-2 ${
                activeTab === "moderation"
                  ? "bg-white text-[#209ccf] shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <div className="relative flex items-center justify-center">
                <ClipboardCheck className="w-4 h-4" />
                {drivers.filter(
                  (d) => d.moderation_status === "pending_moderation",
                ).length > 0 && (
                  <div className="absolute -top-1.5 -right-2 bg-rose-500 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center shadow-sm">
                    {
                      drivers.filter(
                        (d) => d.moderation_status === "pending_moderation",
                      ).length
                    }
                  </div>
                )}
              </div>
              Модерация
            </button>
            <button
              onClick={() => setActiveTab("profile")}
              className={`flex-1 sm:w-auto flex-shrink-0 whitespace-nowrap py-2 px-3 text-sm font-bold rounded-lg transition-colors flex items-center justify-center gap-2 ${
                activeTab === "profile"
                  ? "bg-white text-[#209ccf] shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <User className="w-4 h-4" />
              Профиль
            </button>
          </div>
        </div>

        <button
          onClick={handleLogout}
          className="hidden sm:flex items-center gap-2 px-4 py-2 bg-slate-50 rounded-xl hover:bg-slate-100 text-slate-600 transition-colors font-medium text-sm border border-slate-200"
        >
          <LogOut className="w-4 h-4" />
          <span>Выйти</span>
        </button>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-6 lg:p-8 sm:pb-8 pb-24 relative">
        <div className="max-w-6xl mx-auto flex flex-col gap-6">
          {activeTab === "materials" ? (
            <>
              <AdminCategoriesPanel
                token={token || ""}
                categories={categories}
                onChanged={fetchCategories}
              />
              <div className="flex justify-between items-center bg-white p-5 rounded-2xl shadow-sm border border-slate-100 mb-2">
                <h2 className="text-xl font-bold text-slate-800">Материалы</h2>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => fetchMaterials()}
                    className="text-sm font-semibold text-slate-500 hover:text-slate-700 transition-colors"
                  >
                    Обновить
                  </button>
                  <button
                    onClick={() => openMaterialModal()}
                    className="flex items-center gap-2 bg-[#2DB0E6] text-white px-4 py-2 rounded-xl font-semibold hover:bg-[#209ccf] transition-colors shadow-sm"
                  >
                    <Plus className="w-4 h-4" />
                    <span className="hidden sm:inline">Добавить</span>
                  </button>
                </div>

              </div>

              {isLoading ? (
                <div className="flex justify-center p-20">
                  <Loader2 className="w-10 h-10 animate-spin text-[#2DB0E6]" />
                </div>
              ) : (
                <div className="bg-transparent md:bg-white md:rounded-2xl md:shadow-sm md:border border-transparent md:border-slate-100 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="hidden md:table w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-100 text-xs uppercase tracking-wider font-bold text-slate-500">
                          <th className="px-6 py-4">ID</th>
                          <th className="px-6 py-4">Фото</th>
                          <th className="px-6 py-4">Название</th>
                          <th className="px-6 py-4">Цена</th>
                          <th className="px-6 py-4">Ед. изм.</th>
                          <th className="px-6 py-4">Статус</th>
                          <th className="px-6 py-4 text-right">Действия</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100/80">
                        {materials.map((m) => {
                          const imgUrl =
                            m.primary_image_url ||
                            m.image_url ||
                            m.media_files?.[0]?.public_url;
                          return (
                            <tr
                              key={m.id}
                              className="hover:bg-slate-50/50 transition-colors"
                            >
                              <td className="px-6 py-4 text-xs font-mono text-slate-400">
                                {m.id.substring(0, 8)}
                              </td>
                              <td className="px-6 py-4">
                                {imgUrl ? (
                                  <img
                                    src={imgUrl}
                                    alt={m.name}
                                    className="w-24 h-16 object-contain rounded-md border border-slate-200 bg-slate-50 p-1"
                                  />
                                ) : (
                                  <div className="w-24 h-16 rounded-md border border-slate-200 bg-slate-50 flex items-center justify-center text-slate-300">
                                    <ImageIcon className="w-5 h-5" />
                                  </div>
                                )}
                              </td>
                              <td className="px-6 py-4 font-semibold text-slate-800">
                                {m.name}
                              </td>
                              <td className="px-6 py-4 text-sm font-medium">
                                {m.price} ₽
                              </td>
                              <td className="px-6 py-4 text-sm text-slate-500">
                                {m.unit}
                              </td>
                              <td className="px-6 py-4">
                                {m.is_active === false ? (
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-amber-100 text-amber-800 text-[11px] font-bold uppercase tracking-wider whitespace-nowrap">
                                    <XCircle className="w-3 h-3" /> Не активен
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-50 text-emerald-700 text-[11px] font-bold uppercase tracking-wider whitespace-nowrap">
                                    <CheckCircle2 className="w-3 h-3" /> Активен
                                  </span>
                                )}
                              </td>
                              <td className="px-6 py-4 text-right flex justify-end gap-2">
                                <button
                                  onClick={() => openMaterialModal(m)}
                                  className="p-2 text-slate-400 hover:text-[#2DB0E6] bg-slate-50 hover:bg-[#2DB0E6]/10 rounded-lg transition-colors border border-transparent"
                                >
                                  <Edit2 className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() =>
                                    setItemToDelete({
                                      id: m.id,
                                      type: "material",
                                    })
                                  }
                                  className="p-2 text-slate-400 hover:text-red-600 bg-slate-50 hover:bg-red-50 rounded-lg transition-colors border border-transparent"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:hidden">
                    {materials.map((m) => {
                      const imgUrl =
                        m.primary_image_url ||
                        m.image_url ||
                        m.media_files?.[0]?.public_url;
                      return (
                        <div
                          key={m.id}
                          className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 flex flex-col gap-3 relative"
                        >
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-xs font-mono text-slate-400">
                              ID: {m.id.substring(0, 8)}
                            </span>
                            <div className="flex gap-2 -mt-2 -mr-2">
                              <button
                                onClick={() => openMaterialModal(m)}
                                className="p-2 text-slate-400 hover:text-[#2DB0E6] bg-slate-50 hover:bg-[#2DB0E6]/10 rounded-lg transition-colors border border-transparent"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() =>
                                  setItemToDelete({
                                    id: m.id,
                                    type: "material",
                                  })
                                }
                                className="p-2 text-slate-400 hover:text-red-600 bg-slate-50 hover:bg-red-50 rounded-lg transition-colors border border-transparent"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>

                          <div className="flex gap-4 items-start">
                            {imgUrl ? (
                              <img
                                src={imgUrl}
                                alt={m.name}
                                className="shrink-0 w-24 h-16 object-contain rounded-md border border-slate-200 bg-slate-50 p-1"
                              />
                            ) : (
                              <div className="shrink-0 w-24 h-16 rounded-md border border-slate-200 bg-slate-50 flex items-center justify-center text-slate-300">
                                <ImageIcon className="w-5 h-5" />
                              </div>
                            )}
                            <div className="flex flex-col gap-1 min-w-0">
                              <h3 className="font-bold text-slate-800 text-base truncate pr-2">
                                {m.name}
                              </h3>
                              <div className="flex flex-col gap-0.5 mt-1">
                                <span className="text-sm font-medium text-slate-700">
                                  Цена: {m.price} ₽
                                </span>
                                <span className="text-sm text-slate-500">
                                  Ед. изм.: {m.unit}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="mt-2 flex justify-start">
                            {m.is_active === false ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-amber-100 text-amber-800 text-[11px] font-bold uppercase tracking-wider whitespace-nowrap">
                                <XCircle className="w-3 h-3" /> Не активен
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-50 text-emerald-700 text-[11px] font-bold uppercase tracking-wider whitespace-nowrap">
                                <CheckCircle2 className="w-3 h-3" /> Активен
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {materials.length === 0 && (
                    <div className="p-8 text-center text-slate-500 font-medium">
                      Нет загруженных материалов
                    </div>
                  )}
                </div>
              )}
            </>
          ) : activeTab === "delivery" ? (
            <div className="flex flex-col gap-4">
              <div className="flex gap-2 border-b border-slate-200 pb-2 overflow-x-auto scrollbar-hide hide-scrollbar">
                <button
                  onClick={() => setFleetSubTab("live")}
                  className={`px-4 py-2 font-bold text-sm rounded-xl transition-colors whitespace-nowrap ${fleetSubTab === "live" ? "bg-[#2DB0E6] text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
                >
                  Живой автопарк
                </button>
                <button
                  onClick={() => setFleetSubTab("tariffs")}
                  className={`px-4 py-2 font-bold text-sm rounded-xl transition-colors whitespace-nowrap ${fleetSubTab === "tariffs" ? "bg-[#2DB0E6] text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
                >
                  Справочник тарифов
                </button>
              </div>

              {fleetSubTab === "live" ? (
                <>
                  {/* Filters */}
                  <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex flex-col md:flex-row gap-4">
                    <div className="flex-1 relative">
                      <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        placeholder="Поиск по госномеру"
                        className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2DB0E6]/20 text-sm font-medium"
                        value={carsFilter.plate_number}
                        onChange={(e) =>
                          setCarsFilter({
                            ...carsFilter,
                            plate_number: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="flex-1 relative">
                      <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        placeholder="Поиск по ФИО водителя"
                        className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2DB0E6]/20 text-sm font-medium"
                        value={carsFilter.driver_name}
                        onChange={(e) =>
                          setCarsFilter({
                            ...carsFilter,
                            driver_name: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="w-full md:w-48 relative">
                      <Filter className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                      <select
                        className="w-full pl-10 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2DB0E6]/20 appearance-none text-sm font-medium"
                        value={carsFilter.volume}
                        onChange={(e) =>
                          setCarsFilter({
                            ...carsFilter,
                            volume: e.target.value,
                          })
                        }
                      >
                        <option value="all">Все кубатуры</option>
                        <option value="5">5 м³</option>
                        <option value="10">10 м³</option>
                        <option value="17">17 м³</option>
                        <option value="20">20 м³</option>
                        <option value="25">25 м³</option>
                        <option value="30">30 м³</option>
                        <option value="40">40 м³</option>
                      </select>
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="M19 9l-7 7-7-7"
                          ></path>
                        </svg>
                      </div>
                    </div>
                    <div className="w-full md:w-48 relative">
                      <Filter className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                      <select
                        className="w-full pl-10 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2DB0E6]/20 appearance-none text-sm font-medium"
                        value={carsFilter.status}
                        onChange={(e) =>
                          setCarsFilter({
                            ...carsFilter,
                            status: e.target.value,
                          })
                        }
                      >
                        <option value="all">Все статусы</option>
                        <option value="available">Свободен</option>
                        <option value="busy">Занят</option>
                        <option value="offline">Недоступен</option>
                        <option value="blocked">Заблокирован</option>
                      </select>
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="M19 9l-7 7-7-7"
                          ></path>
                        </svg>
                      </div>
                    </div>
                  </div>

                  {/* Table (Desktop) */}
                  <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden hidden md:block">
                    {isLoadingCars ? (
                      <div className="flex justify-center p-20">
                        <Loader2 className="w-10 h-10 animate-spin text-[#2DB0E6]" />
                      </div>
                    ) : (
                      <div className="overflow-x-auto w-full">
                        <table className="w-full text-left border-collapse min-w-[800px]">
                          <thead>
                            <tr className="bg-slate-50 border-b border-slate-100 text-xs uppercase tracking-wider font-bold text-slate-500">
                              <th className="px-6 py-4">Фото</th>
                              <th className="px-6 py-4">Госномер</th>
                              <th className="px-6 py-4">Водитель</th>
                              <th className="px-6 py-4">Тип / Кубатура</th>
                              <th className="px-6 py-4">Статус</th>
                              <th className="px-6 py-4 text-right">Действия</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100/80">
                            {cars.map((car) => (
                              <tr
                                key={car.id}
                                className="hover:bg-slate-50/50 transition-colors"
                              >
                                <td className="px-6 py-4">
                                  {car.photo_url ? (
                                    <img
                                      src={car.photo_url}
                                      alt={car.plate_number}
                                      className="w-16 h-12 object-cover rounded-md border border-slate-200"
                                    />
                                  ) : (
                                    <div className="w-16 h-12 rounded-md bg-slate-100 flex items-center justify-center text-slate-300">
                                      <ImageIcon className="w-5 h-5" />
                                    </div>
                                  )}
                                </td>
                                <td className="px-6 py-4">
                                  <div className="flex items-center">
                                    <div className="border border-slate-300 rounded flex overflow-hidden bg-white shadow-sm font-mono font-bold text-slate-800 h-[30px] items-center">
                                      <div className="px-2">
                                        {car.plate_number?.substring(0, 6) ||
                                          "X000XX"}
                                      </div>
                                      <div className="border-l border-slate-300 px-1.5 flex flex-col items-center justify-center bg-white min-w-[32px] h-full">
                                        <span className="text-[10px] leading-none mb-0.5">
                                          {car.plate_number?.substring(6) ||
                                            "77"}
                                        </span>
                                        <div className="flex items-center gap-0.5">
                                          <span className="text-[6px] leading-none font-sans">
                                            RUS
                                          </span>
                                          <div className="w-2 h-1.5 flex flex-col">
                                            <div className="h-1/3 bg-white"></div>
                                            <div className="h-1/3 bg-blue-600"></div>
                                            <div className="h-1/3 bg-red-600"></div>
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                </td>
                                <td className="px-6 py-4">
                                  <div className="font-semibold text-slate-800">
                                    {car.driver?.name || "Неизвестно"}
                                  </div>
                                  <div className="text-xs text-slate-500">
                                    {car.driver?.phone || ""}
                                  </div>
                                </td>
                                <td className="px-6 py-4">
                                  <div className="font-semibold text-slate-800">
                                    {car.car_type || "Не указан"}
                                  </div>
                                  <div className="text-sm font-medium text-slate-500">
                                    {car.volume} м³
                                  </div>
                                </td>
                                <td className="px-6 py-4">
                                  {getDriverStatusBadge(car.driver, car.status)}
                                </td>
                                <td className="px-6 py-4 text-right">
                                  <button
                                    onClick={() => {
                                      setSelectedHistoryDriverId(
                                        car.driver?.id || null,
                                      );
                                      setSelectedHistoryDriverName(
                                        car.driver?.name || "",
                                      );
                                      setIsOrderHistoryModalOpen(true);
                                    }}
                                    className="p-2 text-slate-400 hover:text-[#2DB0E6] hover:bg-[#2DB0E6]/10 rounded-lg transition-colors"
                                    title="История заказов"
                                  >
                                    <Clock className="w-5 h-5" />
                                  </button>
                                </td>
                              </tr>
                            ))}
                            {cars.length === 0 && (
                              <tr>
                                <td
                                  colSpan={6}
                                  className="px-6 py-12 text-center"
                                >
                                  <Truck className="w-12 h-12 text-slate-200 mx-auto mb-3" />
                                  <div className="text-slate-500 font-medium">
                                    Машины не найдены
                                  </div>
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* Cards (Mobile) */}
                  <div className="flex flex-col gap-4 md:hidden">
                    {isLoadingCars ? (
                      <div className="flex justify-center p-20 bg-white rounded-2xl shadow-sm border border-slate-100">
                        <Loader2 className="w-10 h-10 animate-spin text-[#2DB0E6]" />
                      </div>
                    ) : (
                      <>
                        {cars.map((car) => (
                          <div
                            key={car.id}
                            className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm flex flex-col gap-3"
                          >
                            <div className="flex justify-between items-start">
                              <div className="flex gap-3">
                                {car.photo_url ? (
                                  <img
                                    src={car.photo_url}
                                    alt={car.plate_number}
                                    className="w-16 h-12 object-cover rounded-lg border border-slate-200"
                                  />
                                ) : (
                                  <div className="w-16 h-12 rounded-lg bg-slate-100 flex items-center justify-center text-slate-300">
                                    <ImageIcon className="w-5 h-5" />
                                  </div>
                                )}
                                <div className="flex flex-col">
                                  <div className="flex items-center">
                                    <div className="border border-slate-300 rounded flex overflow-hidden bg-white shadow-sm font-mono font-bold text-slate-800 h-[28px] items-center text-sm">
                                      <div className="px-1.5">
                                        {car.plate_number?.substring(0, 6) ||
                                          "X000XX"}
                                      </div>
                                      <div className="border-l border-slate-300 px-1 flex flex-col items-center justify-center bg-white min-w-[28px] h-full">
                                        <span className="text-[9px] leading-none mb-0.5">
                                          {car.plate_number?.substring(6) ||
                                            "77"}
                                        </span>
                                        <div className="flex items-center gap-0.5">
                                          <span className="text-[5px] leading-none font-sans">
                                            RUS
                                          </span>
                                          <div className="w-1.5 h-1 flex flex-col">
                                            <div className="h-1/3 bg-white"></div>
                                            <div className="h-1/3 bg-blue-600"></div>
                                            <div className="h-1/3 bg-red-600"></div>
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                              <div>
                                {getDriverStatusBadge(car.driver, car.status)}
                              </div>
                            </div>
                            <div className="flex flex-col gap-1">
                              <div className="text-sm">
                                <span className="text-slate-500">
                                  Водитель:
                                </span>{" "}
                                <span className="font-bold text-slate-800">
                                  {car.driver?.name || "Неизвестно"}
                                </span>
                              </div>
                              <div className="text-xs text-slate-500">
                                {car.driver?.phone || "Телефон не указан"}
                              </div>
                              <div className="text-sm mt-1">
                                <span className="text-slate-500">Тип:</span>{" "}
                                <span className="font-medium text-slate-800">
                                  {car.car_type || "Не указан"} / {car.volume}{" "}
                                  м³
                                </span>
                              </div>
                            </div>
                            <button
                              onClick={() => {
                                setSelectedHistoryDriverId(
                                  car.driver?.id || null,
                                );
                                setSelectedHistoryDriverName(
                                  car.driver?.name || "",
                                );
                                setIsOrderHistoryModalOpen(true);
                              }}
                              className="w-full h-10 bg-gray-50 text-gray-700 rounded-lg flex items-center justify-center font-medium text-sm hover:bg-gray-100 transition-colors"
                            >
                              <Clock className="w-4 h-4 mr-2" />
                              История заказов
                            </button>
                          </div>
                        ))}
                        {cars.length === 0 && (
                          <div className="p-8 text-center text-slate-500 font-medium bg-white rounded-2xl shadow-sm border border-slate-100">
                            Машины не найдены
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </>
              ) : (
                <>
                  {/* Delivery Options Tab */}
                  <div className="flex justify-between items-center bg-white p-5 rounded-2xl shadow-sm border border-slate-100 mb-2">
                    <h2 className="text-xl font-bold text-slate-800">
                      Типы автомобилей
                    </h2>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => fetchDeliveryOptions()}
                        className="text-sm font-semibold text-slate-500 hover:text-slate-700 transition-colors"
                      >
                        Обновить
                      </button>
                      <button
                        onClick={() => openDeliveryModal()}
                        className="flex items-center gap-2 bg-[#2DB0E6] text-white px-4 py-2 rounded-xl font-semibold hover:bg-[#209ccf] transition-colors shadow-sm"
                      >
                        <Plus className="w-4 h-4" />
                        <span className="hidden sm:inline">Добавить</span>
                      </button>
                    </div>
                  </div>

                  {isLoading ? (
                    <div className="flex justify-center p-20">
                      <Loader2 className="w-10 h-10 animate-spin text-[#2DB0E6]" />
                    </div>
                  ) : (
                    <div className="bg-transparent md:bg-white md:rounded-2xl md:shadow-sm md:border border-transparent md:border-slate-100 overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="hidden md:table w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-slate-50 border-b border-slate-100 text-xs uppercase tracking-wider font-bold text-slate-500">
                              <th className="px-6 py-4">ID</th>
                              <th className="px-6 py-4">Фото</th>
                              <th className="px-6 py-4">Название</th>
                              <th className="px-6 py-4">Кубатура (м³)</th>
                              <th className="px-6 py-4">Минималка с карьера</th>
                              <th className="px-6 py-4">Минималка с накопителя</th>
                              <th className="px-6 py-4">Ставка за км</th>
                              <th className="px-6 py-4">Статус</th>
                              <th className="px-6 py-4 text-right">Действия</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100/80">
                            {sortedDeliveryOptions.map((opt) => {
                              const imgUrl =
                                opt.primary_image_url ||
                                opt.image_url ||
                                opt.media_files?.[0]?.public_url;
                              return (
                                <tr
                                  key={opt.id}
                                  className="hover:bg-slate-50/50 transition-colors"
                                >
                                  <td className="px-6 py-4 text-xs font-mono text-slate-400">
                                    {opt.id.substring(0, 8)}
                                  </td>
                                  <td className="px-6 py-4">
                                    {imgUrl ? (
                                      <img
                                        src={imgUrl}
                                        alt={opt.title}
                                        className="w-28 h-20 object-contain rounded-lg border border-slate-200 bg-slate-50 p-1"
                                      />
                                    ) : (
                                      <div className="w-28 h-20 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center text-slate-300">
                                        <ImageIcon className="w-7 h-7" />
                                      </div>
                                    )}
                                  </td>
                                  <td className="px-6 py-4 font-semibold text-slate-800">
                                    {opt.title}
                                  </td>
                                  <td className="px-6 py-4 text-sm font-medium">
                                    {opt.capacity_m3} м³
                                  </td>
                                  <td className="px-6 py-4 text-sm font-medium">
                                    {opt.min_price_quarry ?? 5000} ₽
                                  </td>
                                  <td className="px-6 py-4 text-sm font-medium">
                                    {opt.min_price_warehouse ?? 3000} ₽
                                  </td>
                                  <td className="px-6 py-4 text-sm font-medium whitespace-nowrap">
                                    {opt.delivery_rate_per_km
                                      ? opt.delivery_rate_per_km + " ₽/км"
                                      : "Не задана"}
                                  </td>
                                  <td className="px-6 py-4">
                                    {opt.is_active === false ? (
                                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-amber-100 text-amber-800 text-[11px] font-bold uppercase tracking-wider whitespace-nowrap">
                                        <XCircle className="w-3 h-3" />{" "}
                                        Неактивен
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-50 text-emerald-700 text-[11px] font-bold uppercase tracking-wider whitespace-nowrap">
                                        <CheckCircle2 className="w-3 h-3" />{" "}
                                        Активен
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-6 py-4 text-right flex justify-end gap-2">
                                    <button
                                      onClick={() => openDeliveryModal(opt)}
                                      className="p-2 text-slate-400 hover:text-[#2DB0E6] bg-slate-50 hover:bg-[#2DB0E6]/10 rounded-lg transition-colors border border-transparent"
                                    >
                                      <Edit2 className="w-4 h-4" />
                                    </button>
                                    <button
                                      onClick={() =>
                                        setItemToDelete({
                                          id: opt.id,
                                          type: "delivery",
                                        })
                                      }
                                      className="p-2 text-slate-400 hover:text-red-600 bg-slate-50 hover:bg-red-50 rounded-lg transition-colors border border-transparent"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      <div className="grid grid-cols-1 gap-4 md:hidden">
                        {sortedDeliveryOptions.map((opt) => {
                          const imgUrl =
                            opt.primary_image_url ||
                            opt.image_url ||
                            opt.media_files?.[0]?.public_url;
                          return (
                            <div
                              key={opt.id}
                              className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 flex flex-col gap-3 relative"
                            >
                              <div className="flex justify-between items-center mb-1">
                                <span className="text-xs font-mono text-slate-400">
                                  ID: {opt.id.substring(0, 8)}
                                </span>
                                <div className="flex gap-2 -mt-2 -mr-2">
                                  <button
                                    onClick={() => openDeliveryModal(opt)}
                                    className="p-2 text-slate-400 hover:text-[#2DB0E6] bg-slate-50 hover:bg-[#2DB0E6]/10 rounded-lg transition-colors border border-transparent"
                                  >
                                    <Edit2 className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() =>
                                      setItemToDelete({
                                        id: opt.id,
                                        type: "delivery",
                                      })
                                    }
                                    className="p-2 text-slate-400 hover:text-red-600 bg-slate-50 hover:bg-red-50 rounded-lg transition-colors border border-transparent"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>

                              <div className="flex gap-4 items-start">
                                {imgUrl ? (
                                  <img
                                    src={imgUrl}
                                    alt={opt.title}
                                    className="shrink-0 w-28 h-20 object-contain rounded-lg border border-slate-200 bg-slate-50 p-1"
                                  />
                                ) : (
                                  <div className="shrink-0 w-28 h-20 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center text-slate-300">
                                    <ImageIcon className="w-7 h-7" />
                                  </div>
                                )}
                                <div className="flex flex-col gap-1 min-w-0">
                                  <h3 className="font-bold text-slate-800 text-base truncate pr-2">
                                    {opt.title}
                                  </h3>
                                  <div className="flex flex-col gap-0.5 mt-1">
                                    <span className="text-sm font-medium text-slate-700">
                                      Кубатура: {opt.capacity_m3} м³
                                    </span>
                                    <span className="text-sm text-slate-500">
                                      Минималка с карьера: {opt.min_price_quarry ?? 5000} ₽
                                    </span>
                                    <span className="text-sm text-slate-500">
                                      Минималка с накопителя: {opt.min_price_warehouse ?? 3000} ₽
                                    </span>
                                    <span className="text-sm text-slate-500">
                                      Ставка за км:{" "}
                                      {opt.delivery_rate_per_km
                                        ? opt.delivery_rate_per_km + " ₽/км"
                                        : "Не задана"}
                                    </span>
                                  </div>
                                </div>
                              </div>

                              <div className="mt-2 flex justify-start">
                                {opt.is_active === false ? (
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-amber-100 text-amber-800 text-[11px] font-bold uppercase tracking-wider whitespace-nowrap">
                                    <XCircle className="w-3 h-3" /> Неактивен
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-50 text-emerald-700 text-[11px] font-bold uppercase tracking-wider whitespace-nowrap">
                                    <CheckCircle2 className="w-3 h-3" /> Активен
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {deliveryOptions.length === 0 && (
                        <div className="p-8 text-center text-slate-500 font-medium">
                          Нет типов авто
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          ) : activeTab === "drivers" ? (
            <>
              {/* Drivers Tab */}
              <div className="flex justify-between items-center bg-white p-5 rounded-2xl shadow-sm border border-slate-100 mb-2">
                <h2 className="text-xl font-bold text-slate-800">Водители</h2>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => fetchDrivers()}
                    className="text-sm font-semibold text-slate-500 hover:text-slate-700 transition-colors"
                  >
                    Обновить
                  </button>
                  <button
                    onClick={() => openDriverModal()}
                    className="flex items-center gap-2 bg-[#2DB0E6] text-white px-4 py-2 rounded-xl font-semibold hover:bg-[#209ccf] transition-colors shadow-sm"
                  >
                    <Plus className="w-4 h-4" />
                    <span className="hidden sm:inline">Добавить</span>
                  </button>
                </div>
              </div>

              {isLoading ? (
                <div className="flex justify-center p-20">
                  <Loader2 className="w-10 h-10 animate-spin text-[#2DB0E6]" />
                </div>
              ) : (
                <div className="bg-transparent md:bg-white md:rounded-2xl md:shadow-sm md:border border-transparent md:border-slate-100 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="hidden md:table w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-100 text-xs uppercase tracking-wider font-bold text-slate-500">
                          <th className="px-6 py-4">ID</th>
                          <th className="px-6 py-4">Имя</th>
                          <th className="px-6 py-4">Телефон</th>
                          <th className="px-6 py-4">Автомобиль</th>
                          <th className="px-6 py-4">Статус (Акт.)</th>
                          <th className="px-6 py-4">Модерация</th>
                          <th className="px-6 py-4 text-right">Действия</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100/80">
                        {drivers.map((d) => (
                          <tr
                            key={d.id}
                            className="hover:bg-slate-50/50 transition-colors"
                          >
                            <td className="px-6 py-4 text-xs font-mono text-slate-400">
                              {d.id.substring(0, 8)}
                            </td>
                            <td className="px-6 py-4 font-semibold text-slate-800">
                              {d.name}
                            </td>
                            <td className="px-6 py-4 text-sm whitespace-nowrap">
                              {d.phone}
                            </td>
                            <td className="px-6 py-4 text-sm text-slate-500">
                              <div className="flex flex-col gap-2">
                                {renderVehicleCell(d)}
                                {d.moderation_status === "pending_moderation" &&
                                  d.media_files &&
                                  d.media_files.length > 0 && (
                                    <div className="flex gap-2 mt-1">
                                      {d.media_files.map((mf) => (
                                        <a
                                          key={mf.id}
                                          href={mf.public_url}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="block w-12 h-12 rounded-lg border border-slate-200 overflow-hidden hover:opacity-80"
                                        >
                                          <img
                                            src={mf.public_url}
                                            alt={mf.slot_key}
                                            className="w-full h-full object-cover"
                                          />
                                        </a>
                                      ))}
                                    </div>
                                  )}
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              {d.is_active === false ? (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-amber-100 text-amber-800 text-[11px] font-bold uppercase tracking-wider whitespace-nowrap">
                                  <XCircle className="w-3 h-3" /> Неактивен
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-50 text-emerald-700 text-[11px] font-bold uppercase tracking-wider whitespace-nowrap">
                                  <CheckCircle2 className="w-3 h-3" /> Активен
                                </span>
                              )}
                            </td>
                            <td className="px-6 py-4">
                              {d.moderation_status === "approved" ? (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-50 text-emerald-700 text-xs font-bold uppercase tracking-wider whitespace-nowrap">
                                  <CheckCircle2 className="w-3 h-3" /> Одобрен
                                </span>
                              ) : d.moderation_status ===
                                "pending_moderation" ? (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-amber-50 text-amber-700 text-xs font-bold uppercase tracking-wider whitespace-nowrap">
                                  На проверке
                                </span>
                              ) : d.moderation_status === "rejected" ? (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-rose-50 text-rose-700 text-xs font-bold uppercase tracking-wider whitespace-nowrap">
                                  <XCircle className="w-3 h-3" /> Отклонен
                                </span>
                              ) : d.moderation_status === "suspended" ? (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-100 text-slate-500 text-xs font-bold uppercase tracking-wider whitespace-nowrap">
                                  <Lock className="w-3 h-3" /> Заблокирован
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-100 text-slate-500 text-xs font-bold uppercase tracking-wider whitespace-nowrap">
                                  Неизвестно
                                </span>
                              )}
                            </td>
                            <td className="px-6 py-4 text-right flex justify-end gap-2">
                              {d.moderation_status !== "approved" && (
                                <button
                                  onClick={() => handleApproveDriver(d.id)}
                                  title="Одобрить профиль"
                                  className="p-2 text-slate-400 hover:text-emerald-600 bg-slate-50 hover:bg-emerald-50 rounded-lg transition-colors border border-transparent"
                                >
                                  <CheckCircle2 className="w-4 h-4" />
                                </button>
                              )}
                              {d.moderation_status !== "rejected" && (
                                <button
                                  onClick={() => handleRejectDriver(d.id)}
                                  title="Отклонить"
                                  className="p-2 text-slate-400 hover:text-rose-600 bg-slate-50 hover:bg-rose-50 rounded-lg transition-colors border border-transparent"
                                >
                                  <XCircle className="w-4 h-4" />
                                </button>
                              )}
                              {d.moderation_status !== "suspended" && (
                                <button
                                  onClick={() => handleSuspendDriver(d.id)}
                                  title="Заблокировать"
                                  className="p-2 text-slate-400 hover:text-amber-600 bg-slate-50 hover:bg-amber-50 rounded-lg transition-colors border border-transparent"
                                >
                                  <Lock className="w-4 h-4" />
                                </button>
                              )}
                              <button
                                onClick={() => openDriverModal(d)}
                                className="p-2 text-slate-400 hover:text-[#2DB0E6] bg-slate-50 hover:bg-[#2DB0E6]/10 rounded-lg transition-colors border border-transparent"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() =>
                                  setItemToDelete({ id: d.id, type: "driver" })
                                }
                                className="p-2 text-slate-400 hover:text-red-600 bg-slate-50 hover:bg-red-50 rounded-lg transition-colors border border-transparent"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:hidden">
                    {drivers.map((d) => (
                      <div
                        key={d.id}
                        className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 flex flex-col gap-3 relative"
                      >
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-xs font-mono text-slate-400">
                            ID: {d.id.substring(0, 8)}
                          </span>
                          <div className="flex gap-2 -mt-2 -mr-2">
                            <button
                              onClick={() => openDriverModal(d)}
                              className="p-2 text-slate-400 hover:text-[#2DB0E6] bg-slate-50 hover:bg-[#2DB0E6]/10 rounded-lg transition-colors border border-transparent"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() =>
                                setItemToDelete({ id: d.id, type: "driver" })
                              }
                              className="p-2 text-slate-400 hover:text-red-600 bg-slate-50 hover:bg-red-50 rounded-lg transition-colors border border-transparent"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        <div className="flex flex-col gap-1 min-w-0">
                          <h3 className="font-bold text-slate-800 text-base truncate pr-2">
                            {d.name}
                          </h3>
                          <div className="flex flex-col gap-0.5 mt-1">
                            <span className="text-sm font-medium text-slate-700">
                              Телефон: {d.phone}
                            </span>
                            <div className="flex flex-col gap-2 mt-1">
                              {renderVehicleCell(d)}
                              {d.moderation_status === "pending_moderation" &&
                                d.media_files &&
                                d.media_files.length > 0 && (
                                  <div className="flex gap-2 mt-2">
                                    {d.media_files.map((mf) => (
                                      <a
                                        key={mf.id}
                                        href={mf.public_url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="block w-14 h-14 rounded-lg border border-slate-200 overflow-hidden hover:opacity-80"
                                      >
                                        <img
                                          src={mf.public_url}
                                          alt={mf.slot_key}
                                          className="w-full h-full object-cover"
                                        />
                                      </a>
                                    ))}
                                  </div>
                                )}
                            </div>
                            {d.moderation_status === "pending_moderation" && (
                              <span className="text-sm font-bold text-amber-600 mt-1">
                                На проверке
                              </span>
                            )}
                            {d.moderation_status === "rejected" && (
                              <span className="text-sm font-bold text-rose-600 mt-1">
                                Отклонен
                              </span>
                            )}
                            {d.moderation_status === "suspended" && (
                              <span className="text-sm font-bold text-slate-500 mt-1">
                                Заблокирован
                              </span>
                            )}
                            {d.moderation_status === "approved" && (
                              <span className="text-sm font-bold text-emerald-600 mt-1">
                                Одобрен
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="mt-2 flex justify-between items-center">
                          <div className="flex justify-start">
                            {d.is_active === false ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-amber-100 text-amber-800 text-[11px] font-bold uppercase tracking-wider whitespace-nowrap">
                                <XCircle className="w-3 h-3" /> Неактивен
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-50 text-emerald-700 text-[11px] font-bold uppercase tracking-wider whitespace-nowrap">
                                <CheckCircle2 className="w-3 h-3" /> Активен
                              </span>
                            )}
                          </div>
                          <div className="flex gap-2">
                            {d.moderation_status !== "approved" && (
                              <button
                                onClick={() => handleApproveDriver(d.id)}
                                title="Одобрить профиль"
                                className="p-2 text-emerald-600 bg-emerald-50 rounded-lg transition-colors border border-transparent"
                              >
                                <CheckCircle2 className="w-4 h-4" />
                              </button>
                            )}
                            {d.moderation_status !== "rejected" && (
                              <button
                                onClick={() => handleRejectDriver(d.id)}
                                title="Отклонить"
                                className="p-2 text-rose-600 bg-rose-50 rounded-lg transition-colors border border-transparent"
                              >
                                <XCircle className="w-4 h-4" />
                              </button>
                            )}
                            {d.moderation_status !== "suspended" && (
                              <button
                                onClick={() => handleSuspendDriver(d.id)}
                                title="Заблокировать"
                                className="p-2 text-amber-600 bg-amber-50 rounded-lg transition-colors border border-transparent"
                              >
                                <Lock className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {drivers.length === 0 && (
                    <div className="p-8 text-center text-slate-500 font-medium">
                      Нет водителей
                    </div>
                  )}
                </div>
              )}
            </>
          ) : activeTab === "moderation" ? (
            <>
              <div className="flex justify-between items-center bg-white p-5 rounded-2xl shadow-sm border border-slate-100 mb-2">
                <h2 className="text-xl font-bold text-slate-800">
                  Заявки на модерацию
                </h2>
                <button
                  onClick={() => fetchPendingRequests(false)}
                  className="flex items-center gap-2 px-4 py-2 bg-slate-50 text-slate-600 rounded-lg hover:bg-slate-100 transition-colors font-medium text-sm border border-slate-200"
                >
                  <RefreshCw className="w-4 h-4" />
                  Обновить
                </button>
              </div>

              {isLoadingModeration ? (
                <div className="flex justify-center p-10 bg-white rounded-2xl border border-slate-100">
                  <Loader2 className="w-8 h-8 animate-spin text-[#2DB0E6]" />
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {pendingRequests.length === 0 ? (
                    <div className="p-12 text-center bg-white rounded-2xl shadow-sm border border-slate-100 flex flex-col items-center gap-3">
                      <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center">
                        <ClipboardCheck className="w-8 h-8 text-slate-300" />
                      </div>
                      <p className="text-slate-500 font-medium text-lg">
                        Нет новых заявок на модерацию
                      </p>
                    </div>
                  ) : (
                    pendingRequests.map((request) => (
                      <div
                        key={request.driver_id}
                        className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 flex flex-col gap-5"
                      >
                        <div className="flex flex-col md:flex-row gap-6 md:gap-10">
                          {/* Driver Info */}
                          <div className="flex-1 space-y-4">
                            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-3">
                              <div className="w-10 h-10 rounded-full bg-[#2DB0E6]/10 flex items-center justify-center flex-shrink-0">
                                <Truck className="w-5 h-5 text-[#2DB0E6]" />
                              </div>
                              {request.driver_name}
                            </h3>
                            <div className="flex flex-col gap-2 text-sm text-slate-600 pl-13">
                              <div className="flex justify-between border-b border-slate-50 pb-2">
                                <span className="font-medium text-slate-400">
                                  Телефон
                                </span>
                                <span className="font-semibold text-slate-700">
                                  {request.driver_phone}
                                </span>
                              </div>
                              <div className="flex justify-between border-b border-slate-50 pb-2">
                                <span className="font-medium text-slate-400">
                                  Марка/Модель
                                </span>
                                <span className="font-semibold text-slate-700">
                                  {request.vehicle_brand}{" "}
                                  {request.vehicle_model}
                                </span>
                              </div>
                              <div className="flex justify-between items-center border-b border-slate-50 pb-2">
                                <span className="font-medium text-slate-400">
                                  Госномер
                                </span>
                                {request.vehicle_plate_number ? (
                                  <div className="flex items-stretch bg-white border border-gray-400 rounded-md shadow-sm h-7 overflow-hidden">
                                    <div className="flex items-center px-2 text-sm font-bold uppercase tracking-wider text-slate-900 leading-none pt-0.5">
                                      {request.vehicle_plate_number}
                                    </div>
                                    <div className="flex flex-col items-center justify-center border-l border-gray-400 bg-white h-full px-1.5 py-0.5">
                                      <span className="text-[7px] font-bold leading-none text-slate-800 mb-0.5">
                                        RUS
                                      </span>
                                      <svg
                                        className="w-4 h-3 rounded-[1px] block"
                                        xmlns="http://www.w3.org/2000/svg"
                                        viewBox="0 0 9 6"
                                      >
                                        <rect
                                          fill="#fff"
                                          width="9"
                                          height="2"
                                        />
                                        <rect
                                          fill="#0039a6"
                                          y="2"
                                          width="9"
                                          height="2"
                                        />
                                        <rect
                                          fill="#d52b1e"
                                          y="4"
                                          width="9"
                                          height="2"
                                        />
                                      </svg>
                                    </div>
                                  </div>
                                ) : (
                                  <span className="font-mono font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                                    Нет
                                  </span>
                                )}
                              </div>
                              <div className="flex justify-between border-b border-slate-50 pb-2 pt-2">
                                <span className="font-medium text-slate-400">
                                  Кубатура (м³)
                                </span>
                                <span className="font-semibold text-slate-700">
                                  {(() => {
                                    const min = request.vehicle_cubature_min;
                                    const max = request.vehicle_cubature_max;
                                    const fallback =
                                      request.vehicle_body_volume_m3;
                                    if (
                                      min !== undefined &&
                                      max !== undefined &&
                                      min !== null &&
                                      max !== null
                                    ) {
                                      return min === max
                                        ? `${min}`
                                        : `${min} - ${max}`;
                                    }
                                    if (min !== undefined && min !== null)
                                      return `${min}`;
                                    if (max !== undefined && max !== null)
                                      return `${max}`;
                                    return fallback ? `${fallback}` : "—";
                                  })()}
                                </span>
                              </div>
                              <div className="flex justify-between border-b border-slate-50 pb-2">
                                <span className="font-medium text-slate-400">
                                  Тоннаж (т)
                                </span>
                                <span className="font-semibold text-slate-700">
                                  {(() => {
                                    const min = request.vehicle_tonnage_min;
                                    const max = request.vehicle_tonnage_max;
                                    if (
                                      min !== undefined &&
                                      max !== undefined &&
                                      min !== null &&
                                      max !== null
                                    ) {
                                      return min === max
                                        ? `${min}`
                                        : `${min} - ${max}`;
                                    }
                                    if (min !== undefined && min !== null)
                                      return `${min}`;
                                    if (max !== undefined && max !== null)
                                      return `${max}`;
                                    return "—";
                                  })()}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Photos Info */}
                          <div className="flex-[1.5] flex flex-col gap-3">
                            <span className="text-sm font-bold text-slate-700 uppercase tracking-wider">
                              Фотографии автомобиля
                            </span>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-2">
                              {/* Основное фото / Спереди */}
                              <div className="flex flex-col gap-2">
                                {request.vehicle_main_url ? (
                                  <a
                                    href={request.vehicle_main_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="block relative group rounded-xl overflow-hidden h-48 sm:h-56 border border-slate-200"
                                  >
                                    <img
                                      src={request.vehicle_main_url}
                                      alt="Спереди"
                                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                                    />
                                    <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                      <Eye className="w-8 h-8 text-white" />
                                    </div>
                                  </a>
                                ) : (
                                  <div className="h-48 sm:h-56 bg-slate-100 rounded-xl flex items-center justify-center border border-slate-200">
                                    <span className="text-sm font-medium text-slate-400">
                                      Фото не загружено
                                    </span>
                                  </div>
                                )}
                                <span className="text-xs font-bold text-center text-slate-600">
                                  Спереди
                                </span>
                              </div>

                              {/* Сбоку / Слева */}
                              <div className="flex flex-col gap-2">
                                {request.vehicle_left_url ? (
                                  <a
                                    href={request.vehicle_left_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="block relative group rounded-xl overflow-hidden h-48 sm:h-56 border border-slate-200"
                                  >
                                    <img
                                      src={request.vehicle_left_url}
                                      alt="Сбоку"
                                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                                    />
                                    <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                      <Eye className="w-8 h-8 text-white" />
                                    </div>
                                  </a>
                                ) : (
                                  <div className="h-48 sm:h-56 bg-slate-100 rounded-xl flex items-center justify-center border border-slate-200">
                                    <span className="text-sm font-medium text-slate-400">
                                      Фото не загружено
                                    </span>
                                  </div>
                                )}
                                <span className="text-xs font-bold text-center text-slate-600">
                                  Сбоку
                                </span>
                              </div>

                              {/* Номер / Plate */}
                              <div className="flex flex-col gap-2">
                                {request.vehicle_plate_url ? (
                                  <a
                                    href={request.vehicle_plate_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="block relative group rounded-xl overflow-hidden h-48 sm:h-56 border border-slate-200"
                                  >
                                    <img
                                      src={request.vehicle_plate_url}
                                      alt="Госномер"
                                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                                    />
                                    <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                      <Eye className="w-8 h-8 text-white" />
                                    </div>
                                  </a>
                                ) : (
                                  <div className="h-48 sm:h-56 bg-slate-100 rounded-xl flex items-center justify-center border border-slate-200">
                                    <span className="text-sm font-medium text-slate-400">
                                      Фото не загружено
                                    </span>
                                  </div>
                                )}
                                <span className="text-xs font-bold text-center text-slate-600">
                                  Фото госномера
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 w-full mt-4 pt-5 border-t border-slate-100">
                          <button
                            onClick={() =>
                              handleRejectDriver(request.driver_id)
                            }
                            className="w-full sm:flex-1 py-3 px-4 bg-white hover:bg-rose-50 text-rose-600 font-bold rounded-xl transition-colors border border-rose-200 hover:border-rose-300 shadow-sm flex items-center justify-center gap-2"
                          >
                            <XCircle className="w-5 h-5" />
                            Отклонить
                          </button>
                          <button
                            onClick={() =>
                              handleApproveDriver(request.driver_id)
                            }
                            className="w-full sm:flex-1 py-3 px-4 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-xl transition-colors shadow-sm flex items-center justify-center gap-2"
                          >
                            <CheckCircle2 className="w-5 h-5" />
                            Одобрить водителя
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </>
          ) : activeTab === "quarries" ? (
            <AdminQuarriesScreen materials={materials} />
          ) : activeTab === "profile" ? (
            <AdminProfileScreen onLogout={handleLogout} />
          ) : null}
        </div>
      </div>

      {/* Mobile Bottom Navigation Menu */}
      <div className="sm:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 flex z-50 h-[68px] justify-around items-center px-2 pb-safe">
        <button
          onClick={() => setActiveTab("materials")}
          className={`flex-1 flex flex-col items-center justify-center py-2 gap-1 rounded-xl transition-all ${
            activeTab === "materials"
              ? "text-[#2DB0E6]"
              : "text-slate-400 hover:text-slate-600"
          }`}
        >
          <div
            className={`p-1.5 rounded-xl transition-colors ${activeTab === "materials" ? "bg-[#2DB0E6]/10" : ""}`}
          >
            <Layers className="w-6 h-6" />
          </div>
          <span className="text-[10px] font-bold">Каталог</span>
        </button>
        <button
          onClick={() => setActiveTab("quarries")}
          className={`flex-1 flex flex-col items-center justify-center py-2 gap-1 rounded-xl transition-all ${
            activeTab === "quarries"
              ? "text-[#2DB0E6]"
              : "text-slate-400 hover:text-slate-600"
          }`}
        >
          <div
            className={`p-1.5 rounded-xl transition-colors ${activeTab === "quarries" ? "bg-[#2DB0E6]/10" : ""}`}
          >
            <Map className="w-6 h-6" />
          </div>
          <span className="text-[10px] font-bold">Карьеры</span>
        </button>
        <button
          onClick={() => setActiveTab("delivery")}
          className={`flex-1 flex flex-col items-center justify-center py-2 gap-1 rounded-xl transition-all ${
            activeTab === "delivery"
              ? "text-[#2DB0E6]"
              : "text-slate-400 hover:text-slate-600"
          }`}
        >
          <div
            className={`p-1.5 rounded-xl transition-colors ${activeTab === "delivery" ? "bg-[#2DB0E6]/10" : ""}`}
          >
            <Truck className="w-6 h-6" />
          </div>
          <span className="text-[10px] font-bold">Автопарк</span>
        </button>
        <button
          onClick={() => setActiveTab("drivers")}
          className={`flex-1 flex flex-col items-center justify-center py-2 gap-1 rounded-xl transition-all ${
            activeTab === "drivers"
              ? "text-[#2DB0E6]"
              : "text-slate-400 hover:text-slate-600"
          }`}
        >
          <div
            className={`p-1.5 rounded-xl transition-colors ${activeTab === "drivers" ? "bg-[#2DB0E6]/10" : ""}`}
          >
            <Users className="w-6 h-6" />
          </div>
          <span className="text-[10px] font-bold">Водители</span>
        </button>
        <button
          onClick={() => setActiveTab("moderation")}
          className={`flex-1 flex flex-col items-center justify-center py-2 gap-1 rounded-xl transition-all relative ${
            activeTab === "moderation"
              ? "text-[#2DB0E6]"
              : "text-slate-400 hover:text-slate-600"
          }`}
        >
          <div
            className={`relative p-1.5 rounded-xl transition-colors ${activeTab === "moderation" ? "bg-[#2DB0E6]/10" : ""}`}
          >
            <ClipboardCheck className="w-6 h-6" />
            {drivers.filter((d) => d.moderation_status === "pending_moderation")
              .length > 0 && (
              <div className="absolute -top-1 -right-1 bg-rose-500 text-white text-[9px] font-bold w-3.5 h-3.5 rounded-full flex items-center justify-center shadow-sm">
                {
                  drivers.filter(
                    (d) => d.moderation_status === "pending_moderation",
                  ).length
                }
              </div>
            )}
          </div>
          <span className="text-[10px] font-bold">Модерация</span>
        </button>
        <button
          onClick={() => setActiveTab("profile")}
          className={`flex-1 flex flex-col items-center justify-center py-2 gap-1 rounded-xl transition-all ${
            activeTab === "profile"
              ? "text-[#2DB0E6]"
              : "text-slate-400 hover:text-slate-600"
          }`}
        >
          <div
            className={`p-1.5 rounded-xl transition-colors ${activeTab === "profile" ? "bg-[#2DB0E6]/10" : ""}`}
          >
            <User className="w-6 h-6" />
          </div>
          <span className="text-[10px] font-bold">Профиль</span>
        </button>
      </div>

      {/* Material Modal */}
      {isMaterialModalOpen && editingMaterial && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-3xl w-full max-w-xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h3 className="text-xl font-bold text-slate-800">
                {editingMaterial.id
                  ? "Редактировать материал"
                  : "Добавить материал"}
              </h3>
              <button
                onClick={() => setIsMaterialModalOpen(false)}
                className="p-2 text-slate-400 hover:bg-slate-200 hover:text-slate-600 rounded-full transition-colors"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <form
              onSubmit={handleSaveMaterial}
              className="p-6 overflow-y-auto flex flex-col gap-5"
            >
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Название
                </label>
                <input
                  type="text"
                  required
                  value={editingMaterial.name || ""}
                  onChange={(e) =>
                    setEditingMaterial({
                      ...editingMaterial,
                      name: e.target.value,
                    })
                  }
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#2DB0E6]/20 focus:border-[#2DB0E6] transition-all font-medium"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Категория
                </label>
                <select
                  required
                  value={editingMaterial.category_id || ""}
                  onChange={(event) =>
                    setEditingMaterial({
                      ...editingMaterial,
                      category_id: event.target.value,
                    })
                  }
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 font-medium outline-none focus:border-[#2DB0E6] focus:ring-2 focus:ring-[#2DB0E6]/20"
                >
                  <option value="" disabled>Выберите категорию</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}{category.is_active ? "" : " (скрыта)"}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Описание
                </label>
                <textarea
                  rows={5}
                  value={editingMaterial.description || ""}
                  onChange={(e) =>
                    setEditingMaterial({
                      ...editingMaterial,
                      description: e.target.value,
                    })
                  }
                  className="w-full min-h-[120px] bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#2DB0E6]/20 focus:border-[#2DB0E6] transition-all font-medium resize-y"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                    Цена (₽)
                  </label>
                  <input
                    type="number"
                    required
                    step="0.01"
                    min="0"
                    value={editingMaterial.price || ""}
                    onChange={(e) =>
                      setEditingMaterial({
                        ...editingMaterial,
                        price: parseFloat(e.target.value),
                      })
                    }
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#2DB0E6]/20 focus:border-[#2DB0E6] transition-all font-medium"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                    Мин. объем
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={editingMaterial.min_volume || ""}
                    onChange={(e) =>
                      setEditingMaterial({
                        ...editingMaterial,
                        min_volume: parseFloat(e.target.value),
                      })
                    }
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#2DB0E6]/20 focus:border-[#2DB0E6] transition-all font-medium"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Ед. измерения
                </label>
                <input
                  type="text"
                  value={editingMaterial.unit || ""}
                  onChange={(e) =>
                    setEditingMaterial({
                      ...editingMaterial,
                      unit: e.target.value,
                    })
                  }
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#2DB0E6]/20 focus:border-[#2DB0E6] transition-all font-medium"
                />
              </div>

              <div className="flex flex-col gap-2 pt-2">
                <span className="text-sm font-bold text-slate-800">
                  Фотографии
                </span>
                {editingMaterial.id ? (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {renderPhotoSlot(
                      "material",
                      editingMaterial.id,
                      "career",
                      "Карьер",
                      editingMaterial.media_files,
                    )}
                    {renderPhotoSlot(
                      "material",
                      editingMaterial.id,
                      "unload",
                      "Выгрузка",
                      editingMaterial.media_files,
                    )}
                    {renderPhotoSlot(
                      "material",
                      editingMaterial.id,
                      "texture",
                      "Текстура",
                      editingMaterial.media_files,
                    )}
                  </div>
                ) : (
                  <div className="bg-amber-50 border border-amber-200 text-amber-700 p-3 rounded-xl text-sm font-medium">
                    Для загрузки фотографий сначала сохраните материал.
                  </div>
                )}
              </div>

              <label className="flex items-center gap-3 p-4 bg-slate-50 rounded-xl border border-slate-100 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editingMaterial.is_active !== false}
                  onChange={(e) =>
                    setEditingMaterial({
                      ...editingMaterial,
                      is_active: e.target.checked,
                    })
                  }
                  className="w-5 h-5 rounded text-[#2DB0E6] focus:ring-[#2DB0E6] border-slate-300 cursor-pointer"
                />
                <div className="flex flex-col">
                  <span className="font-bold text-slate-800 text-sm">
                    Материал активен
                  </span>
                  <span className="text-xs text-slate-500 font-medium">
                    Отображать этот материал в каталоге
                  </span>
                </div>
              </label>

              <div className="flex gap-3 pt-4 border-t border-slate-100 mt-2">
                <button
                  type="button"
                  onClick={() => setIsMaterialModalOpen(false)}
                  className="flex-1 py-3 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition-colors"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={isSavingMaterial}
                  className="flex-1 py-3 px-4 bg-[#2DB0E6] hover:bg-[#209ccf] text-white font-bold rounded-xl transition-colors flex justify-center items-center gap-2 shadow-sm"
                >
                  {isSavingMaterial ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    "Сохранить"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delivery Option Modal */}
      {isDeliveryModalOpen && editingDelivery && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-3xl w-full max-w-xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h3 className="text-xl font-bold text-slate-800">
                {editingDelivery.id
                  ? "Редактировать тип машины"
                  : "Добавить тип машины"}
              </h3>
              <button
                onClick={() => setIsDeliveryModalOpen(false)}
                className="p-2 text-slate-400 hover:bg-slate-200 hover:text-slate-600 rounded-full transition-colors"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <form
              onSubmit={handleSaveDelivery}
              className="p-6 overflow-y-auto flex flex-col gap-5"
            >
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Марка машины (например: Volvo, КамАЗ)
                </label>
                <input
                  type="text"
                  required
                  value={editingDelivery.title || ""}
                  onChange={(e) =>
                    setEditingDelivery({
                      ...editingDelivery,
                      title: e.target.value,
                    })
                  }
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#2DB0E6]/20 focus:border-[#2DB0E6] transition-all font-medium"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                    Объем (м³)
                  </label>
                  <input
                    type="number"
                    required
                    step="0.1"
                    min="0"
                    value={editingDelivery.capacity_m3 ?? ""}
                    onChange={(e) =>
                      setEditingDelivery({
                        ...editingDelivery,
                        capacity_m3: parseFloat(e.target.value),
                      })
                    }
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#2DB0E6]/20 focus:border-[#2DB0E6] transition-all font-medium"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                    Ставка за 1 км (₽)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="Например, 95"
                    value={editingDelivery.delivery_rate_per_km ?? ""}
                    onChange={(e) =>
                      setEditingDelivery({
                        ...editingDelivery,
                        delivery_rate_per_km: e.target.value
                          ? parseFloat(e.target.value)
                          : undefined,
                      })
                    }
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#2DB0E6]/20 focus:border-[#2DB0E6] transition-all font-medium"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                    Минималка с карьера (₽)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="Например, 5000"
                    value={editingDelivery.min_price_quarry ?? ""}
                    onChange={(e) =>
                      setEditingDelivery({
                        ...editingDelivery,
                        min_price_quarry: e.target.value
                          ? parseFloat(e.target.value)
                          : undefined,
                      })
                    }
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#2DB0E6]/20 focus:border-[#2DB0E6] transition-all font-medium"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                    Минималка с накопителя (₽)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="Например, 3000"
                    value={editingDelivery.min_price_warehouse ?? ""}
                    onChange={(e) =>
                      setEditingDelivery({
                        ...editingDelivery,
                        min_price_warehouse: e.target.value
                          ? parseFloat(e.target.value)
                          : undefined,
                      })
                    }
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#2DB0E6]/20 focus:border-[#2DB0E6] transition-all font-medium"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-2 pt-2">
                <span className="text-sm font-bold text-slate-800">
                  Фотографии
                </span>
                {editingDelivery.id ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {renderPhotoSlot(
                      "delivery_option",
                      editingDelivery.id,
                      "main",
                      "Фото машины",
                      editingDelivery.media_files,
                    )}
                  </div>
                ) : (
                  <div className="bg-amber-50 border border-amber-200 text-amber-700 p-3 rounded-xl text-sm font-medium">
                    Для загрузки фотографий сначала сохраните тип машины.
                  </div>
                )}
              </div>

              <label className="flex items-center gap-3 p-4 bg-slate-50 rounded-xl border border-slate-100 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editingDelivery.is_active !== false}
                  onChange={(e) =>
                    setEditingDelivery({
                      ...editingDelivery,
                      is_active: e.target.checked,
                    })
                  }
                  className="w-5 h-5 rounded text-[#2DB0E6] focus:ring-[#2DB0E6] border-slate-300 cursor-pointer"
                />
                <div className="flex flex-col">
                  <span className="font-bold text-slate-800 text-sm">
                    Тип машины активен
                  </span>
                  <span className="text-xs text-slate-500 font-medium">
                    Отображать этот тип для логистов и клиентов
                  </span>
                </div>
              </label>

              <div className="flex gap-3 pt-4 border-t border-slate-100 mt-2">
                <button
                  type="button"
                  onClick={() => setIsDeliveryModalOpen(false)}
                  className="flex-1 py-3 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition-colors"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={isSavingDelivery}
                  className="flex-1 py-3 px-4 bg-[#2DB0E6] hover:bg-[#209ccf] text-white font-bold rounded-xl transition-colors flex justify-center items-center gap-2 shadow-sm"
                >
                  {isSavingDelivery ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    "Сохранить"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Driver Modal */}
      {isDriverModalOpen && editingDriver && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-3xl w-full max-w-xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h3 className="text-xl font-bold text-slate-800">
                {editingDriver.id
                  ? "Редактировать водителя"
                  : "Добавить водителя"}
              </h3>
              <button
                onClick={() => setIsDriverModalOpen(false)}
                className="p-2 text-slate-400 hover:bg-slate-200 hover:text-slate-600 rounded-full transition-colors"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <form
              onSubmit={handleSaveDriver}
              className="p-6 overflow-y-auto flex flex-col gap-5"
            >
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  ФИО
                </label>
                <input
                  type="text"
                  required
                  value={editingDriver.name || ""}
                  onChange={(e) =>
                    setEditingDriver({ ...editingDriver, name: e.target.value })
                  }
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#2DB0E6]/20 focus:border-[#2DB0E6] transition-all font-medium"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Телефон
                </label>
                <input
                  type="text"
                  required
                  value={editingDriver.phone || ""}
                  onChange={(e) => {
                    let val = e.target.value;
                    const formatted = formatPhoneNumber(val);
                    setEditingDriver({ ...editingDriver, phone: formatted });
                  }}
                  placeholder="+7 (999) 000-00-00"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#2DB0E6]/20 focus:border-[#2DB0E6] transition-all font-medium"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Марка машины
                </label>
                <input
                  type="text"
                  required
                  placeholder="Например: Камаз"
                  value={editingDriver.vehicle_brand || ""}
                  onChange={(e) =>
                    setEditingDriver({
                      ...editingDriver,
                      vehicle_brand: e.target.value,
                    })
                  }
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#2DB0E6]/20 focus:border-[#2DB0E6] transition-all font-medium"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Госномер
                </label>
                <input
                  type="text"
                  required
                  placeholder="Например: А000ПА"
                  value={editingDriver.vehicle_plate_number || ""}
                  onChange={(e) =>
                    setEditingDriver({
                      ...editingDriver,
                      vehicle_plate_number: e.target.value,
                    })
                  }
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#2DB0E6]/20 focus:border-[#2DB0E6] transition-all font-medium"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Тип машины
                </label>
                <select
                  required
                  value={editingDriver.vehicle_type || ""}
                  onChange={(e) =>
                    setEditingDriver({
                      ...editingDriver,
                      vehicle_type: e.target.value,
                    })
                  }
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#2DB0E6]/20 focus:border-[#2DB0E6] transition-all font-medium"
                >
                  <option value="" disabled>
                    Выберите тип машины...
                  </option>
                  <option value="Самосвал">Самосвал</option>
                  <option value="Бортовой">Бортовой</option>
                  <option value="Будка">Будка</option>
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Кубатура (м³)
                </label>
                <div className="grid grid-cols-2 gap-4 w-full overflow-hidden">
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    placeholder="От"
                    value={editingDriver.cubature_min || ""}
                    onChange={(e) =>
                      setEditingDriver({
                        ...editingDriver,
                        cubature_min: Number(e.target.value),
                      })
                    }
                    className="w-full min-w-0 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#2DB0E6]/20 focus:border-[#2DB0E6] transition-all font-medium"
                  />
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    placeholder="До"
                    value={editingDriver.cubature_max || ""}
                    onChange={(e) =>
                      setEditingDriver({
                        ...editingDriver,
                        cubature_max: Number(e.target.value),
                      })
                    }
                    className="w-full min-w-0 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#2DB0E6]/20 focus:border-[#2DB0E6] transition-all font-medium"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5 w-full">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Тоннаж (т)
                </label>
                <div className="grid grid-cols-2 gap-4 w-full overflow-hidden">
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    placeholder="От"
                    value={editingDriver.tonnage_min || ""}
                    onChange={(e) =>
                      setEditingDriver({
                        ...editingDriver,
                        tonnage_min: Number(e.target.value),
                      })
                    }
                    className="w-full min-w-0 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#2DB0E6]/20 focus:border-[#2DB0E6] transition-all font-medium"
                  />
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    placeholder="До"
                    value={editingDriver.tonnage_max || ""}
                    onChange={(e) =>
                      setEditingDriver({
                        ...editingDriver,
                        tonnage_max: Number(e.target.value),
                      })
                    }
                    className="w-full min-w-0 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#2DB0E6]/20 focus:border-[#2DB0E6] transition-all font-medium"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Пароль
                </label>
                <div className="relative w-full">
                  <input
                    type={showDriverPassword ? "text" : "password"}
                    required={!editingDriver.id}
                    placeholder={
                      editingDriver.id
                        ? "Оставьте пустым, чтобы не изменять"
                        : "Минимум 6 символов"
                    }
                    value={editingDriver.password || ""}
                    onChange={(e) =>
                      setEditingDriver({
                        ...editingDriver,
                        password: e.target.value,
                      })
                    }
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 pr-12 focus:outline-none focus:ring-2 focus:ring-[#2DB0E6]/20 focus:border-[#2DB0E6] transition-all font-medium"
                  />
                  <button
                    type="button"
                    onClick={() => setShowDriverPassword(!showDriverPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none"
                  >
                    {showDriverPassword ? (
                      <EyeOff className="w-5 h-5" />
                    ) : (
                      <Eye className="w-5 h-5" />
                    )}
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-3 mt-2 mb-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Фотографии машины (Загрузка)
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-2">
                    <span className="text-xs font-bold text-slate-500">
                      Спереди + номер
                    </span>
                    <label className="relative flex flex-col items-center justify-center h-28 border-2 border-slate-200 border-dashed hover:bg-slate-100 cursor-pointer rounded-xl bg-slate-50 transition-colors overflow-hidden group">
                      {fileMain || previewMain ? (
                        <img
                          src={
                            fileMain
                              ? URL.createObjectURL(fileMain)
                              : previewMain || undefined
                          }
                          alt="Спереди + номер"
                          className="absolute inset-0 w-full h-full object-cover"
                        />
                      ) : (
                        <div className="text-slate-400 flex flex-col items-center">
                          <Camera className="w-6 h-6 mb-1" />
                          <span className="text-[10px] font-medium uppercase tracking-wider">
                            Добавить
                          </span>
                        </div>
                      )}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          if (e.target.files?.[0])
                            setFileMain(e.target.files[0]);
                        }}
                      />
                    </label>
                  </div>
                  <div className="flex flex-col gap-2">
                    <span className="text-xs font-bold text-slate-500">
                      Сбоку
                    </span>
                    <label className="relative flex flex-col items-center justify-center h-28 border-2 border-slate-200 border-dashed hover:bg-slate-100 cursor-pointer rounded-xl bg-slate-50 transition-colors overflow-hidden group">
                      {fileLeft || previewLeft ? (
                        <img
                          src={
                            fileLeft
                              ? URL.createObjectURL(fileLeft)
                              : previewLeft || undefined
                          }
                          alt="Сбоку"
                          className="absolute inset-0 w-full h-full object-cover"
                        />
                      ) : (
                        <div className="text-slate-400 flex flex-col items-center">
                          <Camera className="w-6 h-6 mb-1" />
                          <span className="text-[10px] font-medium uppercase tracking-wider">
                            Добавить
                          </span>
                        </div>
                      )}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          if (e.target.files?.[0])
                            setFileLeft(e.target.files[0]);
                        }}
                      />
                    </label>
                  </div>
                  <div className="flex flex-col gap-2">
                    <span className="text-xs font-bold text-slate-500">
                      Только госномер
                    </span>
                    <label className="relative flex flex-col items-center justify-center h-28 border-2 border-slate-200 border-dashed hover:bg-slate-100 cursor-pointer rounded-xl bg-slate-50 transition-colors overflow-hidden group">
                      {filePlate || previewPlate ? (
                        <img
                          src={
                            filePlate
                              ? URL.createObjectURL(filePlate)
                              : previewPlate || undefined
                          }
                          alt="Только госномер"
                          className="absolute inset-0 w-full h-full object-cover"
                        />
                      ) : (
                        <div className="text-slate-400 flex flex-col items-center">
                          <Camera className="w-6 h-6 mb-1" />
                          <span className="text-[10px] font-medium uppercase tracking-wider">
                            Добавить
                          </span>
                        </div>
                      )}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          if (e.target.files?.[0])
                            setFilePlate(e.target.files[0]);
                        }}
                      />
                    </label>
                  </div>
                </div>
              </div>

              <label className="flex items-center gap-3 p-4 bg-slate-50 rounded-xl border border-slate-100 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editingDriver.is_active !== false}
                  onChange={(e) =>
                    setEditingDriver({
                      ...editingDriver,
                      is_active: e.target.checked,
                    })
                  }
                  className="w-5 h-5 rounded text-[#2DB0E6] focus:ring-[#2DB0E6] border-slate-300 cursor-pointer"
                />
                <div className="flex flex-col">
                  <span className="font-bold text-slate-800 text-sm">
                    Водитель активен
                  </span>
                  <span className="text-xs text-slate-500 font-medium">
                    Водитель сможет принимать заказы
                  </span>
                </div>
              </label>

              <div className="flex gap-3 pt-4 border-t border-slate-100 mt-2">
                <button
                  type="button"
                  onClick={() => setIsDriverModalOpen(false)}
                  className="flex-1 py-3 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition-colors"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={isSavingDriver}
                  className="flex-1 py-3 px-4 bg-[#2DB0E6] hover:bg-[#209ccf] text-white font-bold rounded-xl transition-colors flex justify-center items-center gap-2 shadow-sm"
                >
                  {isSavingDriver ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    "Сохранить"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {itemToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6">
              <h3 className="text-xl font-bold text-slate-800 mb-2">
                Удаление
              </h3>
              <p className="text-slate-500 font-medium text-sm">
                Вы уверены, что хотите удалить эту запись? Действие нельзя будет
                отменить.
              </p>
            </div>
            <div className="flex gap-3 p-4 bg-slate-50 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setItemToDelete(null)}
                className="flex-1 py-2.5 px-4 bg-white hover:bg-slate-100 text-slate-700 font-bold rounded-xl border border-slate-200 transition-colors"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={confirmDeleteAction}
                className="flex-1 py-2.5 px-4 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl transition-colors shadow-sm"
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}

      <DriverHistoryModal
        isOpen={isOrderHistoryModalOpen}
        onClose={() => {
          setIsOrderHistoryModalOpen(false);
          setSelectedHistoryDriverId(null);
        }}
        driverId={selectedHistoryDriverId}
        driverName={selectedHistoryDriverName}
      />
    </div>
  );
}
