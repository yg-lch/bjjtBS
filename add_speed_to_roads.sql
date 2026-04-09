-- 为road_single表添加speed字段
ALTER TABLE "road_single" ADD COLUMN IF NOT EXISTS speed double precision;

-- 根据道路类型设置不同的速度值（单位：km/h）
-- 道路类型和对应的速度：
-- 高速公路：120 km/h
-- 快速路：80 km/h  
-- 主干道：60 km/h
-- 次干道：50 km/h
-- 支路：40 km/h
-- 其他：30 km/h

UPDATE "road_single" SET speed = 
  CASE 
    WHEN type LIKE '%高速%' OR type LIKE '%Highway%' OR type LIKE '%Expressway%' THEN 120
    WHEN type LIKE '%快速%' OR type LIKE '%Fast%' OR type LIKE '%Rapid%' THEN 80
    WHEN type LIKE '%主干%' OR type LIKE '%Main%' OR type LIKE '%Primary%' THEN 60
    WHEN type LIKE '%次干%' OR type LIKE '%Secondary%' THEN 50
    WHEN type LIKE '%支路%' OR type LIKE '%Branch%' OR type LIKE '%Local%' THEN 40
    ELSE 30
  END;

-- 计算travel_time（单位：分钟）
-- travel_time = distance / speed * 60
ALTER TABLE "road_single" ADD COLUMN IF NOT EXISTS travel_time double precision;

UPDATE "road_single" SET travel_time = (cost / speed) * 60;

-- 更新cost字段，使用travel_time作为权重
UPDATE "road_single" SET cost = travel_time;

-- 验证结果
SELECT 
  type,
  COUNT(*) as road_count,
  AVG(speed) as avg_speed,
  AVG(travel_time) as avg_travel_time,
  AVG(cost) as avg_cost
FROM "road_single" 
GROUP BY type
ORDER BY road_count DESC;

-- 查看样本数据
SELECT 
  id,
  type,
  cost,
  speed,
  travel_time,
  Shape_Leng
FROM "road_single" 
LIMIT 10;