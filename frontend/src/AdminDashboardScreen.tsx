import React, { useState, useEffect } from "react";
import { useAuthStore } from "./store";
import { baseURL } from "./utils";
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
  RefreshCw
} from "lucide-react";
import toast from "react-hot-toast";

interface AdminCategory {
  id: string;
  name: string;
}

interface AdminMediaFile {
  id: string;
  public_url: string;
  slot_key: string;
  is_primary: boolean;
}

interface AdminMaterial {
  id: string;
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
  moderation_status?: "pending_moderation" | "approved" | "rejected" | "suspended" | null;
  rate_mode?: "fixed" | "per_ton_km";
  fixed_rate?: number;
  rate_per_ton_km?: number;
  media_files?: { id: string; public_url: string; slot_key: string }[];
  delivery_option?: {
    title: string;
    capacity_m3: number;
  };
  vehicle?: {
    title: string;
    brand?: string;
    model?: string;
    plate_number?: string;
    vehicle_type?: string;
    delivery_option_id?: string;
    vehicle_main_url?: string;
    vehicle_left_url?: string;
    vehicle_plate_url?: string;
    delivery_option?: {
      id?: string;
      title?: string;
      capacity_m3: number;
    }
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
  vehicle_body_volume_m3: number;
  vehicle_main_url?: string | null;
  vehicle_left_url?: string | null;
  vehicle_plate_url?: string | null;
}

interface AdminDashboardScreenProps {
  onLogout: () => void;
}

export default function AdminDashboardScreen({ onLogout }: AdminDashboardScreenProps) {
  const { logout, token } = useAuthStore();
  const [activeTab, setActiveTab] = useState<"materials" | "delivery" | "drivers" | "moderation">("materials");
  
  const [materials, setMaterials] = useState<AdminMaterial[]>([]);
  const [deliveryOptions, setDeliveryOptions] = useState<AdminDeliveryOption[]>([]);
  const [drivers, setDrivers] = useState<AdminDriver[]>([]);
  const [pendingRequests, setPendingRequests] = useState<PendingModerationRequest[]>([]);
  const [driverActiveOverrides, setDriverActiveOverrides] = useState<Record<string, boolean>>({});
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingModeration, setIsLoadingModeration] = useState(false);

  // Modals state
  const [isMaterialModalOpen, setIsMaterialModalOpen] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<Partial<AdminMaterial> | null>(null);
  const [isSavingMaterial, setIsSavingMaterial] = useState(false);

  const [isDeliveryModalOpen, setIsDeliveryModalOpen] = useState(false);
  const [editingDelivery, setEditingDelivery] = useState<Partial<AdminDeliveryOption> | null>(null);
  const [isSavingDelivery, setIsSavingDelivery] = useState(false);

  const [isDriverModalOpen, setIsDriverModalOpen] = useState(false);
  const [editingDriver, setEditingDriver] = useState<Partial<AdminDriver> & { password?: string }>({});
  const [isSavingDriver, setIsSavingDriver] = useState(false);
  const [showDriverPassword, setShowDriverPassword] = useState(false);

  const applyDriverActiveOverrides = (items: AdminDriver[]) =>
    items.map((driver) => {
      if (!driver.id || !(driver.id in driverActiveOverrides)) {
        return driver;
      }
      return { ...driver, is_active: driverActiveOverrides[driver.id] };
    });

  const getVehicleString = (driver: AdminDriver) => {
    const vehicleStr = driver.vehicle
      ? `${driver.vehicle.brand || ""} ${driver.vehicle.plate_number ? `(${driver.vehicle.plate_number})` : ""} - ${driver.vehicle.delivery_option?.capacity_m3 || "?"} м³`.trim()
      : "Автомобиль не назначен";
    
    let rateStr = "";
    if (driver.rate_mode === "fixed") {
      rateStr = `Фикс: ${driver.fixed_rate}₽`;
    } else if (driver.rate_mode === "per_ton_km") {
      rateStr = `За тн-км: ${driver.rate_per_ton_km}₽`;
    }
    
    return rateStr ? `${vehicleStr} | ${rateStr}` : vehicleStr;
  };

  const handleLogout = () => {
    logout();
    onLogout();
  };

  const handleApproveDriver = async (id: string) => {
    try {
      const res = await fetch(`${baseURL}/admin/drivers/${id}/approve`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        toast.success("Водитель одобрен");
        fetchDrivers(true);
        fetchPendingRequests(true);
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
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        toast.success("Водитель отклонен");
        fetchDrivers(true);
        fetchPendingRequests(true);
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
        headers: { Authorization: `Bearer ${token}` }
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
      const res = await fetch(`${baseURL}/catalog/categories/`);
      if (res.ok) {
        const data = await res.json();
        setCategories(Array.isArray(data) ? data : data.results || []);
      }
    } catch (e) {
      console.warn("Failed to fetch categories");
    }
  };

  const [uploadingSlots, setUploadingSlots] = useState<Record<string, boolean>>({});

  const uploadPhoto = async (file: File, entityType: string, entityId: string, slotKey: string) => {
    const slotId = `${entityType}-${entityId}-${slotKey}`;
    setUploadingSlots(prev => ({ ...prev, [slotId]: true }));
    try {
      // Подготовим безопасное имя файла, чтобы избежать ошибки "Unsupported file extension"
      let fileExt = file.name.includes('.') ? file.name.split('.').pop()?.toLowerCase() : '';
      if (!fileExt || !['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(fileExt)) {
        fileExt = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
      }
      const safeFileName = `photo-${Date.now()}.${fileExt}`;
      const safeContentType = file.type || `image/${fileExt === 'jpg' ? 'jpeg' : fileExt}`;

      // ШАГ 1: Presign
      const presignRes = await fetch(`${baseURL}/media/presign-upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          file_name: safeFileName,
          content_type: safeContentType,
          file_size: file.size,
          entity_type: entityType,
          entity_id: entityId,
          is_primary: false,
          slot_key: slotKey
        })
      });

      if (!presignRes.ok) {
        const errText = await presignRes.text();
        throw new Error(`Ошибка Presign: ${errText}`);
      }

      const presignData = await presignRes.json();
      if (!presignData.upload_url) throw new Error("Бэкенд не вернул upload_url!");

      // ШАГ 2: Upload to S3
      const uploadRes = await fetch(presignData.upload_url, {
        method: 'PUT',
        headers: {
          'Content-Type': safeContentType
        },
        body: file
      });

      if (!uploadRes.ok) {
        throw new Error(`Ошибка S3 (PUT): Статус ${uploadRes.status}`);
      }

      // ШАГ 3: Confirm
      const confirmRes = await fetch(`${baseURL}/media/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          entity_type: entityType,
          entity_id: entityId,
          object_key: presignData.object_key,
          file_name: safeFileName,
          content_type: safeContentType,
          file_size: file.size,
          is_primary: false,
          slot_key: slotKey
        })
      });

      if (!confirmRes.ok) {
        const errText = await confirmRes.text();
        throw new Error(`Ошибка Confirm: ${errText}`);
      }

      toast.success("Фото успешно загружено!");
      
      // refetch after upload
      if (entityType === "material") {
        await fetchMaterials(true);
        const refetchRes = await fetch(`${baseURL}/admin/materials/${entityId}`, {
          headers: { "Authorization": `Bearer ${token}` }
        });
        if(refetchRes.ok) setEditingMaterial(await refetchRes.json());
      }
      else if (entityType === "delivery_option") {
        await fetchDeliveryOptions(true);
        const refetchRes = await fetch(`${baseURL}/catalog/delivery-options/${entityId}`);
        if(refetchRes.ok) setEditingDelivery(await refetchRes.json());
      }
      
    } catch (err: any) {
      console.error("Full Upload Error:", err);
      toast.error(err.message || "Сбой загрузки фото");
    } finally {
      setUploadingSlots(prev => ({ ...prev, [slotId]: false }));
    }
  };

  const fetchMaterials = async (silent = false) => {
    if (!token) return;
    if (!silent) setIsLoading(true);
    try {
      const res = await fetch(`${baseURL}/admin/materials/`, {
        headers: { "Authorization": `Bearer ${token}` }
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
        headers: { Authorization: `Bearer ${token}` }
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
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (res.status === 404 || res.status === 405) {
        res = await fetch(`${baseURL}/drivers/`, {
          headers: { "Authorization": `Bearer ${token}` }
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
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Failed to fetch pending requests");
      const data = await res.json();
      const items = Array.isArray(data) ? data : data.results || [];
      setPendingRequests(items);
    } catch (err) {
      if (!silent) toast.error("Не удалось загрузить заявки");
    } finally {
      if (!silent) setIsLoadingModeration(false);
    }
  };

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

  const [itemToDelete, setItemToDelete] = useState<{ id: string; type: "material" | "delivery" | "driver" } | null>(null);

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
          headers: { "Authorization": `Bearer ${token}` }
        });
        if (!res.ok) throw new Error("Delete failed");
        const data = await res.json();
        if (data.action === "hidden") {
          toast.success("Элемент скрыт (так как имеет связанные заказы)");
        } else {
          toast.success("Успешно удалено");
        }
        fetchMaterials(true);
      } catch (err) {
        toast.error("Ошибка удаления");
      }
    } else if (type === "delivery") {
      try {
        const res = await fetch(`${baseURL}/admin/delivery-options/${id}`, {
          method: "DELETE",
          headers: { "Authorization": `Bearer ${token}` }
        });
        if (!res.ok) throw new Error("Delete failed");
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
          headers: { "Authorization": `Bearer ${token}` }
        });
        if (!res.ok) throw new Error("Delete failed");
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
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Delete media failed");
      toast.success("Фотография успешно удалена!");
      
      if (entityType === "material") {
        await fetchMaterials(true);
        if (editingMaterial && editingMaterial.id) {
          const refetchRes = await fetch(`${baseURL}/admin/materials/${editingMaterial.id}`, {
            headers: { "Authorization": `Bearer ${token}` }
          });
          if (refetchRes.ok) setEditingMaterial(await refetchRes.json());
        }
      } else if (entityType === "delivery_option") {
        await fetchDeliveryOptions(true);
        if (editingDelivery && editingDelivery.id) {
          const refetchRes = await fetch(`${baseURL}/catalog/delivery-options/${editingDelivery.id}`);
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
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Make primary failed");
      toast.success("Главное фото успешно назначено!");
      
      if (entityType === "material") {
        await fetchMaterials(true);
        if (editingMaterial && editingMaterial.id) {
          const refetchRes = await fetch(`${baseURL}/admin/materials/${editingMaterial.id}`, {
            headers: { "Authorization": `Bearer ${token}` }
          });
          if (refetchRes.ok) setEditingMaterial(await refetchRes.json());
        }
      } else if (entityType === "delivery_option") {
        await fetchDeliveryOptions(true);
        if (editingDelivery && editingDelivery.id) {
          const refetchRes = await fetch(`${baseURL}/catalog/delivery-options/${editingDelivery.id}`);
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
      const url = isEdit ? `${baseURL}/admin/materials/${editingMaterial.id}` : `${baseURL}/admin/materials/`;
      const method = isEdit ? "PATCH" : "POST";
      
      const payload: any = {
        name: editingMaterial.name,
        description: editingMaterial.description || "",
        price: Number(editingMaterial.price),
        unit: editingMaterial.unit || "м3",
        min_volume: Number(editingMaterial.min_volume || 1),
        is_active: editingMaterial.is_active ?? true
      };

      if (!isEdit) {
        payload.category_id = categories.length > 0 ? categories[0].id : null;
      }

      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify(payload)
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
      const url = isEdit ? `${baseURL}/admin/delivery-options/${editingDelivery.id}` : `${baseURL}/admin/delivery-options`;
      const method = isEdit ? "PATCH" : "POST";
      
      const payload: any = {
        title: editingDelivery.title,
        capacity_m3: Number(editingDelivery.capacity_m3),
        base_price: Number(editingDelivery.base_price || 0),
        is_active: editingDelivery.is_active ?? true,
        sort_order: 10
      };

      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail ? JSON.stringify(errData.detail) : "Ошибка сервера");
      }
      
      const savedData = await res.json();
      const entityId = isEdit ? editingDelivery.id! : savedData.id;
      
      toast.success(isEdit ? "Опция доставки обновлена" : "Опция доставки добавлена");
      setIsDeliveryModalOpen(false);
      fetchDeliveryOptions(true);
    } catch (err: any) {
      toast.error(err.message || "Ошибка сохранения опции доставки");
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
    if (driver) {
      const deliveryOptionId = driver.delivery_option_id || driver.vehicle?.delivery_option_id || driver.vehicle?.delivery_option?.id;
      setEditingDriver({ ...driver, delivery_option_id: deliveryOptionId, phone: formatPhoneNumber(driver.phone) });
    } else {
      setEditingDriver({ is_active: true, phone: "+7" });
    }
    setIsDriverModalOpen(true);
  };

  const cleanPhone = (phone: string) => phone.replace(/[^\d+]/g, '');

  const handleSaveDriver = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDriver?.name || !editingDriver?.phone || !editingDriver?.delivery_option_id) {
      toast.error("Заполните обязательные поля (Имя, Телефон, Автомобиль)");
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

      const payload: any = {
        name: editingDriver.name,
        phone: fullPhone,
        delivery_option_id: editingDriver.delivery_option_id,
        is_active: editingDriver.is_active ?? true
      };
      
      if (editingDriver.password) {
        payload.password = editingDriver.password;
      }

      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      
      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.detail || "Ошибка сохранения");
      }
      
      const previousIsActive = isEdit
        ? drivers.find((driver) => driver.id === editingDriver.id)?.is_active
        : undefined;
      const nextIsActive = editingDriver.is_active ?? true;
      const isStatusChanged = isEdit && previousIsActive !== nextIsActive;

      if (isEdit && editingDriver.id) {
        setDriverActiveOverrides((prev) => ({ ...prev, [editingDriver.id!]: nextIsActive }));
        setDrivers((prev) =>
          prev.map((driver) =>
            driver.id === editingDriver.id ? { ...driver, is_active: nextIsActive } : driver
          )
        );
      }

      toast.success(
        !isEdit ? "Водитель добавлен" : isStatusChanged ? "Статус водителя изменен" : "Водитель успешно сохранен"
      );
      setIsDriverModalOpen(false);
      fetchDrivers(true);
    } catch (err: any) {
      toast.error(err.message || "Ошибка сохранения водителя");
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
          headers: { "Authorization": `Bearer ${token}` }
        });
        if(res.ok) {
          const data = await res.json();
          setEditingMaterial({ ...data, media_files: data.media_files || material.media_files });
        }
      } catch (err) {
        console.error("Failed to fetch material details", err);
      }
    } else {
      setEditingMaterial({ is_active: true, unit: "м3", min_volume: 1, price: 0 });
      setIsMaterialModalOpen(true);
    }
  };

  const openDeliveryModal = async (delivery?: AdminDeliveryOption) => {
    if (delivery) {
      setEditingDelivery({ ...delivery });
      setIsDeliveryModalOpen(true);
      try {
        const res = await fetch(`${baseURL}/catalog/delivery-options/${delivery.id}`);
        if(res.ok) {
          const data = await res.json();
          setEditingDelivery({ ...data, media_files: data.media_files || delivery.media_files });
        }
      } catch (err) {
        console.error("Failed to fetch delivery details", err);
      }
    } else {
      setEditingDelivery({ is_active: true, capacity_m3: 0, base_price: 0 });
      setIsDeliveryModalOpen(true);
    }
  };

  const renderPhotoSlot = (entityType: string, entityId: string | undefined, slotKey: string, title: string, mediaFiles: AdminMediaFile[] = []) => {
    if (!entityId) {
      return (
        <div className="flex flex-col gap-1.5 opacity-50">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">{title}</label>
          <div className="border-2 border-dashed border-slate-200 rounded-xl p-4 flex flex-col items-center justify-center text-center">
            <span className="text-xs font-medium text-slate-500">Сначала сохраните элемент</span>
          </div>
        </div>
      );
    }

    const file = mediaFiles.find(m => m.slot_key === slotKey);
    const slotId = `${entityType}-${entityId}-${slotKey}`;
    const isUploading = uploadingSlots[slotId];

    return (
      <div className="flex flex-col gap-1.5" key={slotKey}>
        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">{title}</label>
        {isUploading ? (
          <div className="border-2 border-slate-200 rounded-xl p-4 flex flex-col items-center justify-center bg-slate-50 h-32">
            <Loader2 className="w-6 h-6 animate-spin text-indigo-600 mb-2" />
            <span className="text-xs font-medium text-slate-500">Загрузка...</span>
          </div>
        ) : file ? (
          <div className="border border-slate-200 rounded-xl p-2 relative group overflow-hidden bg-white">
            <div className="aspect-video bg-slate-100 rounded-lg overflow-hidden relative">
              <img src={file.public_url} alt={title} className="w-full h-full object-cover" />
              {file.is_primary && (
                <div className="absolute top-2 left-2 bg-indigo-600 text-white text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded shadow-sm flex items-center gap-1">
                  <Star className="w-3 h-3 fill-current" /> Главное
                </div>
              )}
            </div>
            <div className="flex gap-2 mt-2">
              <button 
                type="button"
                onClick={() => handleMakePrimary(file.id, entityType)}
                className={`flex-1 flex justify-center items-center gap-1.5 text-xs font-bold py-1.5 rounded-lg transition-colors border ${file.is_primary ? "bg-indigo-50 text-indigo-700 border-indigo-200" : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"}`}
              >
                {file.is_primary ? <Star className="w-3.5 h-3.5 fill-current" /> : <StarOff className="w-3.5 h-3.5" />}
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
          <div className="border-2 border-dashed border-slate-200 rounded-xl p-4 flex flex-col items-center justify-center gap-2 hover:bg-slate-50 hover:border-indigo-300 transition-all cursor-pointer relative h-32">
            <UploadCloud className="w-6 h-6 text-slate-400" />
            <span className="text-xs font-medium text-slate-500">Загрузить фото</span>
            <input 
              type="file" 
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" 
              accept="image/*" 
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  uploadPhoto(e.target.files[0], entityType, entityId, slotKey);
                  e.target.value = '';
                }
              }} 
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-screen bg-slate-50 relative overflow-hidden font-sans text-slate-800">
      {/* Header */}
      <div className="bg-white px-6 py-4 shadow-sm z-10 sticky top-0 border-b border-slate-100 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <div className="flex items-center justify-between sm:justify-start gap-6">
          <div>
            <h1 className="text-2xl font-black text-indigo-600 tracking-tight">
              Дармавоз
            </h1>
            <p className="text-sm font-medium text-slate-500">Панель администратора</p>
          </div>
          <button
            onClick={handleLogout}
            className="flex sm:hidden items-center gap-2 px-3 py-1.5 bg-slate-50 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors font-medium text-sm"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
        
        <div className="flex flex-1 sm:justify-center">
          <div className="bg-slate-100 p-1 rounded-xl flex w-full sm:w-auto">
            <button
              onClick={() => setActiveTab("materials")}
              className={`flex-1 sm:w-auto flex-shrink-0 whitespace-nowrap py-2 px-3 text-sm font-bold rounded-lg transition-colors flex items-center justify-center gap-2 ${
                activeTab === "materials" ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <Layers className="w-4 h-4" />
              Каталог
            </button>
            <button
              onClick={() => setActiveTab("delivery")}
              className={`flex-1 sm:w-auto flex-shrink-0 whitespace-nowrap py-2 px-3 text-sm font-bold rounded-lg transition-colors flex items-center justify-center gap-2 ${
                activeTab === "delivery" ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <Truck className="w-4 h-4" />
              Автопарк
            </button>
            <button
              onClick={() => setActiveTab("drivers")}
              className={`flex-1 sm:w-auto flex-shrink-0 whitespace-nowrap py-2 px-3 text-sm font-bold rounded-lg transition-colors flex items-center justify-center gap-2 ${
                activeTab === "drivers" ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <Truck className="w-4 h-4" />
              Водители
            </button>
            <button
              onClick={() => setActiveTab("moderation")}
              className={`flex-1 sm:w-auto flex-shrink-0 whitespace-nowrap py-2 px-3 text-sm font-bold rounded-lg transition-colors flex items-center justify-center gap-2 ${
                activeTab === "moderation" ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <div className="relative flex items-center justify-center">
                <ClipboardCheck className="w-4 h-4" />
                {drivers.filter(d => d.moderation_status === "pending_moderation").length > 0 && (
                  <div className="absolute -top-1.5 -right-2 bg-rose-500 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center shadow-sm">
                    {drivers.filter(d => d.moderation_status === "pending_moderation").length}
                  </div>
                )}
              </div>
              Модерация
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
      <div className="flex-1 overflow-y-auto p-6 lg:p-8">
        <div className="max-w-6xl mx-auto flex flex-col gap-6">
          {activeTab === "materials" ? (
            <>
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
                    className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-xl font-semibold hover:bg-indigo-700 transition-colors shadow-sm"
                  >
                    <Plus className="w-4 h-4" />
                    <span className="hidden sm:inline">Добавить</span>
                  </button>
                </div>
              </div>

              {isLoading ? (
                <div className="flex justify-center p-20">
                  <Loader2 className="w-10 h-10 animate-spin text-indigo-600" />
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
                          const imgUrl = m.primary_image_url || m.image_url || m.media_files?.[0]?.public_url;
                          return (
                            <tr key={m.id} className="hover:bg-slate-50/50 transition-colors">
                              <td className="px-6 py-4 text-xs font-mono text-slate-400">{m.id.substring(0,8)}</td>
                              <td className="px-6 py-4">
                                {imgUrl ? (
                                  <img src={imgUrl} alt={m.name} className="w-24 h-16 object-contain rounded-md border border-slate-200 bg-slate-50 p-1" />
                                ) : (
                                  <div className="w-24 h-16 rounded-md border border-slate-200 bg-slate-50 flex items-center justify-center text-slate-300">
                                    <ImageIcon className="w-5 h-5" />
                                  </div>
                                )}
                              </td>
                              <td className="px-6 py-4 font-semibold text-slate-800">{m.name}</td>
                              <td className="px-6 py-4 text-sm font-medium">{m.price} ₽</td>
                              <td className="px-6 py-4 text-sm text-slate-500">{m.unit}</td>
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
                                className="p-2 text-slate-400 hover:text-indigo-600 bg-slate-50 hover:bg-indigo-50 rounded-lg transition-colors border border-transparent"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button 
                                onClick={() => setItemToDelete({ id: m.id, type: "material" })}
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
                      const imgUrl = m.primary_image_url || m.image_url || m.media_files?.[0]?.public_url;
                      return (
                        <div key={m.id} className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 flex flex-col gap-3 relative">
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-xs font-mono text-slate-400">ID: {m.id.substring(0,8)}</span>
                            <div className="flex gap-2 -mt-2 -mr-2">
                              <button 
                                onClick={() => openMaterialModal(m)}
                                className="p-2 text-slate-400 hover:text-indigo-600 bg-slate-50 hover:bg-indigo-50 rounded-lg transition-colors border border-transparent"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button 
                                onClick={() => setItemToDelete({ id: m.id, type: "material" })}
                                className="p-2 text-slate-400 hover:text-red-600 bg-slate-50 hover:bg-red-50 rounded-lg transition-colors border border-transparent"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                          
                          <div className="flex gap-4 items-start">
                            {imgUrl ? (
                              <img src={imgUrl} alt={m.name} className="shrink-0 w-24 h-16 object-contain rounded-md border border-slate-200 bg-slate-50 p-1" />
                            ) : (
                              <div className="shrink-0 w-24 h-16 rounded-md border border-slate-200 bg-slate-50 flex items-center justify-center text-slate-300">
                                <ImageIcon className="w-5 h-5" />
                              </div>
                            )}
                            <div className="flex flex-col gap-1 min-w-0">
                              <h3 className="font-bold text-slate-800 text-base truncate pr-2">{m.name}</h3>
                              <div className="flex flex-col gap-0.5 mt-1">
                                <span className="text-sm font-medium text-slate-700">Цена: {m.price} ₽</span>
                                <span className="text-sm text-slate-500">Ед. изм.: {m.unit}</span>
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
                    <div className="p-8 text-center text-slate-500 font-medium">Нет загруженных материалов</div>
                  )}
                </div>
              )}
            </>
          ) : activeTab === "delivery" ? (
            <>
              {/* Delivery Options Tab */}
              <div className="flex justify-between items-center bg-white p-5 rounded-2xl shadow-sm border border-slate-100 mb-2">
                <h2 className="text-xl font-bold text-slate-800">Типы автомобилей</h2>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => fetchDeliveryOptions()}
                    className="text-sm font-semibold text-slate-500 hover:text-slate-700 transition-colors"
                  >
                    Обновить
                  </button>
                  <button
                    onClick={() => openDeliveryModal()}
                    className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-xl font-semibold hover:bg-indigo-700 transition-colors shadow-sm"
                  >
                    <Plus className="w-4 h-4" />
                    <span className="hidden sm:inline">Добавить</span>
                  </button>
                </div>
              </div>

              {isLoading ? (
                <div className="flex justify-center p-20">
                  <Loader2 className="w-10 h-10 animate-spin text-indigo-600" />
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
                          <th className="px-6 py-4">Базовая цена</th>
                          <th className="px-6 py-4">Статус</th>
                          <th className="px-6 py-4 text-right">Действия</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100/80">
                        {deliveryOptions.map((opt) => {
                          const imgUrl = opt.primary_image_url || opt.image_url || opt.media_files?.[0]?.public_url;
                          return (
                            <tr key={opt.id} className="hover:bg-slate-50/50 transition-colors">
                              <td className="px-6 py-4 text-xs font-mono text-slate-400">{opt.id.substring(0,8)}</td>
                              <td className="px-6 py-4">
                                {imgUrl ? (
                                  <img src={imgUrl} alt={opt.title} className="w-24 h-16 object-contain rounded-md border border-slate-200 bg-slate-50 p-1" />
                                ) : (
                                  <div className="w-24 h-16 rounded-md border border-slate-200 bg-slate-50 flex items-center justify-center text-slate-300">
                                    <ImageIcon className="w-5 h-5" />
                                  </div>
                                )}
                              </td>
                              <td className="px-6 py-4 font-semibold text-slate-800">{opt.title}</td>
                              <td className="px-6 py-4 text-sm font-medium">{opt.capacity_m3} м³</td>
                              <td className="px-6 py-4 text-sm font-medium">{opt.base_price} ₽</td>
                              <td className="px-6 py-4">
                                {opt.is_active === false ? (
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-amber-100 text-amber-800 text-[11px] font-bold uppercase tracking-wider whitespace-nowrap">
                                    <XCircle className="w-3 h-3" /> Неактивен
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-50 text-emerald-700 text-[11px] font-bold uppercase tracking-wider whitespace-nowrap">
                                    <CheckCircle2 className="w-3 h-3" /> Активен
                                  </span>
                                )}
                              </td>
                            <td className="px-6 py-4 text-right flex justify-end gap-2">
                              <button 
                                onClick={() => openDeliveryModal(opt)}
                                className="p-2 text-slate-400 hover:text-indigo-600 bg-slate-50 hover:bg-indigo-50 rounded-lg transition-colors border border-transparent"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button 
                                onClick={() => setItemToDelete({ id: opt.id, type: "delivery" })}
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
                    {deliveryOptions.map((opt) => {
                      const imgUrl = opt.primary_image_url || opt.image_url || opt.media_files?.[0]?.public_url;
                      return (
                        <div key={opt.id} className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 flex flex-col gap-3 relative">
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-xs font-mono text-slate-400">ID: {opt.id.substring(0,8)}</span>
                            <div className="flex gap-2 -mt-2 -mr-2">
                              <button 
                                onClick={() => openDeliveryModal(opt)}
                                className="p-2 text-slate-400 hover:text-indigo-600 bg-slate-50 hover:bg-indigo-50 rounded-lg transition-colors border border-transparent"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button 
                                onClick={() => setItemToDelete({ id: opt.id, type: "delivery" })}
                                className="p-2 text-slate-400 hover:text-red-600 bg-slate-50 hover:bg-red-50 rounded-lg transition-colors border border-transparent"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                          
                          <div className="flex gap-4 items-start">
                            {imgUrl ? (
                              <img src={imgUrl} alt={opt.title} className="shrink-0 w-24 h-16 object-contain rounded-md border border-slate-200 bg-slate-50 p-1" />
                            ) : (
                              <div className="shrink-0 w-24 h-16 rounded-md border border-slate-200 bg-slate-50 flex items-center justify-center text-slate-300">
                                <ImageIcon className="w-5 h-5" />
                              </div>
                            )}
                            <div className="flex flex-col gap-1 min-w-0">
                              <h3 className="font-bold text-slate-800 text-base truncate pr-2">{opt.title}</h3>
                              <div className="flex flex-col gap-0.5 mt-1">
                                <span className="text-sm font-medium text-slate-700">Кубатура: {opt.capacity_m3} м³</span>
                                <span className="text-sm text-slate-500">Базовая цена: {opt.base_price} ₽</span>
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
                    <div className="p-8 text-center text-slate-500 font-medium">Нет типов авто</div>
                  )}
                </div>
              )}
            </>
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
                    className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-xl font-semibold hover:bg-indigo-700 transition-colors shadow-sm"
                  >
                    <Plus className="w-4 h-4" />
                    <span className="hidden sm:inline">Добавить</span>
                  </button>
                </div>
              </div>

              {isLoading ? (
                <div className="flex justify-center p-20">
                  <Loader2 className="w-10 h-10 animate-spin text-indigo-600" />
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
                          <tr key={d.id} className="hover:bg-slate-50/50 transition-colors">
                            <td className="px-6 py-4 text-xs font-mono text-slate-400">{d.id.substring(0,8)}</td>
                            <td className="px-6 py-4 font-semibold text-slate-800">{d.name}</td>
                            <td className="px-6 py-4 text-sm whitespace-nowrap">{d.phone}</td>
                            <td className="px-6 py-4 text-sm text-slate-500">
                              <div className="flex flex-col gap-2">
                                <span>{getVehicleString(d)}</span>
                                {d.moderation_status === "pending_moderation" && d.media_files && d.media_files.length > 0 && (
                                  <div className="flex gap-2 mt-1">
                                    {d.media_files.map(mf => (
                                      <a key={mf.id} href={mf.public_url} target="_blank" rel="noreferrer" className="block w-12 h-12 rounded-lg border border-slate-200 overflow-hidden hover:opacity-80">
                                        <img src={mf.public_url} alt={mf.slot_key} className="w-full h-full object-cover" />
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
                              ) : d.moderation_status === "pending_moderation" ? (
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
                                className="p-2 text-slate-400 hover:text-indigo-600 bg-slate-50 hover:bg-indigo-50 rounded-lg transition-colors border border-transparent"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button 
                                onClick={() => setItemToDelete({ id: d.id, type: "driver" })}
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
                      <div key={d.id} className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 flex flex-col gap-3 relative">
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-xs font-mono text-slate-400">ID: {d.id.substring(0,8)}</span>
                          <div className="flex gap-2 -mt-2 -mr-2">
                            <button 
                              onClick={() => openDriverModal(d)}
                              className="p-2 text-slate-400 hover:text-indigo-600 bg-slate-50 hover:bg-indigo-50 rounded-lg transition-colors border border-transparent"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={() => setItemToDelete({ id: d.id, type: "driver" })}
                              className="p-2 text-slate-400 hover:text-red-600 bg-slate-50 hover:bg-red-50 rounded-lg transition-colors border border-transparent"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                        
                        <div className="flex flex-col gap-1 min-w-0">
                          <h3 className="font-bold text-slate-800 text-base truncate pr-2">{d.name}</h3>
                          <div className="flex flex-col gap-0.5 mt-1">
                            <span className="text-sm font-medium text-slate-700">Телефон: {d.phone}</span>
                            <div className="flex flex-col gap-1">
                              <span className="text-sm text-slate-500">Авто: {getVehicleString(d)}</span>
                              {d.moderation_status === "pending_moderation" && d.media_files && d.media_files.length > 0 && (
                                <div className="flex gap-2 mt-2">
                                  {d.media_files.map(mf => (
                                    <a key={mf.id} href={mf.public_url} target="_blank" rel="noreferrer" className="block w-14 h-14 rounded-lg border border-slate-200 overflow-hidden hover:opacity-80">
                                      <img src={mf.public_url} alt={mf.slot_key} className="w-full h-full object-cover" />
                                    </a>
                                  ))}
                                </div>
                              )}
                            </div>
                            {d.moderation_status === "pending_moderation" && (
                              <span className="text-sm font-bold text-amber-600 mt-1">На проверке</span>
                            )}
                            {d.moderation_status === "rejected" && (
                              <span className="text-sm font-bold text-rose-600 mt-1">Отклонен</span>
                            )}
                            {d.moderation_status === "suspended" && (
                              <span className="text-sm font-bold text-slate-500 mt-1">Заблокирован</span>
                            )}
                            {d.moderation_status === "approved" && (
                              <span className="text-sm font-bold text-emerald-600 mt-1">Одобрен</span>
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
                    <div className="p-8 text-center text-slate-500 font-medium">Нет водителей</div>
                  )}
                </div>
              )}
            </>
          ) : activeTab === "moderation" ? (
            <>
              <div className="flex justify-between items-center bg-white p-5 rounded-2xl shadow-sm border border-slate-100 mb-2">
                <h2 className="text-xl font-bold text-slate-800">Заявки на модерацию</h2>
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
                  <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {pendingRequests.length === 0 ? (
                    <div className="p-12 text-center bg-white rounded-2xl shadow-sm border border-slate-100 flex flex-col items-center gap-3">
                      <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center">
                        <ClipboardCheck className="w-8 h-8 text-slate-300" />
                      </div>
                      <p className="text-slate-500 font-medium text-lg">Нет новых заявок на модерацию</p>
                    </div>
                  ) : (
                    pendingRequests.map(request => (
                      <div key={request.driver_id} className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 flex flex-col gap-5">
                        
                        <div className="flex flex-col md:flex-row gap-6 md:gap-10">
                          {/* Driver Info */}
                          <div className="flex-1 space-y-4">
                            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-3">
                              <div className="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center flex-shrink-0">
                                <Truck className="w-5 h-5 text-indigo-500" />
                              </div>
                              {request.driver_name}
                            </h3>
                            <div className="flex flex-col gap-2 text-sm text-slate-600 pl-13">
                              <div className="flex justify-between border-b border-slate-50 pb-2">
                                <span className="font-medium text-slate-400">Телефон</span>
                                <span className="font-semibold text-slate-700">{request.driver_phone}</span>
                              </div>
                              <div className="flex justify-between border-b border-slate-50 pb-2">
                                <span className="font-medium text-slate-400">Марка/Модель</span>
                                <span className="font-semibold text-slate-700">{request.vehicle_brand} {request.vehicle_model}</span>
                              </div>
                              <div className="flex justify-between border-b border-slate-50 pb-2">
                                <span className="font-medium text-slate-400">Госномер</span>
                                <span className="font-mono font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">{request.vehicle_plate_number}</span>
                              </div>
                              <div className="flex justify-between border-b border-slate-50 pb-2">
                                <span className="font-medium text-slate-400">Кубатура</span>
                                <span className="font-semibold text-slate-700">{request.vehicle_body_volume_m3} м³</span>
                              </div>
                            </div>
                          </div>

                          {/* Photos Info */}
                          <div className="flex-[1.5] flex flex-col gap-3">
                            <span className="text-sm font-bold text-slate-700 uppercase tracking-wider">Фотографии автомобиля</span>
                            <div className="grid grid-cols-3 gap-4">
                              {/* Основное фото / Спереди */}
                              <div className="flex flex-col gap-2">
                                {request.vehicle_main_url ? (
                                  <a href={request.vehicle_main_url} target="_blank" rel="noreferrer" className="block relative group rounded-lg overflow-hidden h-48 border border-slate-200">
                                    <img src={request.vehicle_main_url} alt="Спереди" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                                    <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                      <Eye className="w-8 h-8 text-white" />
                                    </div>
                                  </a>
                                ) : (
                                  <div className="h-48 bg-slate-100 rounded-lg flex items-center justify-center border border-slate-200">
                                    <span className="text-sm font-medium text-slate-400">Нет фото</span>
                                  </div>
                                )}
                                <span className="text-xs font-bold text-center text-slate-600">Спереди</span>
                              </div>

                              {/* Сбоку / Слева */}
                              <div className="flex flex-col gap-2">
                                {request.vehicle_left_url ? (
                                  <a href={request.vehicle_left_url} target="_blank" rel="noreferrer" className="block relative group rounded-lg overflow-hidden h-48 border border-slate-200">
                                    <img src={request.vehicle_left_url} alt="Сбоку" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                                    <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                      <Eye className="w-8 h-8 text-white" />
                                    </div>
                                  </a>
                                ) : (
                                  <div className="h-48 bg-slate-100 rounded-lg flex items-center justify-center border border-slate-200">
                                    <span className="text-sm font-medium text-slate-400">Нет фото</span>
                                  </div>
                                )}
                                <span className="text-xs font-bold text-center text-slate-600">Сбоку</span>
                              </div>

                              {/* Номер / Plate */}
                              <div className="flex flex-col gap-2">
                                {request.vehicle_plate_url ? (
                                  <a href={request.vehicle_plate_url} target="_blank" rel="noreferrer" className="block relative group rounded-lg overflow-hidden h-48 border border-slate-200">
                                    <img src={request.vehicle_plate_url} alt="Госномер" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                                    <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                      <Eye className="w-8 h-8 text-white" />
                                    </div>
                                  </a>
                                ) : (
                                  <div className="h-48 bg-slate-100 rounded-lg flex items-center justify-center border border-slate-200">
                                    <span className="text-sm font-medium text-slate-400">Нет фото</span>
                                  </div>
                                )}
                                <span className="text-xs font-bold text-center text-slate-600">Фото госномера</span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex gap-4 pt-5 border-t border-slate-100 mt-2">
                          <button
                            onClick={() => handleRejectDriver(request.driver_id)}
                            className="flex-1 py-3 px-4 bg-white hover:bg-rose-50 text-rose-600 font-bold rounded-xl transition-colors border border-rose-200 hover:border-rose-300 shadow-sm flex items-center justify-center gap-2"
                          >
                            <XCircle className="w-5 h-5" />
                            Отклонить
                          </button>
                          <button
                            onClick={() => handleApproveDriver(request.driver_id)}
                            className="flex-[2] py-3 px-4 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-xl transition-colors shadow-sm flex items-center justify-center gap-2"
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
          ) : null}
        </div>
      </div>

      {/* Material Modal */}
      {isMaterialModalOpen && editingMaterial && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-3xl w-full max-w-xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h3 className="text-xl font-bold text-slate-800">
                {editingMaterial.id ? "Редактировать материал" : "Добавить материал"}
              </h3>
              <button
                onClick={() => setIsMaterialModalOpen(false)}
                className="p-2 text-slate-400 hover:bg-slate-200 hover:text-slate-600 rounded-full transition-colors"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>
            
            <form onSubmit={handleSaveMaterial} className="p-6 overflow-y-auto flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Название</label>
                <input
                  type="text"
                  required
                  value={editingMaterial.name || ""}
                  onChange={(e) => setEditingMaterial({ ...editingMaterial, name: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Описание</label>
                <textarea
                  rows={2}
                  value={editingMaterial.description || ""}
                  onChange={(e) => setEditingMaterial({ ...editingMaterial, description: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Цена (₽)</label>
                  <input
                    type="number"
                    required
                    step="0.01"
                    min="0"
                    value={editingMaterial.price || ""}
                    onChange={(e) => setEditingMaterial({ ...editingMaterial, price: parseFloat(e.target.value) })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Мин. объем</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={editingMaterial.min_volume || ""}
                    onChange={(e) => setEditingMaterial({ ...editingMaterial, min_volume: parseFloat(e.target.value) })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Ед. измерения</label>
                <input
                  type="text"
                  value={editingMaterial.unit || ""}
                  onChange={(e) => setEditingMaterial({ ...editingMaterial, unit: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium"
                />
              </div>

              <div className="flex flex-col gap-2 pt-2">
                <span className="text-sm font-bold text-slate-800">Фотографии</span>
                {editingMaterial.id ? (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {renderPhotoSlot("material", editingMaterial.id, "career", "Карьер", editingMaterial.media_files)}
                    {renderPhotoSlot("material", editingMaterial.id, "unload", "Выгрузка", editingMaterial.media_files)}
                    {renderPhotoSlot("material", editingMaterial.id, "texture", "Текстура", editingMaterial.media_files)}
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
                  onChange={(e) => setEditingMaterial({ ...editingMaterial, is_active: e.target.checked })}
                  className="w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 cursor-pointer"
                />
                <div className="flex flex-col">
                  <span className="font-bold text-slate-800 text-sm">Материал активен</span>
                  <span className="text-xs text-slate-500 font-medium">Отображать этот материал в каталоге</span>
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
                  className="flex-1 py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-colors flex justify-center items-center gap-2 shadow-sm"
                >
                  {isSavingMaterial ? <Loader2 className="w-5 h-5 animate-spin" /> : "Сохранить"}
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
                {editingDelivery.id ? "Редактировать тип машины" : "Добавить тип машины"}
              </h3>
              <button
                onClick={() => setIsDeliveryModalOpen(false)}
                className="p-2 text-slate-400 hover:bg-slate-200 hover:text-slate-600 rounded-full transition-colors"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>
            
            <form onSubmit={handleSaveDelivery} className="p-6 overflow-y-auto flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Марка машины (например: Volvo, КамАЗ)</label>
                <input
                  type="text"
                  required
                  value={editingDelivery.title || ""}
                  onChange={(e) => setEditingDelivery({ ...editingDelivery, title: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Объем (м³)</label>
                  <input
                    type="number"
                    required
                    step="0.1"
                    min="0"
                    value={editingDelivery.capacity_m3 || ""}
                    onChange={(e) => setEditingDelivery({ ...editingDelivery, capacity_m3: parseFloat(e.target.value) })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Базовая цена (₽)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={editingDelivery.base_price ?? ""}
                    onChange={(e) => setEditingDelivery({ ...editingDelivery, base_price: parseFloat(e.target.value) })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-2 pt-2">
                <span className="text-sm font-bold text-slate-800">Фотографии</span>
                {editingDelivery.id ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {renderPhotoSlot("delivery_option", editingDelivery.id, "main", "Фото машины", editingDelivery.media_files)}
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
                  onChange={(e) => setEditingDelivery({ ...editingDelivery, is_active: e.target.checked })}
                  className="w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 cursor-pointer"
                />
                <div className="flex flex-col">
                  <span className="font-bold text-slate-800 text-sm">Тип машины активен</span>
                  <span className="text-xs text-slate-500 font-medium">Отображать этот тип для логистов и клиентов</span>
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
                  className="flex-1 py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-colors flex justify-center items-center gap-2 shadow-sm"
                >
                  {isSavingDelivery ? <Loader2 className="w-5 h-5 animate-spin" /> : "Сохранить"}
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
                {editingDriver.id ? "Редактировать водителя" : "Добавить водителя"}
              </h3>
              <button
                onClick={() => setIsDriverModalOpen(false)}
                className="p-2 text-slate-400 hover:bg-slate-200 hover:text-slate-600 rounded-full transition-colors"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>
            
            <form onSubmit={handleSaveDriver} className="p-6 overflow-y-auto flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">ФИО</label>
                <input
                  type="text"
                  required
                  value={editingDriver.name || ""}
                  onChange={(e) => setEditingDriver({ ...editingDriver, name: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Телефон</label>
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
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Тип машины (Кубатура)</label>
                <select
                  required
                  value={editingDriver.delivery_option_id || ""}
                  onChange={(e) => setEditingDriver({ ...editingDriver, delivery_option_id: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium"
                >
                  <option value="" disabled>Выберите машину...</option>
                  {deliveryOptions.map(opt => (
                    <option key={opt.id} value={opt.id}>{opt.title} ({opt.capacity_m3} м³)</option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Пароль</label>
                <div className="relative w-full">
                  <input
                    type={showDriverPassword ? "text" : "password"}
                    required={!editingDriver.id}
                    placeholder={editingDriver.id ? "Оставьте пустым, чтобы не изменять" : "Минимум 6 символов"}
                    value={editingDriver.password || ""}
                    onChange={(e) => setEditingDriver({ ...editingDriver, password: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 pr-12 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium"
                  />
                  <button
                    type="button"
                    onClick={() => setShowDriverPassword(!showDriverPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none"
                  >
                    {showDriverPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              <label className="flex items-center gap-3 p-4 bg-slate-50 rounded-xl border border-slate-100 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editingDriver.is_active !== false}
                  onChange={(e) => setEditingDriver({ ...editingDriver, is_active: e.target.checked })}
                  className="w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 cursor-pointer"
                />
                <div className="flex flex-col">
                  <span className="font-bold text-slate-800 text-sm">Водитель активен</span>
                  <span className="text-xs text-slate-500 font-medium">Водитель сможет принимать заказы</span>
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
                  className="flex-1 py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-colors flex justify-center items-center gap-2 shadow-sm"
                >
                  {isSavingDriver ? <Loader2 className="w-5 h-5 animate-spin" /> : "Сохранить"}
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
              <h3 className="text-xl font-bold text-slate-800 mb-2">Удаление</h3>
              <p className="text-slate-500 font-medium text-sm">
                Вы уверены, что хотите удалить эту запись? Действие нельзя будет отменить.
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
    </div>
  );
}
