import React, { useState, useEffect } from "react";
import { baseURL, APP_VERSION } from "./utils";
import { RefreshCw } from "lucide-react";

export default function UpdateBanner() {
  const [updateInfo, setUpdateInfo] = useState<{ show: boolean, downloadUrl: string, version: string } | null>(null);

  useEffect(() => {
    const fetchVersion = async () => {
      try {
        const res = await fetch(`${baseURL}/system/version`);
        if (res.ok) {
          const data = await res.json();
          if (data.android_version && data.android_version !== APP_VERSION) {
            setUpdateInfo({
              show: true,
              downloadUrl: data.download_url || "https://darmavoz.ru/static/darmavoz.apk",
              version: data.android_version,
            });
          }
        }
      } catch (err) {
        // Silent fail
      }
    };
    fetchVersion();
  }, []);

  if (!updateInfo?.show) return null;

  return (
    <div className="bg-blue-50 p-4 sm:p-5 rounded-2xl shadow-sm border border-blue-100 flex flex-col items-start gap-4 mb-4">
      <div className="flex items-center gap-3 w-full">
        <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center shadow-sm shrink-0">
          <RefreshCw className="w-5 h-5 text-[#2DB0E6]" />
        </div>
        <div>
          <h3 className="text-base font-bold text-blue-900 leading-snug">Доступна новая версия</h3>
          <p className="text-[13px] font-medium text-blue-700/80 mt-0.5">
            Рекомендуем обновить приложение (версия {updateInfo.version})
          </p>
        </div>
      </div>
      <button
        onClick={() => window.open(updateInfo.downloadUrl + '?v=' + Date.now(), '_system')}
        className="w-full bg-[#2DB0E6] hover:bg-[#2DB0E6] active:scale-[0.98] text-white py-3 rounded-xl font-bold transition-all shadow-sm flex justify-center items-center"
      >
        Скачать обновление
      </button>
    </div>
  );
}
