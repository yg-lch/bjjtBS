-- 多路径规划SQL脚本
-- 使用pgRouting的KSP算法生成多条路径

-- 创建多路径规划函数
CREATE OR REPLACE FUNCTION get_multiple_routes(
    start_lon numeric,
    start_lat numeric,
    end_lon numeric,
    end_lat numeric,
    k_routes integer DEFAULT 3  -- 返回的路径数量
)
RETURNS TABLE(
    route_id integer,
    route geometry,
    total_distance numeric,
    total_time numeric,
    avg_speed numeric,
    edge_count integer
) AS $$
DECLARE
    start_node_id integer;
    end_node_id integer;
BEGIN
    -- 1. 找到最近的节点
    SELECT id INTO start_node_id
    FROM road_single_vertices_pgr
    ORDER BY the_geom <-> ST_SetSRID(ST_MakePoint(start_lon, start_lat), 4326)
    LIMIT 1;
    
    SELECT id INTO end_node_id
    FROM road_single_vertices_pgr
    ORDER BY the_geom <-> ST_SetSRID(ST_MakePoint(end_lon, end_lat), 4326)
    LIMIT 1;
    
    IF start_node_id IS NULL OR end_node_id IS NULL THEN
        RETURN QUERY
        SELECT NULL::integer, NULL::geometry, 0::numeric, 0::numeric, 0::numeric, 0::integer
        LIMIT 0;
        RETURN;
    END IF;
    
    -- 2. 使用KSP算法生成多条路径
    RETURN QUERY
    WITH ksp_results AS (
        SELECT 
            path_id,
            seq,
            edge
        FROM pgr_ksp(
            'SELECT id, source, target, cost, reverse_cost FROM road_single',
            start_node_id,
            end_node_id,
            k_routes,
            directed := true
        )
        WHERE edge != -1
    ),
    route_geometries AS (
        SELECT 
            path_id,
            ST_AsGeoJSON(
                ST_Simplify(
                    ST_LineMerge(
                        ST_MakeLine(road_single.geom ORDER BY ksp_results.seq)
                    ),
                    0.00005
                )
            ) as route_geojson,
            SUM(road_single.cost) as total_time,
            SUM(road_single.Shape_Leng) as total_distance,
            AVG(road_single.speed) as avg_speed,
            COUNT(*) as edge_count
        FROM ksp_results
        JOIN road_single ON ksp_results.edge = road_single.id
        GROUP BY path_id
    )
    SELECT 
        route_geometries.path_id as route_id,
        ST_GeomFromText(route_geometries.route_geojson, 4326) as route,
        route_geometries.total_distance,
        route_geometries.total_time,
        route_geometries.avg_speed,
        route_geometries.edge_count
    FROM route_geometries
    ORDER BY route_geometries.total_time;
    
END;
$$ LANGUAGE plpgsql;

-- 测试多路径规划
SELECT 
    route_id,
    ST_AsGeoJSON(route) as route_geojson,
    total_distance,
    total_time,
    avg_speed,
    edge_count
FROM get_multiple_routes(116.3975, 39.9087, 116.3971, 39.9178, 3);