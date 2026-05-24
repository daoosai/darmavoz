import { MaterialProps, DeliveryOption } from './MaterialDetailScreen';

export const getImageUrl = (item: MaterialProps | DeliveryOption) => {
  return item.primary_image_url || item?.media_files?.[0]?.public_url || item.image_url || "/placeholder.jpg";
};
