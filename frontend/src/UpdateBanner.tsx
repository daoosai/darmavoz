import React, { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

import { APP_VERSION, baseURL } from "./utils";

const API_SUFFIX_RE = /\/api\/v1\/?$/;
const PROD_APK_PATH = "/static/darmavoz.apk";
const TEST_APK_PATH = "/static/darmavoz-test.apk";

const getPublicBaseUrl = () => {
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || baseURL;
  return apiBaseUrl.replace(API_SUFFIX_RE, "");
};

const isTestContour = () => {
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || baseURL;
  return apiBaseUrl.includes("test.darmavoz.ru");
};

const getAbsolutePublicBaseUrl = () => {
  const publicBaseUrl = getPublicBaseUrl().replace(/\/$/, "");
  if (/^https?:\/\//i.test(publicBaseUrl)) {
    return publicBaseUrl;
  }

  if (typeof window !== "undefined") {
    return new URL(publicBaseUrl || "/", window.location.origin).toString().replace(/\/$/, "");
  }

  return publicBaseUrl;
};

const buildDownloadUrl = (downloadPath?: string | null) => {
  const publicBaseUrl = getAbsolutePublicBaseUrl();
  const defaultPath = isTestContour() ? TEST_APK_PATH : PROD_APK_PATH;
  const trimmedDownloadPath = downloadPath?.trim() || "";
  const resolvedPath = /^https?:\/\//i.test(trimmedDownloadPath)
    ? trimmedDownloadPath
    : defaultPath;

  if (/^https?:\/\//i.test(resolvedPath)) {
    return resolvedPath;
  }

  return new URL(resolvedPath, `${publicBaseUrl}/`).toString();
};

export default function UpdateBanner() {
  const [updateInfo, setUpdateInfo] = useState<{
    show: boolean;
    downloadUrl: string;
    version: string;
  } | null>(null);

  useEffect(() => {
    const fetchVersion = async () => {
      try {
        const res = await fetch(`${baseURL}/system/version`);
        if (!res.ok) {
          return;
        }

        const data = await res.json();
        const nextVersion = typeof data.android_version === "string" ? data.android_version.trim() : "";
        const currentVersion = APP_VERSION.trim();
        if (nextVersion && nextVersion !== currentVersion) {
          setUpdateInfo({
            show: true,
            downloadUrl: buildDownloadUrl(data.download_url),
            version: nextVersion,
          });
        }
      } catch {
        // Silent fail
      }
    };

    fetchVersion();
  }, []);

  if (!updateInfo?.show) {
    return null;
  }

  const cacheBustedDownloadUrl = new URL(updateInfo.downloadUrl);
  cacheBustedDownloadUrl.searchParams.set("v", Date.now().toString());

  return (
    <div className="mb-4 flex flex-col items-start gap-4 rounded-2xl border border-blue-100 bg-blue-50 p-4 shadow-sm sm:p-5">
      <div className="flex w-full items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white shadow-sm">
          <RefreshCw className="h-5 w-5 text-[#2DB0E6]" />
        </div>
        <div>
          <h3 className="text-base font-bold leading-snug text-blue-900">Доступна новая версия</h3>
          <p className="mt-0.5 text-[13px] font-medium text-blue-700/80">
            Рекомендуем обновить приложение (версия {updateInfo.version})
          </p>
        </div>
      </div>
      <button
        onClick={() => window.open(cacheBustedDownloadUrl.toString(), "_system")}
        className="flex w-full items-center justify-center rounded-xl bg-[#2DB0E6] py-3 font-bold text-white shadow-sm transition-all hover:bg-[#2DB0E6] active:scale-[0.98]"
        type="button"
      >
        Скачать обновление
      </button>
    </div>
  );
}
