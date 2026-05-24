import { MaterialProps, DeliveryOption } from './MaterialDetailScreen';

export const baseURL = import.meta.env.PROD ? 'https://darmavoz.ru/api/v1' : '/api/v1';

export const getImageUrl = (item: MaterialProps | DeliveryOption) => {
  return item.primary_image_url || item?.media_files?.[0]?.public_url || item.image_url || "/placeholder.jpg";
};
