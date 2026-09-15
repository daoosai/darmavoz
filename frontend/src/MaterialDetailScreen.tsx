export interface MediaFile {
  public_url: string;
}

export interface MaterialProps {
  calculator_enabled?: boolean;
  bulk_density_t_m3?: number | null;
  id: string;
  name: string;
  description?: string;
  price: number;
  is_free?: boolean;
  unit: string;
  min_volume?: number;
  primary_image_url?: string;
  image_url?: string;
  category_id?: string;
  category?: { name?: string | null };
  media_files?: MediaFile[];
  delivery_options?: DeliveryOption[];
}

export interface DeliveryOption {
  id: string;
  transport_category_id?: string | null;
  transport_category?: {
    id: string;
    slug: string;
    title: string;
    capacity_min_m3: number;
    capacity_max_m3?: number | null;
  } | null;
  capacity_m3: number;
  title: string;
  base_price?: number | null;
  delivery_rate_per_km?: number;
  min_price_quarry?: number;
  min_price_warehouse?: number;
  primary_image_url?: string;
  image_url?: string;
  media_files?: MediaFile[];
  is_active?: boolean;
}
