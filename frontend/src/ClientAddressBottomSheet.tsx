import React, { useState, useEffect, useRef } from "react";
import {
  X,
  MapPin,
  Plus,
  Loader2,
  Navigation,
  Trash2,
  Edit2,
  CheckCircle2,
  Circle,
} from "lucide-react";
import { fetch2gisAddressSuggestions, withTyumenBias } from "./addressSearch";
import { baseURL, handleApiError } from "./utils";
import { useAuthStore, useAddressStore } from "./store";
import toast from "react-hot-toast";

interface Address {
  id?: string;
  address?: string; // keeping just in case
  full_address: string;
  lat?: number;
  lon?: number;
  comment?: string;
  is_default?: boolean;
}

interface ClientAddressBottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ClientAddressBottomSheet({
  isOpen,
  onClose,
}: ClientAddressBottomSheetProps) {
  const { token, role } = useAuthStore();
  const { selectedAddress, setSelectedAddress } = useAddressStore();
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [newAddress, setNewAddress] = useState("");
  const [newComment, setNewComment] = useState("");
  const [lat, setLat] = useState<number | null>(null);
  const [lon, setLon] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localSelectedId, setLocalSelectedId] = useState<string | null>(null);
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);

  const [suggestions, setSuggestions] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);

  useEffect(() => {
    if (isOpen && token && role === "client" && !isAdding) {
      fetchAddresses();
    }
  }, [isOpen, token, role, isAdding]);

  useEffect(() => {
    let mapInstance: any = null;

    if (isOpen && (window as any).mapgl && !mapRef.current) {
      const container = document.getElementById("client-map");
      if (container) {
        const initialLon = lon || 65.527202;
        const initialLat = lat || 57.152223;

        mapInstance = new (window as any).mapgl.Map("client-map", {
          center: [initialLon, initialLat],
          zoom: 12,
          key: "1ee6f536-8494-4bb2-adc0-d011444c567a",
        });

        mapRef.current = mapInstance;

        if (lat && lon) {
          markerRef.current = new (window as any).mapgl.Marker(mapInstance, {
            coordinates: [lon, lat],
          });
        }
      }
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.destroy();
        mapRef.current = null;
      }
      if (markerRef.current) {
        markerRef.current.destroy();
        markerRef.current = null;
      }
    };
  }, [isOpen]); // Initialize when modal opens

  useEffect(() => {
    if (mapRef.current && lat && lon) {
      const coords: [number, number] = [lon, lat];

      mapRef.current.setCenter(coords);
      mapRef.current.setZoom(15);

      if (markerRef.current) {
        markerRef.current.setCoordinates(coords);
      } else {
        markerRef.current = new (window as any).mapgl.Marker(mapRef.current, {
          coordinates: coords,
        });
      }
    }
  }, [lat, lon]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(event.target as Node)
      ) {
        setSuggestions([]);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, []);

  const fetch2GISSuggests = async (query: string) => {
    const items = await fetch2gisAddressSuggestions(query);
    return items.map((item: any) => item.search_attributes?.suggested_text);
  };

  const handleAddressChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const val = e.target.value;
    setNewAddress(val);
    const suggests = await fetch2GISSuggests(val);
    setSuggestions(suggests.filter(Boolean));
  };

  const selectSuggestion = async (address: string) => {
    setNewAddress(address);
    setSuggestions([]);

    try {
      const response = await fetch(
        `${baseURL}/geo/geocode?address=${encodeURIComponent(withTyumenBias(address))}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (response.ok) {
        const data = await response.json();
        setLat(data.lat);
        setLon(data.lon);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchAddresses = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${baseURL}/client/addresses`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (res.ok) {
        const data = await res.json();
        const addressList = Array.isArray(data) ? data : data.results || [];
        setAddresses(addressList);

        if (addressList.length === 0) {
          setIsAdding(true);
        } else {
          const match = selectedAddress
            ? addressList.find((a: any) => a.full_address === selectedAddress)
            : null;
          if (match) {
            setLocalSelectedId(match.id);
          } else {
            const def =
              addressList.find((a: any) => a.is_default) || addressList[0];
            setSelectedAddress(def.full_address);
            setLocalSelectedId(def.id);
          }
        }
      }
    } catch (err) {
      console.error("Failed to fetch addresses:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveList = () => {
    if (localSelectedId) {
      const selectedAddr = addresses.find((a) => a.id === localSelectedId);
      if (selectedAddr) {
        setSelectedAddress(selectedAddr.full_address);
      }
    }
    onClose();
  };

  const handleDeleteAddress = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const res = await fetch(`${baseURL}/client/addresses/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        toast.success("Адрес удален");
        fetchAddresses();
      } else {
        toast.error("Ошибка при удалении адреса");
      }
    } catch (err: any) {
      toast.error(handleApiError(err, "Ошибка при удалении"));
    }
  };

  const handleEditAddress = (addr: Address, e: React.MouseEvent) => {
    e.stopPropagation();
    setNewAddress(addr.full_address || addr.address || "");
    setNewComment(addr.comment || "");
    setEditingAddressId(addr.id || null);
    setIsAdding(true);
  };

  const handleAddAddress = async () => {
    const addressToSave = newAddress;
    if (!addressToSave.trim()) return;
    setIsSubmitting(true);
    try {
      const method = editingAddressId ? "PUT" : "POST";
      const url = editingAddressId
        ? `${baseURL}/client/addresses/${editingAddressId}`
        : `${baseURL}/client/addresses`;

      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          address: addressToSave,
          full_address: addressToSave,
          lat: lat,
          lon: lon,
          comment: newComment,
          is_default: addresses.length === 0,
        }),
      });

      if (res.ok) {
        toast.success(editingAddressId ? "Адрес обновлен!" : "Адрес добавлен!");
        setSelectedAddress(addressToSave);
        setNewAddress("");
        setNewComment("");
        setEditingAddressId(null);
        setIsAdding(false);
        fetchAddresses();
      } else {
        toast.error("Не удалось сохранить адрес");
      }
    } catch (err: any) {
      console.error(err);
      toast.error(handleApiError(err, "Ошибка сохранения"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const openAddMode = () => {
    setNewAddress("");
    setNewComment("");
    setEditingAddressId(null);
    setIsAdding(true);
    setSuggestions([]);
  };

  if (!isOpen) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-[60] bg-slate-900/40 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />
      <div
        className={`fixed inset-x-0 bottom-0 z-[70] bg-white rounded-t-[32px] shadow-2xl transform transition-transform duration-300 ease-out flex flex-col max-h-[95vh] ${isAdding ? "h-[95vh]" : "h-auto"} sm:max-w-xl sm:mx-auto`}
      >
        <div className="w-full flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-12 h-1.5 bg-slate-200 rounded-full"></div>
        </div>

        <div className="px-6 pb-4 pt-2 flex items-center justify-between shrink-0 border-b border-slate-50">
          <h2 className="text-[20px] font-bold text-slate-900 leading-tight">
            {isAdding ? "Укажите адрес" : "Мои адреса"}
          </h2>
          {!isAdding && (
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-600 bg-slate-50 hover:bg-slate-100 transition-colors rounded-full -mr-2"
            >
              <X className="w-[18px] h-[18px] stroke-[2.5]" />
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto flex flex-col">
          <div className="flex flex-col shrink-0 bg-slate-50 px-6 pt-4">
            {/* Map Container */}
            <div
              id="client-map"
              className="w-full h-48 bg-gray-100 rounded-xl overflow-hidden"
            />
          </div>
          {isAdding ? (
            <div className="flex flex-col h-full bg-slate-50">
              {/* Form */}
              <div className="flex-1 bg-white flex flex-col gap-5 px-6 py-5 rounded-t-3xl relative z-10 mt-4">
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-semibold text-slate-700 ml-1">
                    Город, улица, дом
                  </label>
                  <div className="relative" ref={wrapperRef}>
                    <Navigation className="absolute left-3.5 top-[14px] w-5 h-5 text-slate-400" />
                    <input
                      type="text"
                      value={newAddress}
                      onChange={handleAddressChange}
                      placeholder="Введите адрес..."
                      className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-3.5 pl-11 pr-4 text-[15px] font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#2DB0E6]/20 focus:border-[#2DB0E6]/50 transition-all"
                    />
                    {suggestions.length > 0 && (
                      <ul className="absolute z-[9999] top-full mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-2xl max-h-48 overflow-y-auto">
                        {suggestions.map((addr, idx) => (
                          <li
                            key={idx}
                            onClick={() => selectSuggestion(addr)}
                            className="px-4 py-3 hover:bg-slate-50 cursor-pointer border-b border-gray-100 last:border-0 text-sm"
                          >
                            {addr}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-sm font-semibold text-slate-700 ml-1">
                    Комментарий водителю
                  </label>
                  <textarea
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    placeholder=""
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 text-[15px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#2DB0E6]/20 focus:border-[#2DB0E6]/50 transition-all min-h-[100px] resize-none"
                  />
                </div>

                <div className="mt-auto pt-2 pb-4">
                  <button
                    onClick={handleAddAddress}
                    disabled={isSubmitting}
                    className="w-full bg-[#2DB0E6] text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2 active:bg-[#209dd0] transition-colors disabled:opacity-50 text-[16px]"
                  >
                    {isSubmitting ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      "Сохранить адрес"
                    )}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="px-6 py-4 flex flex-col gap-4">
              {isLoading ? (
                <div className="py-10 flex justify-center">
                  <Loader2 className="w-8 h-8 animate-spin text-[#2DB0E6]" />
                </div>
              ) : addresses.length === 0 ? (
                <div className="py-8 text-center flex flex-col items-center">
                  <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center mb-3">
                    <MapPin className="w-8 h-8 text-slate-300" />
                  </div>
                  <p className="text-slate-500 font-medium mb-1">
                    У вас пока нет сохраненных адресов
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {addresses.map((addr) => {
                    const isSelected = localSelectedId === addr.id;
                    return (
                      <div
                        key={addr.id || addr.full_address || addr.address}
                        onClick={() => setLocalSelectedId(addr.id || null)}
                        className={`p-4 rounded-2xl border flex items-center gap-3 cursor-pointer transition-all ${
                          isSelected
                            ? "border-[#2DB0E6] bg-[#2DB0E6]/5"
                            : "border-slate-200 bg-white hover:border-[#2DB0E6]/30"
                        }`}
                      >
                        <div className="shrink-0">
                          {isSelected ? (
                            <CheckCircle2 className="w-6 h-6 text-[#2DB0E6] fill-[#2DB0E6]/10" />
                          ) : (
                            <Circle className="w-6 h-6 text-slate-300" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0 flex flex-col">
                          <p
                            className={`font-semibold text-[15px] leading-tight truncate ${isSelected ? "text-[#2DB0E6]" : "text-slate-800"}`}
                          >
                            {addr.full_address || addr.address}
                          </p>
                          {addr.comment && (
                            <p className="text-[13px] text-slate-500 mt-1 truncate">
                              {addr.comment}
                            </p>
                          )}
                        </div>
                        {addr.id && (
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              onClick={(e) => handleEditAddress(addr, e)}
                              className="p-2 text-slate-400 hover:text-[#2DB0E6] hover:bg-[#2DB0E6]/10 rounded-xl transition-colors"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={(e) =>
                                handleDeleteAddress(addr.id as string, e)
                              }
                              className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="pt-2 flex flex-col gap-3 shrink-0 pb-safe">
                <button
                  onClick={openAddMode}
                  className="w-full border-2 border-[#2DB0E6] text-[#2DB0E6] font-bold py-3.5 rounded-2xl flex items-center justify-center gap-2 active:bg-[#2DB0E6]/10 transition-colors bg-white"
                >
                  <Plus className="w-5 h-5 stroke-[2.5]" />
                  Добавить адрес
                </button>
                <button
                  onClick={handleSaveList}
                  disabled={!localSelectedId || addresses.length === 0}
                  className="w-full bg-slate-100 text-slate-800 font-bold py-3.5 rounded-2xl flex items-center justify-center gap-2 active:bg-slate-200 transition-colors disabled:opacity-50"
                >
                  Выбрать
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
