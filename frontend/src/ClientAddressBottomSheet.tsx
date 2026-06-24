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

  // Ref for the ymaps script and suggest view
  const suggestViewRef = useRef<any>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const placemarkRef = useRef<any>(null);

  useEffect(() => {
    if (isOpen && token && role === "client" && !isAdding) {
      fetchAddresses();
    }
  }, [isOpen, token, role, isAdding]);

  useEffect(() => {
    if (isAdding && isOpen) {
      initYandexMapAndSuggest();
    }
    return () => {
      if (suggestViewRef.current) {
        try {
          suggestViewRef.current.destroy();
        } catch (e) {}
        suggestViewRef.current = null;
      }
      if (mapRef.current) {
        try {
          mapRef.current.destroy();
        } catch (e) {}
        mapRef.current = null;
      }
      placemarkRef.current = null;
    };
  }, [isAdding, isOpen]);

  const handleMapClickOrDrag = (coords: number[]) => {
    setLat(coords[0]);
    setLon(coords[1]);

    if (mapRef.current) {
      if (!placemarkRef.current) {
        placemarkRef.current = new (window as any).ymaps.Placemark(
          coords,
          {},
          {
            preset: "islands#redIcon",
            draggable: true,
          },
        );
        placemarkRef.current.events.add("dragend", () => {
          const newCoords = placemarkRef.current.geometry.getCoordinates();
          handleMapClickOrDrag(newCoords);
        });
        mapRef.current.geoObjects.add(placemarkRef.current);
      } else {
        placemarkRef.current.geometry.setCoordinates(coords);
      }
    }

    (window as any).ymaps.geocode(coords).then((res: any) => {
      const firstGeoObject = res.geoObjects.get(0);
      if (firstGeoObject) {
        const addressText = firstGeoObject.getAddressLine();
        setNewAddress(addressText);
        if (inputRef.current) {
          inputRef.current.value = addressText;
        }
      }
    });
  };

  const initYandexMapAndSuggest = () => {
    if (!(window as any).ymaps) return;

    (window as any).ymaps.ready(() => {
      try {
        if (!mapContainerRef.current || !inputRef.current) return;

        // Clean up previous instances just in case
        if (suggestViewRef.current) {
          try {
            suggestViewRef.current.destroy();
          } catch (e) {}
          suggestViewRef.current = null;
        }
        if (mapRef.current) {
          try {
            mapRef.current.destroy();
          } catch (e) {}
          mapRef.current = null;
        }
        placemarkRef.current = null;

        // Init map
        if (mapContainerRef.current) {
          mapRef.current = new (window as any).ymaps.Map(
            mapContainerRef.current,
            {
              center: [57.152223, 65.527202], // Tyumen
              zoom: 12,
              controls: ["zoomControl"],
            },
          );

          mapRef.current.events.add("click", (e: any) => {
            handleMapClickOrDrag(e.get("coords"));
          });
        }

        // Init suggest
        if (inputRef.current && (window as any).ymaps.SuggestView) {
          setTimeout(() => {
            if (!inputRef.current) return;
            suggestViewRef.current = new (window as any).ymaps.SuggestView(
              "suggest-address",
              {
                provider: "yandex#map",
                results: 5,
              },
            );
            suggestViewRef.current.events.add("select", (e: any) => {
              const selected = e.get("item").value;
              setNewAddress(selected);
              if (inputRef.current) {
                inputRef.current.value = selected;
              }

              (window as any).ymaps.geocode(selected).then((res: any) => {
                const firstGeoObject = res.geoObjects.get(0);
                if (firstGeoObject) {
                  const coords = firstGeoObject.geometry.getCoordinates();

                  setLat(coords[0]);
                  setLon(coords[1]);

                  if (mapRef.current) {
                    mapRef.current.setCenter(coords, 16, {
                      duration: 400,
                      timingFunction: "ease-in-out",
                    });

                    if (!placemarkRef.current) {
                      placemarkRef.current = new (
                        window as any
                      ).ymaps.Placemark(
                        coords,
                        {},
                        {
                          preset: "islands#redIcon",
                          draggable: true,
                        },
                      );

                      placemarkRef.current.events.add("dragend", () => {
                        const newCoords =
                          placemarkRef.current.geometry.getCoordinates();
                        handleMapClickOrDrag(newCoords);
                      });

                      mapRef.current.geoObjects.add(placemarkRef.current);
                    } else {
                      placemarkRef.current.geometry.setCoordinates(coords);
                    }
                  }
                }
              });
            });
          }, 300);
        }
      } catch (error) {
        console.warn("Yandex Map/Suggest init failed", error);
      }
    });
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
    const addressToSave = inputRef.current?.value || newAddress;
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
    // clean map if necessary
    if (placemarkRef.current && mapRef.current) {
      mapRef.current.geoObjects.remove(placemarkRef.current);
      placemarkRef.current = null;
    }
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
          {isAdding ? (
            <div className="flex flex-col h-full bg-slate-50">
              {/* Map Container */}
              <div
                ref={mapContainerRef}
                className="w-full min-h-[240px] shrink-0 bg-slate-200"
              />

              {/* Form */}
              <div className="flex-1 bg-white flex flex-col gap-5 px-6 py-5 rounded-t-3xl -mt-4 relative z-10">
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-semibold text-slate-700 ml-1">
                    Город, улица, дом
                  </label>
                  <div className="relative">
                    <Navigation className="absolute left-3.5 top-[14px] w-5 h-5 text-slate-400" />
                    <input
                      id="suggest-address"
                      ref={inputRef}
                      type="text"
                      defaultValue={newAddress}
                      placeholder="Введите адрес..."
                      className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-3.5 pl-11 pr-4 text-[15px] font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#2DB0E6]/20 focus:border-[#2DB0E6]/50 transition-all"
                    />
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
