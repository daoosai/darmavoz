export interface MediaFile {
  public_url: string;
}

export interface MaterialProps {
  id: string;
  name: string;
  description?: string;
  price: number;
  unit: string;
  min_volume?: number;
  primary_image_url?: string;
  image_url?: string;
  media_files?: MediaFile[];
}

export interface DeliveryOption {
  id: string;
  capacity_m3: number;
  title: string;
  base_price: number;
  primary_image_url?: string;
  image_url?: string;
  media_files?: MediaFile[];
}
