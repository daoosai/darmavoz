import asyncio,json
from sqlalchemy import select,text
from app.db.database import AsyncSessionLocal,engine
from app.models.models import Material,Quarry,City,quarry_materials
from app.services.pickup_points import is_pickup_point_publicly_available,public_pickup_point_filters
from app.services.order_pricing import resolve_material_offer_price,has_valid_coordinates
engine.echo=False
async def main():
 async with AsyncSessionLocal() as s:
  await s.execute(text("SET TRANSACTION READ ONLY"))
  materials=(await s.scalars(select(Material).where(Material.name.ilike("%лесн%")))).all()
  cities=(await s.scalars(select(City))).all();city_by_id={x.id:x for x in cities}
  rows=[]
  for m in materials:
   points=(await s.execute(select(Quarry,quarry_materials.c.price,quarry_materials.c.is_active).join(quarry_materials,quarry_materials.c.quarry_id==Quarry.id).where(quarry_materials.c.material_id==m.id))).all()
   material={"id":str(m.id),"name":m.name,"is_active":m.is_active,"base_price":m.price,"is_free":m.is_free,"unit":m.unit,"points":[]}
   for q,price,active in points:
    city=city_by_id.get(q.city_id);resolved=resolve_material_offer_price(price,m)
    excludes=[]
    if not city or city.code!="tyumen":excludes.append("different_or_missing_city")
    if not is_pickup_point_publicly_available(q):excludes.append("not_public")
    if q.point_type!="quarry":excludes.append("automatic_search_only_accepts_quarry")
    if not active:excludes.append("inactive_material_offer")
    if resolved is None or resolved<0:excludes.append("missing_or_negative_price")
    if not has_valid_coordinates(q.lat,q.lon):excludes.append("invalid_coordinates")
    material["points"].append({"id":str(q.id),"name":q.name,"city":city.name if city else None,"city_id":str(q.city_id),"city_code":city.code if city else None,"point_type":q.point_type,"is_active":q.is_active,"moderation_status":q.moderation_status,"placement_status":q.placement_status,"crm_status":q.crm_status,"placement_hidden_reason":q.placement_hidden_reason,"trial_ends_at":str(q.trial_ends_at),"placement_ends_at":str(q.placement_ends_at),"archived_at":str(q.archived_at),"lat":q.lat,"lon":q.lon,"offer_active":active,"offer_price":float(price) if price is not None else None,"resolved_price":resolved,"publicly_available":is_pickup_point_publicly_available(q),"exclusion_reasons":excludes})
   rows.append(material)
  print(json.dumps(rows,ensure_ascii=False,indent=2,default=str))
asyncio.run(main())
